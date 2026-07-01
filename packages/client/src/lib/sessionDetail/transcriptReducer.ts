import {
  getMessageTimestampMs,
  hasEquivalentJsonlMessage,
  reconcileLinearMessages,
} from "../linearMessageDedup";
import {
  getMessageId,
  mergeJSONLMessages,
  mergeStreamMessage,
} from "../mergeMessages";
import { getProvider } from "../../providers/registry";
import type { Message } from "../../types";
import type { SessionDetailAction, SessionDetailState } from "./types";

export function createInitialSessionDetailState(): SessionDetailState {
  return {
    messages: [],
    session: null,
    agentContent: {},
    markdownAugments: {},
    toolUseToAgentEntries: [],
    maxPersistedTimestampMs: Number.NEGATIVE_INFINITY,
    deferredMessages: [],
  };
}

function usesApproxMessageDedup(provider?: string): boolean {
  return getProvider(provider).capabilities.needsApproxMessageDedup;
}

function approxDedupOptions(provider?: string): { excludeTools: boolean } {
  return {
    excludeTools:
      getProvider(provider).capabilities.approxDedupExcludesTools === true,
  };
}

function isDurableRecapOverlay(message: Message): boolean {
  return typeof message.yaRecapSource === "string";
}

export function findLastJsonlMessageId(
  messages: readonly Message[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message &&
      (message._source ?? "sdk") === "jsonl" &&
      !isDurableRecapOverlay(message)
    ) {
      return getMessageId(message);
    }
  }
  return undefined;
}

function updatePersistedTimestampWatermark(
  current: number,
  persistedMessages: readonly Message[],
): number {
  let maxMs = current;
  for (const message of persistedMessages) {
    if (isDurableRecapOverlay(message)) {
      continue;
    }
    const timestampMs = getMessageTimestampMs(message);
    if (timestampMs !== null && timestampMs > maxMs) {
      maxMs = timestampMs;
    }
  }
  return maxMs;
}

export function tagJsonlMessages(messages: readonly Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    _source: "jsonl" as const,
  }));
}

function mergePersistedMessagesForProvider(
  baseMessages: Message[],
  taggedMessages: Message[],
  provider: string | undefined,
): Message[] {
  const result = mergeJSONLMessages(baseMessages, taggedMessages, {
    skipDagOrdering: !getProvider(provider).capabilities.supportsDag,
  });
  return usesApproxMessageDedup(provider)
    ? reconcileLinearMessages(result.messages, approxDedupOptions(provider))
    : result.messages;
}

function clearStreamingMessages(messages: Message[]): Message[] {
  const filtered = messages.filter((message) => !message._isStreaming);
  return filtered.length === messages.length ? messages : filtered;
}

