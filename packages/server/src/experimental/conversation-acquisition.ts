import { createHash } from "node:crypto";
import { normalizeCodexToolOutputWithContext } from "../codex/normalization.js";
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  parseCodexSessionEntry,
  type ClaudeSessionEntry,
  type CodexSessionEntry,
} from "@yep-anywhere/shared";
import {
  resolveCodexRolloutLineage,
  type ResolveCodexRolloutPath,
} from "../sessions/codex-rollout-lineage.js";
import {
  normalizeConversationEntries,
  tagCodexEntrySourceByteOffset,
} from "../sessions/normalization.js";
import {
  MAX_PROJECTION_INPUT_BYTES,
  MAX_PROJECTION_RECORDS,
  type ConversationInput,
} from "./conversation-projection.js";

export const MAX_CONVERSATION_RECORD_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 256 * 1024 * 1024;
const MAX_NATIVE_RECORDS = 100_000;
const MAX_DETAIL_TEXT = 4096;
type Native = ClaudeSessionEntry | CodexSessionEntry;
export interface ConversationReadOptions {
  path: string;
  provider: "claude" | "codex";
  sessionId: string;
  signal: AbortSignal;
  resolveRolloutPath?: ResolveCodexRolloutPath;
  metrics?: {
    /** JSONL body scan bytes. Header discovery is owned by the lineage resolver. */
    bytesRead: number;
    parsedRecords: number;
    retainedBytes: number;
    cacheHit: boolean;
    validationBytesRead?: number;
  };
}
interface Cached {
  digest: string;
  stats: Stats;
  offset: number;
  probe: Buffer;
  entries: Native[];
  bytes: number;
  records: number;
}

/** Bound incidental provider detail before retaining it. Prose remains exact.
 * Successful tool bodies/thinking are not part of the compact wire view;
 * preserve tool identity, structured failure facts and bounded head/tail text.
 */
