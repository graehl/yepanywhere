import type { PaginationInfo } from "../api/client";
import type { AgentContentMap } from "../hooks/useSessionMessages";
import type { Message, SessionMetadata } from "../types";

/**
 * Serializable transcript-window DTOs for warm route reveals; runtime
 * ownership lives in `SessionDetailMemoryCache`.
 */
export interface SessionRouteScrollSnapshot {
  atBottom: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchor?: {
    id: string;
    topOffset: number;
    previousId?: string;
    nextId?: string;
    timestampMs?: number;
  };
  updatedAtMs: number;
}

export interface SessionRouteSnapshot {
  messages: Message[];
  session: SessionMetadata;
  pagination?: PaginationInfo;
  agentContent: AgentContentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  scrollSnapshot?: SessionRouteScrollSnapshot;
}