function isEmptyAssistantContent(message: Message): boolean {
  if (message.type !== "assistant") {
    return false;
  }

  const content = message.message?.content;
  if (typeof content === "string") {
    return content.trim().length === 0;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.every((block) => {
    if (!block || typeof block !== "object") {
      return true;
    }

    const typedBlock = block as Record<string, unknown>;
    if (typedBlock.type === "text") {
      return (
        typeof typedBlock.text !== "string" || typedBlock.text.trim() === ""
      );
    }
    if (typedBlock.type === "thinking") {
      return (
        typeof typedBlock.thinking !== "string" ||
        typedBlock.thinking.trim() === ""
      );
    }
    return false;
  });
}

function maybeReconcileApprox(
  messages: Message[],
  provider: string | undefined,
): Message[] {
  return usesApproxMessageDedup(provider)
    ? reconcileLinearMessages(messages, approxDedupOptions(provider))
    : messages;
}

function applyStreamMessage(
  state: SessionDetailState,
  action: Extract<SessionDetailAction, { type: "applyStreamMessage" }>,
): SessionDetailState {
  const provider = state.session?.provider;
  const incoming = action.message;
  const isReplay = incoming.isReplay === true;
  const incomingTimestampMs = getMessageTimestampMs(incoming);
  const isPersistedReplay =
    isReplay &&
    incomingTimestampMs !== null &&
    incomingTimestampMs <= state.maxPersistedTimestampMs;

  if (incoming._isStreaming === true && action.streamingEnabled === false) {
    const messages = clearStreamingMessages(state.messages);
    return messages === state.messages ? state : { ...state, messages };
  }

  if (isPersistedReplay) {
    return state;
  }

  const shouldApplyReplayDedupe =
    (action.fromBufferedReplay || isReplay) && usesApproxMessageDedup(provider);
  if (shouldApplyReplayDedupe) {
    if (isEmptyAssistantContent(incoming)) {
      return state;
    }
    if (
      hasEquivalentJsonlMessage(
        state.messages,
        incoming,
        approxDedupOptions(provider),
      )
    ) {
      return state;
    }
  }

  const result = mergeStreamMessage(state.messages, incoming);
  const messages = maybeReconcileApprox(result.messages, provider);
  return messages === state.messages ? state : { ...state, messages };
}

export function reduceSessionDetailState(
  state: SessionDetailState,
  action: SessionDetailAction,
): SessionDetailState {
  switch (action.type) {
    case "loadPersistedTranscript": {
      const taggedMessages = tagJsonlMessages(action.messages);
      const messages = maybeReconcileApprox(
        taggedMessages,
        action.session.provider,
      );
      return {
        ...state,
        messages,
        session: action.session,
        pagination: action.pagination,
        agentContent: action.agentContent ?? {},
        markdownAugments: action.markdownAugments
          ? { ...state.markdownAugments, ...action.markdownAugments }
          : state.markdownAugments,
        toolUseToAgentEntries: action.toolUseToAgentEntries ?? [],
        deferredMessages: action.deferredMessages ?? [],
        lastMessageId: findLastJsonlMessageId(messages),
        maxPersistedTimestampMs: updatePersistedTimestampWatermark(
          Number.NEGATIVE_INFINITY,
          taggedMessages,
        ),
        scrollSnapshot: action.scrollSnapshot,
      };
    }

    case "applyStreamMessage":
      return applyStreamMessage(state, action);

    case "applyCatchupMessages": {
      const taggedMessages = tagJsonlMessages(action.messages);
      const session = action.session ?? state.session;
      const provider = session?.provider;
      const messages = mergePersistedMessagesForProvider(
        state.messages,
        taggedMessages,
        provider,
      );
      return {
        ...state,
        messages,
        session,
        pagination: action.pagination ?? state.pagination,
        lastMessageId: findLastJsonlMessageId(messages),
        maxPersistedTimestampMs: updatePersistedTimestampWatermark(
          state.maxPersistedTimestampMs,
          taggedMessages,
        ),
      };
    }

    case "prependOlderMessages": {
      const taggedMessages = tagJsonlMessages(action.messages);
      const provider = state.session?.provider;
      const combined = [...taggedMessages, ...state.messages];
      const messages = maybeReconcileApprox(combined, provider);
      return {
        ...state,
        messages,
        pagination: action.pagination ?? state.pagination,
        lastMessageId: findLastJsonlMessageId(messages),
        maxPersistedTimestampMs: updatePersistedTimestampWatermark(
          state.maxPersistedTimestampMs,
          taggedMessages,
        ),
      };
    }

    case "patchScrollSnapshot":
      return {
        ...state,
        scrollSnapshot: action.scrollSnapshot,
      };

    case "applyFinalMarkdownAugment": {
      const existing = state.markdownAugments[action.messageId];
      if (existing?.html === action.augment.html) {
        return state;
      }
      return {
        ...state,
        markdownAugments: {
          ...state.markdownAugments,
          [action.messageId]: action.augment,
        },
      };
    }
  }
}

export function reduceSessionDetailActions(
  actions: readonly SessionDetailAction[],
  initialState = createInitialSessionDetailState(),
): SessionDetailState {
  return actions.reduce(reduceSessionDetailState, initialState);
}
