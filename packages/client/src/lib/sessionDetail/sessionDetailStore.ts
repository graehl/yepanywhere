import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import {
  SessionDetailCache,
  type SessionDetailStoreStats,
} from "./sessionDetailCache";
import type { SessionDetailEntryKeyInput } from "./sessionDetailKey";
import type { SessionDetailRetentionOptions } from "./sessionDetailRetention";
import type { SessionDetailAction, SessionDetailState } from "./types";

export type { SessionDetailStoreEntryStats } from "./sessionDetailEntry";
export type {
  SessionDetailEntryKeyInput,
  SessionDetailStoreKeyInput,
} from "./sessionDetailKey";
export {
  getSessionDetailEntryKey,
  getSessionDetailStoreKey,
} from "./sessionDetailKey";
export type {
  SessionDetailRetentionDefaults,
  SessionDetailRetentionOptions,
} from "./sessionDetailRetention";
export {
  configureSessionDetailRetention,
  getSessionDetailRetentionDefaults,
} from "./sessionDetailRetention";
export type { SessionDetailStoreStats } from "./sessionDetailCache";

export class SessionDetailStore {
  private readonly cache = new SessionDetailCache();

  read(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionDetailState | undefined {
    return this.cache.read(input, options);
  }

  readRouteSnapshot(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionRouteSnapshot | undefined {
    return this.cache.readRouteSnapshot(input, options);
  }

  readScrollSnapshot(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionRouteScrollSnapshot | undefined {
    return this.cache.readScrollSnapshot(input, options);
  }

  readSelected<T>(
    input: SessionDetailEntryKeyInput,
    selector: (state: SessionDetailState) => T,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): T | undefined {
    return this.cache.readSelected(input, selector, options);
  }

  writeRouteSnapshot(
    input: SessionDetailEntryKeyInput,
    snapshot: SessionRouteSnapshot,
    options: SessionDetailRetentionOptions = {},
  ): boolean {
    return this.cache.writeRouteSnapshot(input, snapshot, options);
  }

  replaceRouteSnapshot(
    input: SessionDetailEntryKeyInput,
    snapshot: SessionRouteSnapshot,
    options: SessionDetailRetentionOptions = {},
  ): boolean {
    return this.cache.replaceRouteSnapshot(input, snapshot, options);
  }

  dispatch(
    input: SessionDetailEntryKeyInput,
    action: SessionDetailAction,
    options: SessionDetailRetentionOptions = {},
  ): SessionDetailState | undefined {
    return this.cache.dispatch(input, action, options);
  }

  patchScrollSnapshot(
    input: SessionDetailEntryKeyInput,
    scrollSnapshot: SessionRouteScrollSnapshot,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> & {
      notify?: boolean;
    } = {},
  ): void {
    this.cache.patchScrollSnapshot(input, scrollSnapshot, options);
  }

  subscribe<T>(
    input: SessionDetailEntryKeyInput,
    selector: (state: SessionDetailState | undefined) => T,
    listener: () => void,
    equality: (left: T, right: T) => boolean = Object.is,
  ): () => void {
    return this.cache.subscribe(input, selector, listener, equality);
  }

  retain(
    input: SessionDetailEntryKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): () => void {
    return this.cache.retain(input, options);
  }

  release(
    input: SessionDetailEntryKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): void {
    this.cache.release(input, options);
  }

  evictExpired(
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): number {
    return this.cache.evictExpired(options);
  }

  clear(): void {
    this.cache.clear();
  }

  clearScrollSnapshots(): void {
    this.cache.clearScrollSnapshots();
  }

  deleteEntry(input: SessionDetailEntryKeyInput): boolean {
    return this.cache.deleteEntry(input);
  }

  resetEntryState(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs" | "ttlMs"> = {},
  ): void {
    this.cache.resetEntryState(input, options);
  }

  getStats(): SessionDetailStoreStats {
    return this.cache.getStats();
  }
}

export function createSessionDetailStore(): SessionDetailStore {
  return new SessionDetailStore();
}

export const defaultSessionDetailStore = createSessionDetailStore();
