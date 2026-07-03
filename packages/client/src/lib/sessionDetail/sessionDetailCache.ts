import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import { estimateSessionDetailStateBytes } from "./transcriptCharge";
import { reduceSessionDetailState } from "./transcriptReducer";
import type { SessionDetailAction, SessionDetailState } from "./types";
import {
  SessionDetailEntry,
  type SessionDetailStoreEntryStats,
} from "./sessionDetailEntry";
import {
  getSessionDetailEntryKey,
  type SessionDetailEntryKeyInput,
} from "./sessionDetailKey";
import {
  getSessionDetailMaxBytes,
  getSessionDetailMaxEntries,
  getSessionDetailNow,
  type SessionDetailRetentionOptions,
} from "./sessionDetailRetention";
import {
  routeSnapshotToState,
  stateToRouteSnapshot,
} from "./sessionDetailSnapshots";

type Selector<T> = (state: SessionDetailState | undefined) => T;
type Equality<T> = (left: T, right: T) => boolean;

export interface SessionDetailStoreStats {
  entryCount: number;
  retainedEntryCount: number;
  approxBytes: number;
  /** Aggregate with rows shared across entries charged once. */
  dedupedApproxBytes: number;
  entries: SessionDetailStoreEntryStats[];
}

// Boundary paths (loads, snapshot writes) measure every row; per-action
// dispatch estimates skip serializing not-yet-measured rows (the growing
// streaming row) and charge them a calibrated flat fallback instead.
function estimateStateBytes(
  state: SessionDetailState,
  measureUncached = true,
): number {
  return estimateSessionDetailStateBytes(state, { measureUncached });
}

function isEntryCreatingAction(action: SessionDetailAction): boolean {
  return (
    action.type === "restoreRouteSnapshot" ||
    action.type === "loadPersistedTranscript"
  );
}

export class SessionDetailCache {
  private entries = new Map<string, SessionDetailEntry>();

  read(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionDetailState | undefined {
    const at = getSessionDetailNow(options);
    const key = getSessionDetailEntryKey(input);
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.deleteIfExpired(entry, at)) {
      return undefined;
    }
    entry.markAccessed(at);
    return entry.state;
  }

  readRouteSnapshot(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionRouteSnapshot | undefined {
    const state = this.read(input, options);
    return state ? stateToRouteSnapshot(state) : undefined;
  }

  readSelected<T>(
    input: SessionDetailEntryKeyInput,
    selector: (state: SessionDetailState) => T,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): T | undefined {
    const state = this.read(input, options);
    return state ? selector(state) : undefined;
  }

  writeRouteSnapshot(
    input: SessionDetailEntryKeyInput,
    snapshot: SessionRouteSnapshot,
    options: SessionDetailRetentionOptions = {},
  ): boolean {
    const at = getSessionDetailNow(options);
    const key = getSessionDetailEntryKey(input);
    this.evictExpired({ nowMs: at });

    const state = routeSnapshotToState(snapshot);
    const approxBytes = estimateStateBytes(state);
    if (approxBytes > getSessionDetailMaxBytes(options)) {
      this.deleteRecordByKey(key);
      return false;
    }

    const entry = this.getOrCreateEntry(input);
    entry.replaceState(state, at, options, approxBytes);
    this.evictLeastRecentlyUsed(options);
    return true;
  }

  dispatch(
    input: SessionDetailEntryKeyInput,
    action: SessionDetailAction,
    options: SessionDetailRetentionOptions = {},
  ): SessionDetailState | undefined {
    const at = getSessionDetailNow(options);
    const key = getSessionDetailEntryKey(input);
    // Only transcript-establishing actions may create an entry. Applying an
    // incremental action to a fabricated empty entry would present a
    // truncated transcript as canonical after eviction, so those actions
    // require the owner (a mounted hook holding retain()) to exist first.
    const existing = this.entries.get(key);
    if (!existing?.hasRecord && !isEntryCreatingAction(action)) {
      if (import.meta.env.DEV) {
        console.warn(
          "[SessionDetailStore] dropped action for missing entry",
          { key, actionType: action.type },
        );
      }
      return undefined;
    }
    const entry = existing?.hasRecord
      ? existing
      : this.ensureEntry(input, at, options);
    const currentState = entry.state;
    if (!currentState) {
      return undefined;
    }
    const nextState = reduceSessionDetailState(currentState, action);
    if (nextState === currentState) {
      entry.markAccessed(at);
      return currentState;
    }

    const approxBytes = estimateStateBytes(
      nextState,
      isEntryCreatingAction(action),
    );
    entry.applyState(nextState, at, options, approxBytes);

    if (
      entry.approxBytes > getSessionDetailMaxBytes(options) &&
      entry.retainCount === 0
    ) {
      this.deleteRecordByKey(key);
      return undefined;
    }

    this.evictLeastRecentlyUsed(options);
    return nextState;
  }

  patchScrollSnapshot(
    input: SessionDetailEntryKeyInput,
    scrollSnapshot: SessionRouteScrollSnapshot,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> & {
      notify?: boolean;
    } = {},
  ): void {
    const at = getSessionDetailNow(options);
    const key = getSessionDetailEntryKey(input);
    const entry = this.entries.get(key);
    if (!entry || this.deleteIfExpired(entry, at)) {
      return;
    }
    entry.patchScrollSnapshot(scrollSnapshot, at, options.notify === true);
  }

  subscribe<T>(
    input: SessionDetailEntryKeyInput,
    selector: Selector<T>,
    listener: () => void,
    equality: Equality<T> = Object.is,
  ): () => void {
    const entry = this.getOrCreateEntry(input);
    const unsubscribe = entry.subscribe(selector, listener, equality);
    return () => {
      unsubscribe();
      this.deleteEntryIfIdle(entry);
    };
  }

  retain(
    input: SessionDetailEntryKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): () => void {
    const at = getSessionDetailNow(options);
    const entry = this.ensureEntry(input, at, options);
    entry.incrementRetain(at, options);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.release(input, {
        ...options,
        nowMs: getSessionDetailNow(options),
      });
    };
  }

