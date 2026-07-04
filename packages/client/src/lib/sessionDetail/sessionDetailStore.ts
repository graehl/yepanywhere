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
