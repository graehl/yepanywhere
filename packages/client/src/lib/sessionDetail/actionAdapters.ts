import type { DeferredQueueMessage, PaginationInfo } from "../../api/client";
import type { Message, SessionMetadata } from "../../types";
import type { SessionRouteScrollSnapshot } from "../sessionRouteSnapshots";
import type {
  AgentContentMap,
  MarkdownAugmentMap,
  SessionDetailAction,
  SessionDetailState,
} from "./types";

export type LoadPersistedTranscriptAction = Extract<
  SessionDetailAction,
  { type: "loadPersistedTranscript" }
>;

export type ApplyCatchupMessagesAction = Extract<
  SessionDetailAction,
  { type: "applyCatchupMessages" }
>;

export type ApplyStreamMessageAction = Extract<
  SessionDetailAction,
  { type: "applyStreamMessage" }
>;

export type PrependOlderMessagesAction = Extract<
  SessionDetailAction,
  { type: "prependOlderMessages" }
>;

export type ApplyFinalMarkdownAugmentAction = Extract<
  SessionDetailAction,
  { type: "applyFinalMarkdownAugment" }
>;

export interface SessionDetailPersistedTranscriptInput {
  session: SessionMetadata;
  messages: Message[];
  pagination?: PaginationInfo;
  agentContent?: AgentContentMap;
  markdownAugments?: MarkdownAugmentMap;
  toolUseToAgentEntries?: Array<[string, string]>;
  deferredMessages?: DeferredQueueMessage[];
  scrollSnapshot?: SessionRouteScrollSnapshot;
}

export interface StreamMessageActionOptions {
  fromBufferedReplay?: boolean;
  streamingEnabled?: boolean;
}

export function createLoadPersistedTranscriptAction(
  input: SessionDetailPersistedTranscriptInput,
): LoadPersistedTranscriptAction {
  return {
    type: "loadPersistedTranscript",
    messages: input.messages,
    session: input.session,
    pagination: input.pagination,
    agentContent: input.agentContent,
    markdownAugments: input.markdownAugments,
    toolUseToAgentEntries: input.toolUseToAgentEntries,
    deferredMessages: input.deferredMessages,
    scrollSnapshot: input.scrollSnapshot,
  };
}

export function createCatchupMessagesAction(
  input: Pick<
    SessionDetailPersistedTranscriptInput,
    "messages" | "pagination" | "session"
  >,
): ApplyCatchupMessagesAction {
  return {
    type: "applyCatchupMessages",
    messages: input.messages,
    session: input.session,
    pagination: input.pagination,
  };
}

export function createStreamMessageAction(
  message: Message,
  options: StreamMessageActionOptions = {},
): ApplyStreamMessageAction {
  return {
    type: "applyStreamMessage",
    message,
    fromBufferedReplay: options.fromBufferedReplay,
    streamingEnabled: options.streamingEnabled,
  };
}

export function createStreamMessageActions(
  messages: readonly Message[],
  options: StreamMessageActionOptions = {},
): ApplyStreamMessageAction[] {
  return messages.map((message) => createStreamMessageAction(message, options));
}

export function createPrependOlderMessagesAction(
  input: Pick<SessionDetailPersistedTranscriptInput, "messages" | "pagination">,
): PrependOlderMessagesAction {
  return {
    type: "prependOlderMessages",
    messages: input.messages,
    pagination: input.pagination,
  };
}

export function createFinalMarkdownAugmentAction(input: {
  messageId: string;
  html: string;
}): ApplyFinalMarkdownAugmentAction {
  return {
    type: "applyFinalMarkdownAugment",
    messageId: input.messageId,
    augment: { html: input.html },
  };
}

export function hydrateInitialSessionDetailState(
  state: SessionDetailState,
  session: SessionMetadata,
): SessionDetailState {
  return {
    ...state,
    session,
  };
}
