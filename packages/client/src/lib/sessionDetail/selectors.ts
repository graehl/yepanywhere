import type {
  ActiveToolApproval,
  PreprocessAugments,
} from "../preprocessMessages";
import type { PaginationInfo } from "../../api/client";
import type { Message, SessionMetadata } from "../../types";
import type { SessionRouteScrollSnapshot } from "../sessionRouteSnapshots";
import type { AgentContentMap, SessionDetailState } from "./types";

export interface SessionDetailRuntimeSnapshot {
  messages: readonly Message[];
  session: SessionMetadata | null;
  pagination?: PaginationInfo;
  agentContent: AgentContentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  scrollSnapshot?: SessionRouteScrollSnapshot;
}

export function selectSessionDetailRuntimeSnapshot(
  state: SessionDetailState,
): SessionDetailRuntimeSnapshot {
  return {
    messages: state.messages,
    session: state.session,
    pagination: state.pagination,
    agentContent: state.agentContent,
    toolUseToAgentEntries: state.toolUseToAgentEntries,
    lastMessageId: state.lastMessageId,
    maxPersistedTimestampMs: state.maxPersistedTimestampMs,
    scrollSnapshot: state.scrollSnapshot,
  };
}

export function selectSessionDetailMessages(
  state: SessionDetailState,
): Message[] {
  return state.messages;
}

export function selectSessionDetailAgentContent(
  state: SessionDetailState,
): AgentContentMap {
  return state.agentContent;
}

export function selectSessionDetailToolUseToAgentEntries(
  state: SessionDetailState,
): Array<[string, string]> {
  return state.toolUseToAgentEntries;
}

export function selectSessionDetailScrollSnapshot(
  state: SessionDetailState,
): SessionRouteScrollSnapshot | undefined {
  return state.scrollSnapshot;
}

export function selectSessionDetailPagination(
  state: SessionDetailState,
): PaginationInfo | undefined {
  return state.pagination;
}

export function selectSessionDetailPreprocessAugments(
  state: SessionDetailState,
  options: { activeToolApproval?: ActiveToolApproval } = {},
): PreprocessAugments | undefined {
  const hasMarkdownAugments = Object.keys(state.markdownAugments).length > 0;
  if (!hasMarkdownAugments && options.activeToolApproval === undefined) {
    return undefined;
  }

  return {
    ...(hasMarkdownAugments && { markdown: state.markdownAugments }),
    ...(options.activeToolApproval !== undefined && {
      activeToolApproval: options.activeToolApproval,
    }),
  };
}
