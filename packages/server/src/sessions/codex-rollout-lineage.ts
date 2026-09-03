import type {
  CodexHistoryPosition,
  CodexSessionEntry,
  CodexSessionMetaEntry,
} from "@yep-anywhere/shared";
import { parseCodexSessionEntry } from "@yep-anywhere/shared";
import { getCodexRolloutSessionId } from "../utils/codexRolloutFiles.js";
import { iterateJsonlLineRecords, readFirstLine } from "../utils/jsonl.js";

const CODEX_META_READ_MAX_BYTES = 1024 * 1024;

export interface CodexRolloutLineageSegment {
  rolloutId: string;
  filePath: string;
  startOrdinal: number;
  end?: CodexHistoryPosition;
}

export interface CodexRolloutLineage {
  requestedSessionId: string;
  canonicalMeta: CodexSessionMetaEntry;
  referenceBacked: boolean;
  segments: CodexRolloutLineageSegment[];
}

export interface CodexLineageReadMetrics {
  lineCount: number;
  parsedEntries: number;
  maxLineLength: number;
  parseMs: number;
  bytesRead: number;
}

export interface CodexLineageEntrySnapshot extends CodexLineageReadMetrics {
  entries: CodexSessionEntry[];
}

export type ResolveCodexRolloutPath = (
  rolloutId: string,
) => Promise<string | null>;

export class CodexRolloutLineageError extends Error {
  constructor(sessionId: string, detail: string) {
    super(`Invalid Codex rollout lineage for ${sessionId}: ${detail}`);
    this.name = "CodexRolloutLineageError";
  }
}

function isSafeOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertHistoryPosition(
  requestedSessionId: string,
  position: CodexHistoryPosition,
): void {
  if (!isSafeOffset(position.end_byte_offset)) {
    throw new CodexRolloutLineageError(
      requestedSessionId,
      "cutoff byte offset is not a safe non-negative integer",
    );
  }
  if (
    !Number.isSafeInteger(position.end_ordinal_exclusive) ||
    position.end_ordinal_exclusive <= 0
  ) {
    throw new CodexRolloutLineageError(
      requestedSessionId,
      "cutoff cannot include source session metadata",
    );
  }
}

export async function readCodexSessionMeta(
  filePath: string,
): Promise<CodexSessionMetaEntry> {
  const firstLine = await readFirstLine(filePath, CODEX_META_READ_MAX_BYTES);
  const entry = firstLine ? parseCodexSessionEntry(firstLine) : null;
  if (entry?.type !== "session_meta") {
    throw new Error(`Codex rollout has no readable session_meta: ${filePath}`);
  }
  return entry;
}

/**
 * Resolve the immutable rollout segments that form one logical Codex thread.
 * This mirrors Codex Core's local rollout-lineage rules while leaving path
 * discovery with the caller, which already owns the rollout catalog.
 */
export async function resolveCodexRolloutLineage(options: {
  requestedSessionId: string;
  leafFilePath: string;
  resolveRolloutPath: ResolveCodexRolloutPath;
}): Promise<CodexRolloutLineage> {
  const { requestedSessionId, leafFilePath, resolveRolloutPath } = options;
  const canonicalMeta = await readCodexSessionMeta(leafFilePath);
  if (canonicalMeta.payload.id !== requestedSessionId) {
    throw new CodexRolloutLineageError(
      requestedSessionId,
      "selected rollout belongs to another thread",
    );
  }

  if (!canonicalMeta.payload.history_base) {
    return {
      requestedSessionId,
      canonicalMeta,
      referenceBacked: false,
      segments: [],
    };
  }

  const segments: CodexRolloutLineageSegment[] = [];
  const seen = new Set<string>();
  let filePath = leafFilePath;
  let rolloutId = getCodexRolloutSessionId(filePath) ?? requestedSessionId;
  let end: CodexHistoryPosition | undefined;

  for (;;) {
    if (seen.has(rolloutId)) {
      throw new CodexRolloutLineageError(requestedSessionId, "cycle detected");
    }
    seen.add(rolloutId);

    const fileRolloutId = getCodexRolloutSessionId(filePath);
    if (fileRolloutId && fileRolloutId !== rolloutId) {
      throw new CodexRolloutLineageError(
        requestedSessionId,
        `rollout ${rolloutId} resolved to a different rollout file`,
      );
    }

    const meta =
      filePath === leafFilePath
        ? canonicalMeta
        : await readCodexSessionMeta(filePath);
    if (meta.payload.id !== rolloutId) {
      throw new CodexRolloutLineageError(
        requestedSessionId,
        `rollout ${rolloutId} metadata belongs to ${meta.payload.id}`,
      );
    }
    if (meta.payload.history_mode !== "paginated") {
      throw new CodexRolloutLineageError(
        requestedSessionId,
        `rollout ${rolloutId} is not paginated`,
      );
    }
    if (end) {
      assertHistoryPosition(requestedSessionId, end);
      if (end.thread_id !== rolloutId) {
        throw new CodexRolloutLineageError(
          requestedSessionId,
          `cutoff identifies ${end.thread_id}, not resolved rollout ${rolloutId}`,
        );
      }
    }

    const historyBase = meta.payload.history_base;
    const startOrdinal = historyBase
      ? historyBase.end_ordinal_exclusive + 1
      : 1;
    if (!Number.isSafeInteger(startOrdinal) || startOrdinal <= 0) {
      throw new CodexRolloutLineageError(
        requestedSessionId,
        `rollout ${rolloutId} has an unsafe starting ordinal`,
      );
    }
    segments.push({
      rolloutId,
      filePath,
      startOrdinal,
      ...(end ? { end } : {}),
    });

    if (!historyBase) break;
    assertHistoryPosition(requestedSessionId, historyBase);
    rolloutId = historyBase.thread_id;
    const sourcePath = await resolveRolloutPath(rolloutId);
    if (!sourcePath) {
      throw new CodexRolloutLineageError(
        requestedSessionId,
        `missing source rollout ${rolloutId}`,
      );
    }
    filePath = sourcePath;
    end = historyBase;
  }

  segments.reverse();
  return {
    requestedSessionId,
    canonicalMeta,
    referenceBacked: true,
    segments,
  };
}