function boundedDetails(value: unknown): unknown {
  if (typeof value === "string")
    return value.length <= MAX_DETAIL_TEXT
      ? value
      : `${value.slice(0, MAX_DETAIL_TEXT / 2)}\n[detail omitted]\n${value.slice(-MAX_DETAIL_TEXT / 2)}`;
  if (Array.isArray(value)) return value.map(boundedDetails);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, boundedDetails(item)]),
    );
  return value;
}
function retain(
  entry: Record<string, unknown>,
  provider: "claude" | "codex",
): Native | undefined {
  if (provider === "codex") {
    if (
      !["session_meta", "compacted", "response_item", "event_msg"].includes(
        String(entry.type),
      )
    )
      return;

    const payload = entry.payload as Record<string, unknown> | undefined;
    if (
      entry.type === "response_item" &&
      (payload?.type === "function_call_output" ||
        payload?.type === "custom_tool_call_output")
    ) {
      // Preserve JSON structure, including the optional shell envelope. Native
      // normalization may need nested exit codes with the matching call context.
      // Unknown output formats stay exact rather than being reinterpreted here.
      const original = payload.output;
      const marker = "\nOutput:\n";
      const at = typeof original === "string" ? original.indexOf(marker) : -1;
      const prefix =
        typeof original === "string" && at >= 0
          ? original.slice(0, at + marker.length)
          : "";
      try {
        const parsed: unknown =
          typeof original === "string"
            ? JSON.parse(original.slice(prefix.length))
            : original;
        const bounded = boundedDetails(parsed);
        const output =
          typeof original === "string"
            ? prefix + JSON.stringify(bounded)
            : bounded;
        // Verify failure/exit evidence under native classifications that inspect
        // nested unified-exec chunks; uncertain shortening remains exact.
        const contexts = [
          undefined,
          { toolName: "Bash", input: {} },
          { toolName: "WriteStdin", input: {} },
        ];
        const facts = (value: unknown) =>
          contexts.map((context) => {
            const normalized = normalizeCodexToolOutputWithContext(
              value,
              context,
            );
            const structured = normalized.structured as
              | { exitCode?: number; interrupted?: boolean }
              | undefined;
            return [
              normalized.isError,
              structured?.exitCode,
              structured?.interrupted,
            ];
          });
        const safe =
          JSON.stringify(facts(original)) === JSON.stringify(facts(output));
        return (
          parseCodexSessionEntry(
            JSON.stringify({
              ...entry,
              payload: { ...payload, output: safe ? output : original },
            }),
          ) ?? undefined
        );
      } catch {
        return parseCodexSessionEntry(JSON.stringify(entry)) ?? undefined;
      }
    }
    if (
      entry.type === "event_msg" &&
      payload &&
      ![
        "user_message",
        "agent_message",
        "task_started",
        "task_complete",
        "turn_aborted",
        "sub_agent_activity",
        "context_compacted",
        "exec_command_end",
        "patch_apply_end",
        "mcp_tool_call_end",
        "item_completed",
        "token_count",
      ].includes(String(payload.type))
    )
      return;
    if (entry.type === "event_msg" && payload?.type === "item_completed") {
      const item = payload.item as Record<string, unknown> | undefined;
      if (
        item?.type === "UserMessage" ||
        (item?.type === "AgentMessage" && item.delivery === "async")
      )
        return parseCodexSessionEntry(JSON.stringify(entry)) ?? undefined;
      if (item?.type !== "CommandExecution") return;
      entry = {
        ...entry,
        payload: {
          ...payload,
          item: {
            type: item.type,
            id: item.id,
            status: item.status,
            parsed_cmd: item.parsed_cmd,
            exit_code: item.exit_code,
          },
        },
      };
    }
    if (entry.type === "response_item" && payload?.type === "reasoning")
      entry = {
        ...entry,
        payload: { ...payload, encrypted_content: undefined },
      };

    if (
      entry.type === "response_item" &&
      payload &&
      !["message", "function_call", "custom_tool_call"].includes(
        String(payload.type),
      )
    )
      entry = { ...entry, payload: boundedDetails(entry.payload) };
    if (
      entry.type === "event_msg" &&
      payload &&
      ![
        "user_message",
        "agent_message",
        "task_complete",
        "context_compacted",
      ].includes(String(payload.type))
    )
      entry = { ...entry, payload: boundedDetails(entry.payload) };
    return parseCodexSessionEntry(JSON.stringify(entry)) ?? undefined;
  }
  // Preserve branch connectors and queued/user prose without alteration.
  if (
    entry.type !== "user" &&
    entry.type !== "assistant" &&
    entry.type !== "system"
  )
    return entry as ClaudeSessionEntry;
  const message = entry.message as Record<string, unknown> | undefined;
  if (message && Array.isArray(message.content))
    entry = {
      ...entry,
      message: {
        ...message,
        content: message.content.map((block: Record<string, unknown>) =>
          ["thinking", "redacted_thinking"].includes(String(block.type))
            ? boundedDetails(block)
            : block.type === "tool_result" &&
                block.is_error !== true &&
                typeof block.content === "string" &&
                !normalizeCodexToolOutputWithContext(block.content).isError &&
                !block.content.includes("_acli")
              ? { ...block, content: boundedDetails(block.content) }
              : block,
        ),
      },
    };
  return entry as ClaudeSessionEntry;
}
async function probe(
  file: FileHandle,
  offset: number,
  metrics?: ConversationReadOptions["metrics"],
) {
  const bytes = Buffer.alloc(Math.min(256, offset));
  const read = await file.read(bytes, 0, bytes.length, offset - bytes.length);
  if (metrics)
    metrics.validationBytesRead =
      (metrics.validationBytesRead ?? 0) + read.bytesRead;
  return bytes;
}

/** Four keyed files, 16 MiB retained in total; no watchers or maintenance loop.
 * Cold acquisition scans at most 256 MiB in 64 KiB chunks; warm reads use file
 * identity and append-prefix hashing, retaining only bounded native detail.
 * Growing files hash the old committed prefix before reusing parsed records;
 * unchanged files use generation facts and a small boundary probe.
 */
