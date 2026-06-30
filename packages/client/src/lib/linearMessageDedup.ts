import type { Message } from "../types";
import { getMessageContent, mergeMessage } from "./mergeMessages";

// A human does not send two semantically identical turns within this window,
// so it is safe to treat same-fingerprint messages this close in time as the
// same message (a stream copy and its durable copy). Deliberately tight to
// minimize false merges; deterministic id matching (where available) carries
// the real load, this is only the backstop.
const DEFAULT_TIMESTAMP_WINDOW_MS = 2000;
const REPLAY_TIMESTAMP_WINDOW_MS = 2000;
// New-session startup can echo the opening user turn before the provider has
// finished creating/persisting the durable session. Keep the wider tolerance
// scoped to that one first user turn; later identical turns stay on the tight
// 2s backstop.
const FIRST_USER_TURN_TIMESTAMP_WINDOW_MS = 30000;
const MAX_SCAN_MESSAGES = 400;
const UPLOADED_FILES_MARKERS = [
  "\n\nUser uploaded files in .attachments:\n",
  "\n\nUser uploaded files:\n",
] as const;

interface ApproxDedupOptions {
  windowMs?: number;
  replayWindowMs?: number;
  firstUserTurnWindowMs?: number;
  excludeTools?: boolean;
}

const semanticFingerprintCache = new WeakMap<Message, string | null>();
const visibleUserTurnFingerprintCache = new WeakMap<Message, string | null>();