function entryOrdinal(entry: CodexSessionEntry): number | null {
  const ordinal = (entry as { ordinal?: unknown }).ordinal;
  return Number.isSafeInteger(ordinal) && Number(ordinal) >= 0
    ? Number(ordinal)
    : null;
}

/**
 * Iterate one logical reference-backed transcript. The selected child's
 * metadata is emitted once; every physical segment contributes only its local
 * delta and is bounded by the descendant's frozen byte/ordinal position.
 */
export async function* iterateCodexRolloutLineageEntries(
  lineage: CodexRolloutLineage,
  metrics?: CodexLineageReadMetrics,
): AsyncIterable<CodexSessionEntry> {
  if (!lineage.referenceBacked) {
    throw new CodexRolloutLineageError(
      lineage.requestedSessionId,
      "standalone rollout has no lineage to iterate",
    );
  }

  yield lineage.canonicalMeta;

  for (const segment of lineage.segments) {
    let byteOffset = 0;
    let previousOrdinal: number | null = null;
    let reachedCutoff = segment.end === undefined;

    for await (const { line, terminated } of iterateJsonlLineRecords(
      segment.filePath,
    )) {
      if (metrics) {
        metrics.lineCount += 1;
        metrics.maxLineLength = Math.max(metrics.maxLineLength, line.length);
      }
      const lineEndByteOffset =
        byteOffset + Buffer.byteLength(line, "utf8") + (terminated ? 1 : 0);
      if (metrics) {
        metrics.bytesRead += lineEndByteOffset - byteOffset;
      }
      if (segment.end && !terminated) {
        throw new CodexRolloutLineageError(
          lineage.requestedSessionId,
          `cutoff for rollout ${segment.rolloutId} reaches an incomplete JSONL record`,
        );
      }
      if (segment.end && lineEndByteOffset > segment.end.end_byte_offset) {
        throw new CodexRolloutLineageError(
          lineage.requestedSessionId,
          `cutoff for rollout ${segment.rolloutId} splits a JSONL record`,
        );
      }

      const parseStartedAt = Date.now();
      const entry = line.trim() ? parseCodexSessionEntry(line) : null;
      if (metrics) {
        metrics.parseMs += Date.now() - parseStartedAt;
      }
      if (entry) {
        const ordinal = entryOrdinal(entry);
        if (ordinal === null) {
          throw new CodexRolloutLineageError(
            lineage.requestedSessionId,
            `rollout ${segment.rolloutId} has an entry without a safe ordinal`,
          );
        }
        if (previousOrdinal !== null && ordinal !== previousOrdinal + 1) {
          throw new CodexRolloutLineageError(
            lineage.requestedSessionId,
            `rollout ${segment.rolloutId} has a non-contiguous ordinal`,
          );
        }
        previousOrdinal = ordinal;

        const beforeEnd =
          !segment.end || ordinal < segment.end.end_ordinal_exclusive;
        if (
          entry.type !== "session_meta" &&
          ordinal >= segment.startOrdinal &&
          beforeEnd
        ) {
          if (metrics) {
            metrics.parsedEntries += 1;
          }
          yield entry;
        }
      } else if (line.trim() && !terminated && !segment.end) {
        // Codex appends active rollout records before their final newline can
        // become visible to a concurrent reader. The detail cache retains the
        // same bytes and completes the record on its next incremental read.
        byteOffset = lineEndByteOffset;
        break;
      } else if (line.trim()) {
        throw new CodexRolloutLineageError(
          lineage.requestedSessionId,
          `rollout ${segment.rolloutId} contains malformed JSONL`,
        );
      }

      byteOffset = lineEndByteOffset;
      if (segment.end && byteOffset === segment.end.end_byte_offset) {
        reachedCutoff = true;
        break;
      }
    }

    if (!reachedCutoff) {
      throw new CodexRolloutLineageError(
        lineage.requestedSessionId,
        `cutoff byte offset is past rollout ${segment.rolloutId}`,
      );
    }
    if (
      segment.end &&
      previousOrdinal !== segment.end.end_ordinal_exclusive - 1
    ) {
      throw new CodexRolloutLineageError(
        lineage.requestedSessionId,
        `cutoff ordinal does not match rollout ${segment.rolloutId}`,
      );
    }
  }
}

export async function readCodexRolloutLineageEntries(
  lineage: CodexRolloutLineage,
): Promise<CodexLineageEntrySnapshot> {
  const metrics: CodexLineageReadMetrics = {
    lineCount: 0,
    parsedEntries: 0,
    maxLineLength: 0,
    parseMs: 0,
    bytesRead: 0,
  };
  const entries: CodexSessionEntry[] = [];
  for await (const entry of iterateCodexRolloutLineageEntries(
    lineage,
    metrics,
  )) {
    entries.push(entry);
  }
  return { entries, ...metrics };
}
