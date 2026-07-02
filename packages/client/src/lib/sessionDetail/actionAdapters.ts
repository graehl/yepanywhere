import type { DeferredQueueMessage, PaginationInfo } from "../../api/client";
import type { Message, SessionMetadata } from "../../types";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import type {
  AgentContextUsage,
  AgentContentMap,
  MarkdownAugmentMap,
  SessionDetailAction,
  SessionDetailState,
} from "./types";

export type LoadPersistedTranscriptAction = Extract<
  SessionDetailAction,
  { type: "loadPersistedTranscript" }
>;

export type RestoreRouteSnapshotAction = Extract<
  SessionDetailAction,
  { type: "restoreRouteSnapshot" }
>;

export type ApplyCatchupMessagesAction = Extract<
  SessionDetailAction,
  { type: "applyCatchupMessages" }
>;

export type SetSessionMetadataAction = Extract<
  SessionDetailAction,
  { type: "setSessionMetadata" }
>;

export type ApplyStreamMessageAction = Extract<
  SessionDetailAction,
  { type: "applyStreamMessage" }
>;

export type ApplyStreamSubagentMessageAction = Extract<
  SessionDetailAction,
  { type: "applyStreamSubagentMessage" }
>;

export type UpsertStreamingPlaceholderAction = Extract<
  SessionDetailAction,
  { type: "upsertStreamingPlaceholder" }
>;

export type RegisterToolUseAgentAction = Extract<
  SessionDetailAction,
  { type: "registerToolUseAgent" }
>;

export type MergeLoadedAgentContentAction = Extract<
  SessionDetailAction,
  { type: "mergeLoadedAgentContent" }
>;

export type UpdateAgentContextUsageAction = Extract<
  SessionDetailAction,
  { type: "updateAgentContextUsage" }
>;

export type ClearAgentStreamingPlaceholdersAction = Extract<
  SessionDetailAction,
  { type: "clearAgentStreamingPlaceholders" }
>;

export type ClearStreamingPlaceholdersAction = Extract<
  SessionDetailAction,
  { type: "clearStreamingPlaceholders" }
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

export function createRestoreRouteSnapshotAction(
  snapshot: SessionRouteSnapshot,
): RestoreRouteSnapshotAction {
  return {
    type: "restoreRouteSnapshot",
    snapshot,
  };
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

export function createSetSessionMetadataAction(
  session: SessionMetadata | null,
): SetSessionMetadataAction {
  return {
    type: "setSessionMetadata",
    session,
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

export function createStreamSubagentMessageAction(
  agentId: string,
  message: Message,
  options: Pick<StreamMessageActionOptions, "streamingEnabled"> = {},
): ApplyStreamSubagentMessageAction {
  return {
    type: "applyStreamSubagentMessage",
    agentId,
    message,
    streamingEnabled: options.streamingEnabled,
  };
}

export function createUpsertStreamingPlaceholderAction(
  message: Message,
  agentId?: string,
): UpsertStreamingPlaceholderAction {
  return {
    type: "upsertStreamingPlaceholder",
    message,
    ...(agentId !== undefined ? { agentId } : {}),
  };
}

export function createRegisterToolUseAgentAction(
  toolUseId: string,
  agentId: string,
): RegisterToolUseAgentAction {
  return {
    type: "registerToolUseAgent",
    toolUseId,
    agentId,
  };
}

export function createMergeLoadedAgentContentAction(
  agentId: string,
  content: AgentContentMap[string],
): MergeLoadedAgentContentAction {
  return {
    type: "mergeLoadedAgentContent",
    agentId,
    content,
  };
}

export function createUpdateAgentContextUsageAction(
  agentId: string,
  contextUsage: AgentContextUsage,
): UpdateAgentContextUsageAction {
  return {
    type: "updateAgentContextUsage",
    agentId,
    contextUsage,
  };
}

export function createClearAgentStreamingPlaceholdersAction(
  agentId: string,
): ClearAgentStreamingPlaceholdersAction {
  return {
    type: "clearAgentStreamingPlaceholders",
    agentId,
  };
}

export function createClearStreamingPlaceholdersAction(): ClearStreamingPlaceholdersAction {
  return {
    type: "clearStreamingPlaceholders",
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
