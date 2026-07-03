import type { DurableRecapMessage } from "@yep-anywhere/shared";
import type { SDKMessage } from "../sdk/types.js";
import type { Message, Session, SessionSummary } from "../supervisor/types.js";
import { formatAgentRecapExcerpt } from "./agent-excerpt.js";

const RECAP_DUPLICATE_WINDOW_MS = 5_000;

export function messageTimestampMs(message: {
  timestamp?: unknown;
}): number | null {
  if (typeof message.timestamp !== "string") {
    return null;
  }
  const ms = Date.parse(message.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

export function isAwaySummaryMessage(message: {
  type?: unknown;
  subtype?: unknown;
}): boolean {
  return message.type === "system" && message.subtype === "away_summary";
}

export function getSystemMessageText(message: {
  content?: unknown;
  message?: { content?: unknown };
}): string {
  const content = message.content ?? message.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const typed = block as { type?: unknown; text?: unknown };
      return typed.type === "text" && typeof typed.text === "string"
        ? typed.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function toDurableRecapMessage(
  message: SDKMessage,
  source: DurableRecapMessage["yaRecapSource"],
): DurableRecapMessage | null {
  if (!isAwaySummaryMessage(message)) {
    return null;
  }
  const content = getSystemMessageText(message).trim();
  if (!content) {
    return null;
  }
  const timestamp =
    typeof message.timestamp === "string"
      ? message.timestamp
      : new Date().toISOString();
  const uuid =
    typeof message.uuid === "string" && message.uuid
      ? message.uuid
      : `recap-${timestamp}-${content.slice(0, 32)}`;
  return {
    type: "system",
    subtype: "away_summary",
    content,
    timestamp,
    uuid,
    id: uuid,
    ...(typeof message.session_id === "string"
      ? { session_id: message.session_id }
      : {}),
    ...(typeof message.isMeta === "boolean" ? { isMeta: message.isMeta } : {}),
    ...(message.isSynthetic === true ? { isSynthetic: true } : {}),
    yaRecapSource: source,
  };
}

export function hasEquivalentRecapMessage(
  messages: readonly Message[],
  recap: DurableRecapMessage,
): boolean {
  const recapMs = messageTimestampMs(recap);
  return messages.some((message) => {
    if (message.uuid === recap.uuid || message.id === recap.uuid) {
      return true;
    }
    if (!isAwaySummaryMessage(message)) {
      return false;
    }
    if (getSystemMessageText(message).trim() !== recap.content) {
      return false;
    }
    const messageMs = messageTimestampMs(message);
    if (recapMs === null || messageMs === null) {
      return message.timestamp === recap.timestamp;
    }
    return Math.abs(messageMs - recapMs) <= RECAP_DUPLICATE_WINDOW_MS;
  });
}

export function mergeRecapMessages(
  messages: readonly Message[],
  recaps: readonly DurableRecapMessage[],
): Message[] {
  if (recaps.length === 0) {
    return [...messages];
  }

  const merged = [...messages];
  const sortedRecaps = [...recaps].sort(
    (a, b) => (messageTimestampMs(a) ?? 0) - (messageTimestampMs(b) ?? 0),
  );

  for (const recap of sortedRecaps) {
    if (hasEquivalentRecapMessage(merged, recap)) {
      continue;
    }
    const recapMs = messageTimestampMs(recap);
    let insertAt = merged.length;
    if (recapMs !== null) {
      const laterIndex = merged.findIndex((message) => {
        const messageMs = messageTimestampMs(message);
        return messageMs !== null && messageMs > recapMs;
      });
      if (laterIndex >= 0) {
        insertAt = laterIndex;
      }
    }
    merged.splice(insertAt, 0, recap as Message);
  }

  return merged;
}

export function latestRecapMessage(
  recaps: readonly DurableRecapMessage[],
): DurableRecapMessage | undefined {
  let latest: DurableRecapMessage | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const recap of recaps) {
    const recapMs = messageTimestampMs(recap);
    if (recapMs === null || recapMs < latestMs) {
      continue;
    }
    latest = recap;
    latestMs = recapMs;
  }
  return latest;
}

/**
 * Bump summary freshness (updatedAt/lastAgentText) to the latest recap.
 * The bump is display/order freshness only: unread computations must
 * compare lastSeen against the pre-overlay updatedAt, so a recap landing
 * never flips its session unread (recaps describe provider content, they
 * are not provider content).
 */
export function applyRecapOverlayToSummary<T extends SessionSummary>(
  summary: T,
  recaps: readonly DurableRecapMessage[],
): T {
  const latest = latestRecapMessage(recaps);
  if (!latest) {
    return summary;
  }
  const recapMs = messageTimestampMs(latest);
  const summaryMs = Date.parse(summary.updatedAt);
  if (
    recapMs === null ||
    (Number.isFinite(summaryMs) && recapMs <= summaryMs)
  ) {
    return summary;
  }

  const lastAgentText = formatAgentRecapExcerpt(latest.content);
  return {
    ...summary,
    updatedAt: latest.timestamp,
    ...(lastAgentText ? { lastAgentText } : {}),
  };
}

export function applyRecapOverlayToSession<T extends Session>(
  session: T,
  recaps: readonly DurableRecapMessage[],
): T {
  const summary = applyRecapOverlayToSummary(session, recaps);
  return {
    ...summary,
    messages: mergeRecapMessages(session.messages, recaps),
  };
}
