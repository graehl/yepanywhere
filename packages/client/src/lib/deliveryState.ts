import type { Message } from "../types";

/**
 * Delivery state of a self-sent user turn, derived from message provenance:
 * an optimistic echo is `_source: "sdk"` until its durable transcript copy
 * merges in (by uuid for direct sends, by the queue-operation pairing for
 * Claude busy sends — see topics/stream-durable-id-dedup.md), which flips the
 * backing message to `_source: "jsonl"`. "sent" therefore means the server
 * accepted the message but it is not yet proven in the durable transcript —
 * exactly the copy a process kill could lose. "confirmed" means it is.
 */
export type UserPromptDeliveryState = "sent" | "confirmed";

function isSelfSendEcho(message: Message): boolean {
  if (message.type !== "user") {
    return false;
  }
  const tempId = (message as { tempId?: unknown }).tempId;
  const metadata = (message as { messageMetadata?: unknown }).messageMetadata;
  // Only YA's own optimistic echoes carry tempId/messageMetadata; provider
  // stream echoes (e.g. Codex thread items) do not and stay unmarked.
  return typeof tempId === "string" || metadata !== undefined;
}

export function isUnconfirmedSelfSend(message: Message): boolean {
  return (message._source ?? "sdk") !== "jsonl" && isSelfSendEcho(message);
}

function getMessageTempId(message: Message): string | null {
  const tempId = (message as { tempId?: unknown }).tempId;
  return typeof tempId === "string" && tempId ? tempId : null;
}

function getMessageDeliveryIntent(message: Message): string | null {
  const metadata = (message as { messageMetadata?: unknown }).messageMetadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const deliveryIntent = (metadata as { deliveryIntent?: unknown })
    .deliveryIntent;
  return typeof deliveryIntent === "string" ? deliveryIntent : null;
}

export function getUserPromptDeliveryState(
  sourceMessages: readonly Message[],
): UserPromptDeliveryState {
  const unconfirmed =
    sourceMessages.length > 0 &&
    sourceMessages.every((message) => isUnconfirmedSelfSend(message));
  return unconfirmed ? "sent" : "confirmed";
}

export function getCancellableUnconfirmedSteerTempId(
  sourceMessages: readonly Message[],
): string | null {
  if (
    sourceMessages.length === 0 ||
    !sourceMessages.every((message) => isUnconfirmedSelfSend(message))
  ) {
    return null;
  }

  let tempId: string | null = null;
  for (const message of sourceMessages) {
    if (getMessageDeliveryIntent(message) !== "steer") {
      return null;
    }
    const messageTempId = getMessageTempId(message);
    if (!messageTempId) {
      return null;
    }
    tempId ??= messageTempId;
    if (messageTempId !== tempId) {
      return null;
    }
  }

  return tempId;
}

const UNCONFIRMED_SCAN_LIMIT = 200;

/** Bounded tail scan used to gate mid-turn durable fetches. */
export function hasUnconfirmedSelfSends(messages: readonly Message[]): boolean {
  const start = Math.max(0, messages.length - UNCONFIRMED_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i -= 1) {
    const message = messages[i];
    if (message && isUnconfirmedSelfSend(message)) {
      return true;
    }
  }
  return false;
}
