import { SessionDetailCache } from "./sessionDetailCache";

export type { SessionDetailStoreEntryStats } from "./sessionDetailEntry";
export type { SessionDetailEntryKeyInput } from "./sessionDetailKey";
export { getSessionDetailEntryKey } from "./sessionDetailKey";
export type {
  SessionDetailRetentionDefaults,
  SessionDetailRetentionOptions,
} from "./sessionDetailRetention";
export {
  configureSessionDetailRetention,
  getSessionDetailRetentionDefaults,
} from "./sessionDetailRetention";
export type { SessionDetailStoreStats } from "./sessionDetailCache";

// The store *is* the cache: one class owns entries, retention, and
// subscriptions; this module is its public name and default instance.
export { SessionDetailCache as SessionDetailStore };

export function createSessionDetailStore(): SessionDetailCache {
  return new SessionDetailCache();
}

export const defaultSessionDetailStore: SessionDetailCache =
  createSessionDetailStore();

export interface SessionTranscriptMemoryStats {
  totalBytes: number;
  liveRetainedBytes: number;
  liveRetainedEntryCount: number;
  warmCacheBytes: number;
  warmCacheEntryCount: number;
}

/**
 * Default-store byte usage in the Performance panel's vocabulary: deduped
 * totals split into live retained entries vs warm cache. Shared by the
 * settings display and client telemetry sampling.
 */
export function getSessionTranscriptMemoryStats(): SessionTranscriptMemoryStats {
  const stats = defaultSessionDetailStore.getStats();
  return {
    totalBytes: stats.dedupedApproxBytes,
    liveRetainedBytes: stats.retainedDedupedApproxBytes,
    liveRetainedEntryCount: stats.retainedEntryCount,
    warmCacheBytes: stats.warmCacheDedupedApproxBytes,
    warmCacheEntryCount: stats.warmCacheEntryCount,
  };
}