function getMessageRole(message: Message): string {
  const nestedRole = (message.message as { role?: unknown } | undefined)?.role;
  if (nestedRole === "user" || nestedRole === "assistant") {
    return nestedRole;
  }
  if (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "system"
  ) {
    return message.role;
  }
  return "unknown";
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(",")}}`;
  }
  return String(value);
}

function normalizeContentBlock(block: unknown): string {
  if (typeof block === "string") {
    return `text:${block}`;
  }

  if (!block || typeof block !== "object") {
    return "";
  }

  const typedBlock = block as Record<string, unknown>;
  const type =
    typeof typedBlock.type === "string" ? typedBlock.type : "unknown";

  switch (type) {
    case "text":
    case "output_text":
      return `text:${typeof typedBlock.text === "string" ? typedBlock.text : ""}`;

    case "thinking":
      return `thinking:${typeof typedBlock.thinking === "string" ? typedBlock.thinking : ""}`;

    case "tool_use":
      return `tool_use:${typeof typedBlock.id === "string" ? typedBlock.id : ""}:${typeof typedBlock.name === "string" ? typedBlock.name : ""}:${stableStringify(typedBlock.input)}`;

    case "tool_result":
      return `tool_result:${typeof typedBlock.tool_use_id === "string" ? typedBlock.tool_use_id : ""}:${typedBlock.is_error === true ? "1" : "0"}:${typeof typedBlock.content === "string" ? typedBlock.content : stableStringify(typedBlock.content)}`;

    default:
      return `${type}:${stableStringify(typedBlock)}`;
  }
}

function isReplayMessage(message: Message): boolean {
  return message.isReplay === true;
}

// A message that carries a tool_use or tool_result block. These dedup by a
// deterministic id (Codex call_id) upstream in mergeMessages, so the
// content+timestamp backstop is redundant for them; callers can opt to exclude
// them so legitimately-recurring identical tool calls are never approx-merged.
function isToolMessage(message: Message): boolean {
  const content = getMessageContent(message);
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "tool_use" || type === "tool_result";
  });
}

function isPlainUserTurn(message: Message): boolean {
  return (
    message.type === "user" &&
    getMessageRole(message) === "user" &&
    !isToolMessage(message)
  );
}

function hasEarlierPlainUserTurn(
  messages: Message[],
  beforeIndex: number,
): boolean {
  for (let i = 0; i < beforeIndex; i += 1) {
    const message = messages[i];
    if (message && isPlainUserTurn(message)) {
      return true;
    }
  }
  return false;
}

function hasEarlierPlainUserEntry(
  entries: IndexedMessage[],
  beforeIndex: number,
): boolean {
  for (let i = 0; i < beforeIndex; i += 1) {
    const entry = entries[i];
    if (entry && isPlainUserTurn(entry.message)) {
      return true;
    }
  }
  return false;
}

function getAllowedTimestampDeltaMs(
  a: Message,
  b: Message,
  options: Required<Pick<ApproxDedupOptions, "windowMs" | "replayWindowMs">> &
    Pick<ApproxDedupOptions, "firstUserTurnWindowMs">,
  isFirstUserTurnPair: boolean,
): number {
  if (isFirstUserTurnPair) {
    return options.firstUserTurnWindowMs ?? FIRST_USER_TURN_TIMESTAMP_WINDOW_MS;
  }
  return isReplayMessage(a) || isReplayMessage(b)
    ? options.replayWindowMs
    : options.windowMs;
}

function getSemanticFingerprint(message: Message): string | null {
  const cached = semanticFingerprintCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  const content = getMessageContent(message);

  let normalizedContent: string;
  if (typeof content === "string") {
    normalizedContent = `text:${content}`;
  } else if (Array.isArray(content)) {
    normalizedContent = content.map(normalizeContentBlock).join("|");
  } else {
    semanticFingerprintCache.set(message, null);
    return null;
  }

  if (!normalizedContent.trim()) {
    semanticFingerprintCache.set(message, null);
    return null;
  }

  const type = typeof message.type === "string" ? message.type : "unknown";
  const role = getMessageRole(message);
  const fingerprint = `${type}|${role}|${normalizedContent}`;
  semanticFingerprintCache.set(message, fingerprint);
  return fingerprint;
}

function getTextContent(message: Message): string | null {
  const content = getMessageContent(message);
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const typedBlock = block as { type?: unknown; text?: unknown };
      const type = typeof typedBlock.type === "string" ? typedBlock.type : "";
      if (type !== "text" && type !== "output_text" && type !== "input_text") {
        return "";
      }
      return typeof typedBlock.text === "string" ? typedBlock.text : "";
    })
    .filter((text) => text.length > 0);

  return textParts.length > 0 ? textParts.join("\n") : null;
}

function splitUploadedFilesSection(text: string): {
  text: string;
  attachmentPaths: string[];
} {
  const markerIndex = UPLOADED_FILES_MARKERS.map((marker) => ({
    marker,
    index: text.indexOf(marker),
  }))
    .filter(({ index }) => index !== -1)
    .sort((a, b) => a.index - b.index)[0];

  if (!markerIndex) {
    return { text, attachmentPaths: [] };
  }

  const visibleText = text.slice(0, markerIndex.index);
  const uploadSection = text.slice(
    markerIndex.index + markerIndex.marker.length,
  );
  const markdownRegex = /^- \[(?:.+?)\]\((?:<(.+?)>|(.+?))\) \((?:[^)]*)\)$/;
  const legacyRegex = /^- .+? \([^)]+\): (.+)$/;
  const attachmentPaths: string[] = [];

  for (const line of uploadSection.split("\n")) {
    const trimmed = line.trim();
    const markdownMatch = trimmed.match(markdownRegex);
    if (markdownMatch) {
      attachmentPaths.push(markdownMatch[1] ?? markdownMatch[2] ?? "");
      continue;
    }
    const legacyMatch = trimmed.match(legacyRegex);
    if (legacyMatch) {
      attachmentPaths.push(legacyMatch[1] ?? "");
    }
  }

  return {
    text: visibleText,
    attachmentPaths: attachmentPaths.filter((path) => path.trim().length > 0),
  };
}

function extractAttachmentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return "";
      }
      const path = (attachment as { path?: unknown }).path;
      if (typeof path === "string" && path.trim().length > 0) {
        return path;
      }
      const id = (attachment as { id?: unknown }).id;
      return typeof id === "string" ? id : "";
    })
    .filter((path) => path.trim().length > 0);
}

function normalizeVisibleText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function getVisibleUserTurnFingerprint(message: Message): string | null {
  const cached = visibleUserTurnFingerprintCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  if (!isPlainUserTurn(message)) {
    visibleUserTurnFingerprintCache.set(message, null);
    return null;
  }

  const text = getTextContent(message);
  if (text === null) {
    visibleUserTurnFingerprintCache.set(message, null);
    return null;
  }

  const split = splitUploadedFilesSection(text);
  const attachmentPaths = new Set<string>([
    ...split.attachmentPaths,
    ...extractAttachmentPaths(
      (message as { attachments?: unknown }).attachments,
    ),
    ...extractAttachmentPaths(
      (message.message as { attachments?: unknown } | undefined)?.attachments,
    ),
  ]);
  const normalizedText = normalizeVisibleText(split.text);
  if (attachmentPaths.size === 0) {
    visibleUserTurnFingerprintCache.set(message, null);
    return null;
  }

  const fingerprint = `visible-user|${normalizedText}|attachments:${Array.from(
    attachmentPaths,
  )
    .sort()
    .join("|")}`;
  visibleUserTurnFingerprintCache.set(message, fingerprint);
  return fingerprint;
}

export function getMessageTimestampMs(message: Message): number | null {
  if (typeof message.timestamp !== "string") {
    return null;
  }
  const ms = Date.parse(message.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

export function hasEquivalentJsonlMessage(
  existing: Message[],
  incoming: Message,
  options?: ApproxDedupOptions,
): boolean {
  if (options?.excludeTools && isToolMessage(incoming)) {
    return false;
  }
  const incomingFingerprint = getSemanticFingerprint(incoming);
  const incomingTimestampMs = getMessageTimestampMs(incoming);
  if (!incomingFingerprint || incomingTimestampMs === null) {
    return false;
  }

  const windowMs = options?.windowMs ?? DEFAULT_TIMESTAMP_WINDOW_MS;
  const replayWindowMs = options?.replayWindowMs ?? REPLAY_TIMESTAMP_WINDOW_MS;
  const firstUserTurnWindowMs =
    options?.firstUserTurnWindowMs ?? FIRST_USER_TURN_TIMESTAMP_WINDOW_MS;
  const maxScan = MAX_SCAN_MESSAGES;
  const startIndex = Math.max(0, existing.length - maxScan);

  for (let i = existing.length - 1; i >= startIndex; i -= 1) {
    const candidate = existing[i];
    if (candidate?._source !== "jsonl") {
      continue;
    }
    const candidateTimestampMs = getMessageTimestampMs(candidate);
    if (candidateTimestampMs === null) {
      continue;
    }
    const isFirstUserTurnPair =
      isPlainUserTurn(candidate) &&
      isPlainUserTurn(incoming) &&
      !hasEarlierPlainUserTurn(existing, i);
    const semanticMatches =
      getSemanticFingerprint(candidate) === incomingFingerprint;
    const candidateVisibleFingerprint =
      getVisibleUserTurnFingerprint(candidate);
    const visibleUserTurnMatches =
      isFirstUserTurnPair &&
      candidateVisibleFingerprint !== null &&
      candidateVisibleFingerprint === getVisibleUserTurnFingerprint(incoming);
    if (!semanticMatches && !visibleUserTurnMatches) {
      continue;
    }
    const allowedDeltaMs = getAllowedTimestampDeltaMs(
      candidate,
      incoming,
      { windowMs, replayWindowMs, firstUserTurnWindowMs },
      isFirstUserTurnPair,
    );
    if (
      Math.abs(candidateTimestampMs - incomingTimestampMs) <= allowedDeltaMs
    ) {
      return true;
    }
  }

  return false;
}

interface IndexedMessage {
  message: Message;
  originalIndex: number;
  timestampMs: number | null;
  fingerprint: string | null;
  visibleUserTurnFingerprint: string | null;
}

export function reconcileLinearMessages(
  messages: Message[],
  options?: ApproxDedupOptions,
): Message[] {
  const windowMs = options?.windowMs ?? DEFAULT_TIMESTAMP_WINDOW_MS;
  const replayWindowMs = options?.replayWindowMs ?? REPLAY_TIMESTAMP_WINDOW_MS;
  const firstUserTurnWindowMs =
    options?.firstUserTurnWindowMs ?? FIRST_USER_TURN_TIMESTAMP_WINDOW_MS;
  const maxCandidateWindowMs = Math.max(
    windowMs,
    replayWindowMs,
    firstUserTurnWindowMs,
  );
  const excludeTools = options?.excludeTools === true;

  const sorted = messages
    .map(
      (message, originalIndex): IndexedMessage => ({
        message,
        originalIndex,
        timestampMs: getMessageTimestampMs(message),
        fingerprint: getSemanticFingerprint(message),
        visibleUserTurnFingerprint: getVisibleUserTurnFingerprint(message),
      }),
    )
    .sort((a, b) => {
      if (a.timestampMs === null && b.timestampMs === null) {
        return a.originalIndex - b.originalIndex;
      }
      if (a.timestampMs === null) return 1;
      if (b.timestampMs === null) return -1;
      if (a.timestampMs !== b.timestampMs) {
        return a.timestampMs - b.timestampMs;
      }
      return a.originalIndex - b.originalIndex;
    });

  const kept: IndexedMessage[] = [];

  for (const entry of sorted) {
    let merged = false;

    if (
      entry.fingerprint &&
      entry.timestampMs !== null &&
      !(excludeTools && isToolMessage(entry.message))
    ) {
      for (let i = kept.length - 1; i >= 0; i -= 1) {
        const candidate = kept[i];
        if (!candidate) {
          continue;
        }
        if (candidate.timestampMs === null) {
          continue;
        }
        if (entry.timestampMs - candidate.timestampMs > maxCandidateWindowMs) {
          break;
        }
        const isFirstUserTurnPair =
          isPlainUserTurn(candidate.message) &&
          isPlainUserTurn(entry.message) &&
          !hasEarlierPlainUserEntry(kept, i);
        const semanticMatches = candidate.fingerprint === entry.fingerprint;
        const visibleUserTurnMatches =
          isFirstUserTurnPair &&
          candidate.visibleUserTurnFingerprint !== null &&
          candidate.visibleUserTurnFingerprint ===
            entry.visibleUserTurnFingerprint;
        if (!semanticMatches && !visibleUserTurnMatches) continue;
        const candidateSource = candidate.message._source;
        const entrySource = entry.message._source;
        const sameSource = candidateSource === entrySource;
        const canMergeDifferentSources =
          candidateSource !== undefined &&
          entrySource !== undefined &&
          !sameSource;
        const canMergeStartupLiveSources =
          visibleUserTurnMatches && sameSource && candidateSource === "sdk";
        const canMergeSameSource =
          sameSource &&
          candidateSource !== undefined &&
          (candidate.timestampMs === entry.timestampMs ||
            canMergeStartupLiveSources);
        if (!canMergeDifferentSources && !canMergeSameSource) {
          continue;
        }
        const mergeSource = entrySource ?? candidateSource;
        if (!mergeSource) {
          continue;
        }
        const allowedDeltaMs = getAllowedTimestampDeltaMs(
          candidate.message,
          entry.message,
          { windowMs, replayWindowMs, firstUserTurnWindowMs },
          isFirstUserTurnPair,
        );
        if (entry.timestampMs - candidate.timestampMs > allowedDeltaMs) {
          continue;
        }

        candidate.message = mergeMessage(
          candidate.message,
          entry.message,
          mergeSource,
        );
        candidate.timestampMs =
          getMessageTimestampMs(candidate.message) ?? candidate.timestampMs;
        candidate.fingerprint = getSemanticFingerprint(candidate.message);
        candidate.visibleUserTurnFingerprint = getVisibleUserTurnFingerprint(
          candidate.message,
        );
        merged = true;
        break;
      }
    }

    if (!merged) {
      kept.push(entry);
    }
  }

  return kept.map((entry) => entry.message);
}
