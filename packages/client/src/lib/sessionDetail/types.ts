import type { DeferredQueueMessage, PaginationInfo } from "../../api/client";
import type { Message, SessionMetadata } from "../../types";
import type { SessionRouteScrollSnapshot } from "../sessionRouteSnapshots";

export interface AgentContent {
  messages: Message[];
  status: "pending" | "running" | "completed" | "failed";
  contextUsage?: {
    inputTokens: number;
    percentage: number;
  };
}

export type AgentContentMap = Record<string, AgentContent>;

export interface SessionDetailState {
  messages: Message[];
  session: SessionMetadata | null;
  pagination?: PaginationInfo;
  agentContent: AgentContentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  deferredMessages: DeferredQueueMessage[];
  scrollSnapshot?: SessionRouteScrollSnapshot;
}

export type SessionDetailAction =
  | {
      type: "loadPersistedTranscript";
      messages: Message[];
      session: SessionMetadata;
      pagination?: PaginationInfo;
      agentContent?: AgentContentMap;
      toolUseToAgentEntries?: Array<[string, string]>;
      deferredMessages?: DeferredQueueMessage[];
      scrollSnapshot?: SessionRouteScrollSnapshot;
    }
  | {
      type: "applyStreamMessage";
      message: Message;
      fromBufferedReplay?: boolean;
      streamingEnabled?: boolean;
    }
  | {
      type: "applyCatchupMessages";
      messages: Message[];
      session?: SessionMetadata;
      pagination?: PaginationInfo;
    }
  | {
      type: "prependOlderMessages";
      messages: Message[];
      pagination?: PaginationInfo;
    }
  | {
      type: "patchScrollSnapshot";
      scrollSnapshot: SessionRouteScrollSnapshot;
    };
