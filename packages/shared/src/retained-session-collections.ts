import type { EnrichedRecentEntry } from "./app-types.js";

/** Retained project membership and the discovery updating it. */
export interface RetainedProjectCollectionState {
  complete: boolean;
  refreshing: boolean;
  refreshError?: string;
}

/** Accepted durable rows and the independent work repairing their freshness. */
export interface RetainedSessionCollectionState {
  catalogEpoch: string;
  catalogGeneration: number;
  complete: boolean;
  refreshing: boolean;
  refreshError?: string;
}

export interface SessionCatalogUpdatedEvent {
  type: "session-catalog-updated";
  catalog: RetainedSessionCollectionState;
  timestamp: string;
}

/** A retained row may not yet have observed the session's title. */
export interface RecentSessionsResponse {
  recents: Array<
    Omit<EnrichedRecentEntry, "title"> & { title?: string | null }
  >;
  catalog?: RetainedSessionCollectionState;
  /** Authoritative visit order, independent of session title discovery. */
  visits?: Array<
    Pick<EnrichedRecentEntry, "sessionId" | "projectId" | "visitedAt">
  >;
}

export interface RecentsChangedEvent {
  type: "recents-changed";
  timestamp: string;
}