export class ConversationAcquisition {
  private cache = new Map<string, Cached>();
  private inFlight = new Set<string>();
  // At most 128 cancellable waiters, matching the observation consumer ceiling.
  private waiters = new Set<{ path: string; start: () => void }>();
  private generation = 0;
  private async acquire(path: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.waiters.size >= 128)
      throw new Error("Conversation acquisition capacity reached");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.waiters.delete(waiter);
        reject(signal.reason);
      };
      const waiter = {
        path,
        start: () => {
          this.waiters.delete(waiter);
          signal.removeEventListener("abort", abort);
          this.inFlight.add(path);
          resolve();
        },
      };
      signal.addEventListener("abort", abort, { once: true });
      this.waiters.add(waiter);
      this.dispatch();
    });
  }
  private dispatch() {
    for (const waiter of this.waiters) {
      if (this.inFlight.size >= 4) break;
      if (!this.inFlight.has(waiter.path)) waiter.start();
    }
  }
  clear() {
    this.generation++;
    this.cache.clear();
  }
  async read(options: ConversationReadOptions): Promise<ConversationInput> {
    options.signal.throwIfAborted();
    await this.acquire(options.path, options.signal);
    const generation = this.generation;
    const metrics = options.metrics;
    if (metrics)
      Object.assign(metrics, {
        bytesRead: 0,
        parsedRecords: 0,
        retainedBytes: 0,
        cacheHit: false,
        validationBytesRead: 0,
      });
    try {
      const versions = new Map<string, Stats>([
        [options.path, await stat(options.path)],
      ]);
      let segments: {
        path: string;
        end?: number;
        startOrdinal?: number;
        endOrdinal?: number;
      }[] = [{ path: options.path }];
      if (options.provider === "codex") {
        const lineage = await resolveCodexRolloutLineage({
          requestedSessionId: options.sessionId,
          leafFilePath: options.path,
          resolveRolloutPath: async (id) => {
            const path = await options.resolveRolloutPath?.(id);
            if (path) versions.set(path, await stat(path));
            return path ?? null;
          },
          maxSegments: 32,
          signal: options.signal,
        });
        if (lineage.referenceBacked)
          segments = lineage.segments.map((segment) => ({
            path: segment.filePath,
            end: segment.end?.end_byte_offset,
            startOrdinal: segment.startOrdinal,
            endOrdinal: segment.end?.end_ordinal_exclusive,
          }));
      }
      let all: Native[] = [];
      let complete = true;
      let totalBytes = 0;
      let scanBytes = 0;
      let totalRecords = 0;
      for (const segment of segments) {
        options.signal.throwIfAborted();
        const file = await open(segment.path, "r");
        try {
          const before = await file.stat();
          const expected = versions.get(segment.path);
          if (
            !expected ||
            expected.ino !== before.ino ||
            expected.dev !== before.dev ||
            expected.size !== before.size ||
            expected.mtimeMs !== before.mtimeMs ||
            expected.ctimeMs !== before.ctimeMs
          )
            throw new Error("Conversation lineage changed during acquisition");
          if (!before.isFile() || before.size > MAX_SCAN_BYTES)
            throw new Error(
              "Conversation acquisition exceeds the scan byte budget",
            );
          const end = segment.end ?? before.size;
          scanBytes += end;
          if (scanBytes > MAX_SCAN_BYTES)
            throw new Error(
              "Conversation lineage exceeds the scan byte budget",
            );
          if (end > before.size)
            throw new Error("Invalid conversation lineage cutoff");
          const key = JSON.stringify([
            options.provider,
            options.sessionId,
            segment.path,
            end === before.size ? null : end,
          ]);
          let previous = this.cache.get(key);
          if (
            previous &&
            (previous.stats.ino !== before.ino ||
              previous.stats.dev !== before.dev ||
              before.size < previous.stats.size ||
              (before.size === previous.stats.size &&
                (before.mtimeMs !== previous.stats.mtimeMs ||
                  before.ctimeMs !== previous.stats.ctimeMs)) ||
              !(await probe(file, previous.offset, metrics)).equals(
                previous.probe,
              ))
          )
            previous = undefined;
          let hasher = createHash("sha256");
          if (previous && before.size > previous.stats.size) {
            let position = 0;
            while (position < previous.offset) {
              options.signal.throwIfAborted();
              const block = Buffer.alloc(
                Math.min(64 * 1024, previous.offset - position),
              );
              const read = await file.read(block, 0, block.length, position);
              if (!read.bytesRead)
                throw new Error("Conversation changed during acquisition");
              hasher.update(block.subarray(0, read.bytesRead));
              position += read.bytesRead;
              if (metrics)
                metrics.validationBytesRead =
                  (metrics.validationBytesRead ?? 0) + read.bytesRead;
            }
            if (hasher.copy().digest("hex") !== previous.digest) {
              previous = undefined;
              hasher = createHash("sha256");
            }
          }
          const entries = previous ? [...previous.entries] : [];
          let bytes = previous?.bytes ?? 0;
          let records = previous?.records ?? 0;
          let offset = previous?.offset ?? 0;
          let lineStart = offset;
          let carry = Buffer.alloc(0);
          let ordinal: number | undefined;
          if (metrics) metrics.cacheHit = Boolean(previous);
          while (offset < end) {
            options.signal.throwIfAborted();
            const chunk = Buffer.alloc(Math.min(64 * 1024, end - offset));
            const read = await file.read(chunk, 0, chunk.length, offset);
            if (!read.bytesRead)
              throw new Error("Conversation changed during acquisition");
            if (metrics) metrics.bytesRead += read.bytesRead;
            let start = 0;
            for (;;) {
              const newline = chunk.indexOf(10, start);
              const stop = newline < 0 ? read.bytesRead : newline;
              if (carry.length + stop - start > MAX_CONVERSATION_RECORD_BYTES)
                throw new Error(
                  "Conversation acquisition exceeds the record budget",
                );
              carry = Buffer.concat([carry, chunk.subarray(start, stop)]);
              if (newline < 0) break;
              if (
                ++records > MAX_NATIVE_RECORDS ||
                ++totalRecords > MAX_NATIVE_RECORDS
              )
                throw new Error(
                  "Conversation acquisition exceeds the record budget",
                );
              hasher.update(carry).update("\n");
              const text = carry.toString("utf8").trim();
              if (text) {
                const raw = JSON.parse(text) as Record<string, unknown>;
                if (
                  !raw ||
                  typeof raw !== "object" ||
                  typeof raw.type !== "string"
                )
                  throw new Error("Unreadable conversation record");
                if (segment.startOrdinal !== undefined) {
                  const next = Number(raw.ordinal);
                  if (
                    !Number.isSafeInteger(next) ||
                    (ordinal !== undefined && next !== ordinal + 1)
                  )
                    throw new Error("Invalid conversation lineage ordinal");
                  ordinal = next;
                }
                if (
                  segment.startOrdinal === undefined ||
                  (Number(raw.ordinal) >= segment.startOrdinal &&
                    raw.type !== "session_meta")
                ) {
                  const value = retain(raw, options.provider);
                  if (value) {
                    bytes += Buffer.byteLength(JSON.stringify(value));
                    if (
                      bytes > MAX_PROJECTION_INPUT_BYTES ||
                      entries.length >= MAX_PROJECTION_RECORDS
                    )
                      throw new Error(
                        "Conversation retained input exceeds the byte or record budget",
                      );
                    entries.push(
                      options.provider === "codex"
                        ? tagCodexEntrySourceByteOffset(
                            value as CodexSessionEntry,
                            lineStart,
                          )
                        : value,
                    );
                  }
                }
                if (metrics) metrics.parsedRecords++;
              }
              lineStart = offset + newline + 1;
              carry = Buffer.alloc(0);
              start = newline + 1;
              if (start === read.bytesRead) break;
            }
            offset += read.bytesRead;
          }
          const after = await file.stat();
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
          )
            throw new Error("Conversation changed during acquisition");
          if (
            segment.end !== undefined &&
            (carry.length ||
              (segment.endOrdinal !== undefined &&
                ordinal !== segment.endOrdinal - 1))
          )
            throw new Error("Invalid conversation lineage cutoff");
          complete &&= carry.length === 0;
          totalBytes += bytes;
          if (totalBytes > MAX_PROJECTION_INPUT_BYTES)
            throw new Error(
              "Conversation retained input exceeds the byte budget",
            );
          all = all.concat(entries);
          // Frozen lineage segments are small but not cached against append;
          // ordinary single-file sessions get exact warm/incremental reuse.
          if (segments.length === 1 && generation === this.generation) {
            this.cache.delete(key);
            this.cache.set(key, {
              digest:
                previous && before.size === previous.stats.size
                  ? previous.digest
                  : hasher.copy().digest("hex"),
              stats: after,
              offset: lineStart,
              probe: await probe(file, lineStart, metrics),
              entries,
              bytes,
              records,
            });
            while (
              this.cache.size > 4 ||
              [...this.cache.values()].reduce(
                (sum, item) => sum + item.bytes,
                0,
              ) >
                16 * 1024 * 1024
            )
              this.cache.delete(this.cache.keys().next().value!);
          }
        } finally {
          await file.close();
        }
      }
      if (metrics) metrics.retainedBytes = totalBytes;
      options.signal.throwIfAborted();
      return {
        sessionId: options.sessionId,
        messages: normalizeConversationEntries(
          options.provider === "claude"
            ? { provider: "claude", entries: all as ClaudeSessionEntry[] }
            : { provider: "codex", entries: all as CodexSessionEntry[] },
          options.sessionId,
        ) as ConversationInput["messages"],
        activity: "unknown",
        pendingRequests: [],
        sourceCoverage: { complete, earlierOutsideScope: "no" },
      };
    } finally {
      this.inFlight.delete(options.path);
      this.dispatch();
    }
  }
}