  release(
    input: SessionDetailEntryKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): void {
    const at = getSessionDetailNow(options);
    const entry = this.entries.get(getSessionDetailEntryKey(input));
    if (!entry) {
      return;
    }
    entry.release(at, options);
    this.deleteEntryIfIdle(entry);
  }

  evictExpired(
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): number {
    const at = getSessionDetailNow(options);
    let evicted = 0;
    for (const entry of Array.from(this.entries.values())) {
      if (this.deleteIfExpired(entry, at)) {
        evicted += 1;
      }
    }
    return evicted;
  }

  clear(): void {
    for (const entry of Array.from(this.entries.values())) {
      entry.deleteRecord();
      this.deleteEntryIfIdle(entry);
    }
  }

  deleteEntry(input: SessionDetailEntryKeyInput): boolean {
    const key = getSessionDetailEntryKey(input);
    return this.deleteRecordByKey(key);
  }

  /**
   * Reset an entry's state to initial while preserving the entry itself -
   * unlike deleteEntry, this keeps retain() ownership intact, so a mounted
   * consumer restarting its load does not lose eviction protection.
   */
  resetEntryState(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs" | "ttlMs"> = {},
  ): void {
    const at = getSessionDetailNow(options);
    const key = getSessionDetailEntryKey(input);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    const state = entry.state;
    if (!state || (state.session === null && state.messages.length === 0)) {
      return;
    }
    entry.resetState(at, options);
  }

  getStats(): SessionDetailStoreStats {
    const entries = this.recordEntries().map((entry) => entry.toStats());
    return {
      entryCount: entries.length,
      retainedEntryCount: entries.filter((entry) => entry.retainCount > 0)
        .length,
      approxBytes: entries.reduce(
        (total, entry) => total + entry.approxBytes,
        0,
      ),
      dedupedApproxBytes: this.dedupedApproxBytes(),
      entries,
    };
  }

  private ensureEntry(
    input: SessionDetailEntryKeyInput,
    at: number,
    options: SessionDetailRetentionOptions,
  ): SessionDetailEntry {
    const entry = this.getOrCreateEntry(input);
    entry.ensureRecord(at, options);
    return entry;
  }

  private deleteIfExpired(
    entry: SessionDetailEntry,
    at: number,
  ): boolean {
    const deleted = entry.deleteIfExpired(at);
    if (deleted) {
      this.deleteEntryIfIdle(entry);
    }
    return deleted;
  }

  private evictLeastRecentlyUsed(
    options: SessionDetailRetentionOptions,
  ): void {
    const maxEntryCount = getSessionDetailMaxEntries(options);
    const maxByteCount = getSessionDetailMaxBytes(options);
    const candidates = () =>
      this.recordEntries()
        .filter((entry) => entry.retainCount === 0)
        .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);

    while (this.recordEntries().length > maxEntryCount) {
      const victim = candidates()[0];
      if (!victim) {
        break;
      }
      victim.deleteRecord();
      this.deleteEntryIfIdle(victim);
    }

    // The naive per-entry sum is an upper bound on deduped usage, so an
    // under-budget fast path avoids walking rows on ordinary dispatches.
    let naiveTotal = 0;
    for (const entry of this.recordEntries()) {
      naiveTotal += entry.approxBytes;
    }
    if (naiveTotal <= maxByteCount) {
      return;
    }

    while (this.dedupedApproxBytes() > maxByteCount) {
      const victim = candidates()[0];
      if (!victim) {
        break;
      }
      victim.deleteRecord();
      this.deleteEntryIfIdle(victim);
    }
  }

  /** Aggregate usage with rows shared across entries charged once. */
  private dedupedApproxBytes(): number {
    const seen = new Set<object>();
    let total = 0;
    for (const entry of this.recordEntries()) {
      total += entry.estimateBytes({
        measureUncached: false,
        seen,
      });
    }
    return total;
  }

  private getOrCreateEntry(input: SessionDetailEntryKeyInput): SessionDetailEntry {
    const key = getSessionDetailEntryKey(input);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = new SessionDetailEntry(key, input);
      this.entries.set(key, entry);
    }
    return entry;
  }

  private deleteRecordByKey(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }
    const deleted = entry.deleteRecord();
    this.deleteEntryIfIdle(entry);
    return deleted;
  }

  private deleteEntryIfIdle(entry: SessionDetailEntry): void {
    if (!entry.hasRecord && !entry.hasSubscriptions) {
      this.entries.delete(entry.key);
    }
  }

  private recordEntries(): SessionDetailEntry[] {
    return Array.from(this.entries.values()).filter((entry) => entry.hasRecord);
  }
}
