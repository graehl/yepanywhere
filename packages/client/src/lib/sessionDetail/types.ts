import type { MarkdownAugment } from "@yep-anywhere/shared";
import type { DeferredQueueMessage, PaginationInfo } from "../../api/client";
import type { Message, SessionMetadata } from "../../types";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";

export interface AgentContent {
  messages: Message[];
  status: "pending" | "running" | "completed" | "failed";
  contextUsage?: {
    inputTokens: number;
    percentage: number;
  };
}

export type AgentContextUsage = NonNullable<AgentContent["contextUsage"]>;
export type AgentContentMap = Record<string, AgentContent>;
export type MarkdownAugmentMap = Record<string, MarkdownAugment>;

export interface SessionDetailState {
  messages: Message[];
  session: SessionMetadata | null;
  pagination?: PaginationInfo;
  agentContent: AgentContentMap;
  markdownAugments: MarkdownAugmentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  deferredMessages: DeferredQueueMessage[];
  scrollSnapshot?: SessionRouteScrollSnapshot;
}

export type SessionDetailAction =
  | {
      type: "restoreRouteSnapshot";
      snapshot: SessionRouteSnapshot;
    }
  | {
      type: "loadPersistedTranscript";
      messages: Message[];
      session: SessionMetadata;
      pagination?: PaginationInfo;
      agentContent?: AgentContentMap;
      markdownAugments?: MarkdownAugmentMap;
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
      type: "applyStreamSubagentMessage";
      agentId: string;
      message: Message;
      streamingEnabled?: boolean;
    }
  | {
      type: "registerToolUseAgent";
      toolUseId: string;
      agentId: string;
    }
  | {
      type: "mergeLoadedAgentContent";
      agentId: string;
      content: AgentContent;
    }
  | {
      type: "updateAgentContextUsage";
      agentId: string;
      contextUsage: AgentContextUsage;
    }
  | {
      type: "clearAgentStreamingPlaceholders";
      agentId: string;
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
    }
  | {
      type: "applyFinalMarkdownAugment";
      messageId: string;
      augment: MarkdownAugment;
    };
