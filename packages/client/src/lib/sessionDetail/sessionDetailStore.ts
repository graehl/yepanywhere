import { SessionDetailCache } from "./sessionDetailCache";

export type {
  SessionDetailMemoryCacheEntryStats,
  SessionDetailStoreEntryStats,
} from "./sessionDetailEntry";
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
export type {
  SessionDetailMemoryCacheStats,
  SessionDetailStoreStats,
} from "./sessionDetailCache";

// Phase 4 facade names: the class owns the source-scoped memory cache,
// retention policy, and cache stats; SessionDetailEntryStore is the
// per-entry reducer/subscription owner.
export { SessionDetailCache as SessionDetailMemoryCache };

// Compatibility export for staged migration.
export { SessionDetailCache as SessionDetailStore };

export function createSessionDetailMemoryCache(): SessionDetailCache {
  return new SessionDetailCache();
}

export function createSessionDetailStore(): SessionDetailCache {
  return createSessionDetailMemoryCache();
}

export const defaultSessionDetailMemoryCache: SessionDetailCache =
  createSessionDetailMemoryCache();

export const defaultSessionDetailStore: SessionDetailCache =
  defaultSessionDetailMemoryCache;

export function clearDefaultSessionDetailMemoryCache(): void {
  defaultSessionDetailMemoryCache.clear();
}

export function clearDefaultSessionDetailMemoryCacheScrollSnapshots(): void {
  defaultSessionDetailMemoryCache.clearScrollSnapshots();
}

export function evictExpiredDefaultSessionDetailMemoryCache(): number {
  return defaultSessionDetailMemoryCache.evictExpired();
}

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
  const stats = defaultSessionDetailMemoryCache.getStats();
  return {
    totalBytes: stats.dedupedApproxBytes,
    liveRetainedBytes: stats.retainedDedupedApproxBytes,
    liveRetainedEntryCount: stats.retainedEntryCount,
    warmCacheBytes: stats.warmCacheDedupedApproxBytes,
    warmCacheEntryCount: stats.warmCacheEntryCount,
  };
}
