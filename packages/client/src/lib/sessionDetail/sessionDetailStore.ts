import type { ClientSummarySourceKey } from "../clientSummaryStore";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import { estimateSessionDetailStateBytes } from "./transcriptCharge";
import {
  createInitialSessionDetailState,
  reduceSessionDetailState,
} from "./transcriptReducer";
import type { SessionDetailAction, SessionDetailState } from "./types";

export interface SessionDetailEntryKeyInput {
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
}

export type SessionDetailStoreKeyInput = SessionDetailEntryKeyInput;

export interface SessionDetailRetentionOptions {
  nowMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  maxBytes?: number;
}

export interface SessionDetailStoreEntryStats {
  key: string;
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
  messageCount: number;
  agentEntryCount: number;
  approxBytes: number;
  retainCount: number;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  hasScrollSnapshot: boolean;
}

export interface SessionDetailStoreStats {
  entryCount: number;
  retainedEntryCount: number;
  approxBytes: number;
  /** Aggregate with rows shared across entries charged once. */
  dedupedApproxBytes: number;
  entries: SessionDetailStoreEntryStats[];
}

type Selector<T> = (state: SessionDetailState | undefined) => T;
type Equality<T> = (left: T, right: T) => boolean;

interface SelectorSubscription {
  selector: Selector<unknown>;
  listener: () => void;
  equality: Equality<unknown>;
  value: unknown;
}

interface SessionDetailStoreEntry {
  key: string;
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
  state: SessionDetailState;
  retainCount: number;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  approxBytes: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 3;
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;

export interface SessionDetailRetentionDefaults {
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
}

// Built-in fallbacks apply until user preferences configure them (the
// performance-settings module does so at load and on change).
const retentionDefaults: SessionDetailRetentionDefaults = {
  ttlMs: DEFAULT_TTL_MS,
  maxEntries: DEFAULT_MAX_ENTRIES,
  maxBytes: DEFAULT_MAX_BYTES,
};

export function configureSessionDetailRetention(
  overrides: Partial<SessionDetailRetentionDefaults>,
): void {
  Object.assign(retentionDefaults, overrides);
}

export function getSessionDetailRetentionDefaults(): SessionDetailRetentionDefaults {
  return { ...retentionDefaults };
}

function now(options?: Pick<SessionDetailRetentionOptions, "nowMs">): number {
  return options?.nowMs ?? Date.now();
}

function ttlMs(options?: SessionDetailRetentionOptions): number {
  return options?.ttlMs ?? retentionDefaults.ttlMs;
}

function maxEntries(options?: SessionDetailRetentionOptions): number {
  return options?.maxEntries ?? retentionDefaults.maxEntries;
}

function maxBytes(options?: SessionDetailRetentionOptions): number {
  return options?.maxBytes ?? retentionDefaults.maxBytes;
}

function cloneScrollSnapshot(
  scrollSnapshot: SessionRouteScrollSnapshot,
): SessionRouteScrollSnapshot {
  if (typeof structuredClone === "function") {
    return structuredClone(scrollSnapshot);
  }
  return JSON.parse(JSON.stringify(scrollSnapshot)) as SessionRouteScrollSnapshot;
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function getSessionDetailEntryKey({
  sourceKey,
  projectId,
  sessionId,
  tailTurns,
  tailFrom,
}: SessionDetailEntryKeyInput): string {
  const base = [
    encodeKeyPart(sourceKey),
    encodeKeyPart(projectId),
    encodeKeyPart(sessionId),
  ].join(":");
  const variant = [
    tailTurns !== undefined ? `tailTurns=${tailTurns}` : "",
    tailFrom ? `tailFrom=${encodeKeyPart(tailFrom)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  return variant ? `${base}?${variant}` : base;
}

export function getSessionDetailStoreKey(
  input: SessionDetailStoreKeyInput,
): string {
  return getSessionDetailEntryKey(input);
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

function routeSnapshotToState(
  snapshot: SessionRouteSnapshot,
): SessionDetailState {
  return reduceSessionDetailState(createInitialSessionDetailState(), {
    type: "restoreRouteSnapshot",
    snapshot,
  });
}

function stateToRouteSnapshot(
  state: SessionDetailState,
): SessionRouteSnapshot | undefined {
  if (!state.session) {
    return undefined;
  }
  return {
    messages: state.messages,
    session: state.session,
    pagination: state.pagination,
    agentContent: state.agentContent,
    toolUseToAgentEntries: state.toolUseToAgentEntries,
    lastMessageId: state.lastMessageId,
    maxPersistedTimestampMs: state.maxPersistedTimestampMs,
    scrollSnapshot: state.scrollSnapshot
      ? cloneScrollSnapshot(state.scrollSnapshot)
      : undefined,
  };
}

export class SessionDetailStore {
  private entries = new Map<string, SessionDetailStoreEntry>();
  private listeners = new Map<string, Set<SelectorSubscription>>();

  read(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionDetailState | undefined {
    const at = now(options);
    const key = getSessionDetailEntryKey(input);
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.deleteIfExpired(entry, at)) {
      return undefined;
    }
    entry.lastAccessedAt = at;
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
    const at = now(options);
    const key = getSessionDetailEntryKey(input);
    this.evictExpired({ nowMs: at });

    const state = routeSnapshotToState(snapshot);
    const approxBytes = estimateStateBytes(state);
    if (approxBytes > maxBytes(options)) {
      if (this.entries.delete(key)) {
        this.notifyKey(key);
      }
      return false;
    }

    const existing = this.entries.get(key);
    this.entries.set(key, {
      key,
      sourceKey: input.sourceKey,
      projectId: input.projectId,
      sessionId: input.sessionId,
      tailTurns: input.tailTurns,
      tailFrom: input.tailFrom,
      state,
      retainCount: existing?.retainCount ?? 0,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      lastAccessedAt: at,
      expiresAt: at + ttlMs(options),
      approxBytes,
    });
    this.notifyKey(key);
    this.evictLeastRecentlyUsed(options);
    return true;
  }

  dispatch(
    input: SessionDetailEntryKeyInput,
    action: SessionDetailAction,
    options: SessionDetailRetentionOptions = {},
  ): SessionDetailState | undefined {
    const at = now(options);
    const key = getSessionDetailEntryKey(input);
    // Only transcript-establishing actions may create an entry. Applying an
    // incremental action to a fabricated empty entry would present a
    // truncated transcript as canonical after eviction, so those actions
    // require the owner (a mounted hook holding retain()) to exist first.
    const existing = this.entries.get(key);
    if (!existing && !isEntryCreatingAction(action)) {
      if (import.meta.env.DEV) {
        console.warn(
          "[SessionDetailStore] dropped action for missing entry",
          { key, actionType: action.type },
        );
      }
      return undefined;
    }
    const entry = existing ?? this.ensureEntry(input, at, options);
    const nextState = reduceSessionDetailState(entry.state, action);
    if (nextState === entry.state) {
      entry.lastAccessedAt = at;
      return entry.state;
    }

    entry.state = nextState;
    entry.updatedAt = at;
    entry.lastAccessedAt = at;
    entry.expiresAt = at + ttlMs(options);
    entry.approxBytes = estimateStateBytes(
      nextState,
      isEntryCreatingAction(action),
    );

    if (entry.approxBytes > maxBytes(options) && entry.retainCount === 0) {
      this.entries.delete(key);
      this.notifyKey(key);
      return undefined;
    }

    this.notifyKey(key);
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
    const at = now(options);
    const key = getSessionDetailEntryKey(input);
    const entry = this.entries.get(key);
    if (!entry || this.deleteIfExpired(entry, at)) {
      return;
    }
    entry.state = {
      ...entry.state,
      scrollSnapshot: cloneScrollSnapshot(scrollSnapshot),
    };
    entry.updatedAt = at;
    entry.lastAccessedAt = at;
    if (options.notify === true) {
      this.notifyKey(key);
    }
  }

  subscribe<T>(
    input: SessionDetailEntryKeyInput,
    selector: Selector<T>,
    listener: () => void,
    equality: Equality<T> = Object.is,
  ): () => void {
    const key = getSessionDetailEntryKey(input);
    const subscription: SelectorSubscription = {
      selector: selector as Selector<unknown>,
      listener,
      equality: equality as Equality<unknown>,
      value: selector(this.entries.get(key)?.state),
    };
    let subscriptions = this.listeners.get(key);
    if (!subscriptions) {
      subscriptions = new Set();
      this.listeners.set(key, subscriptions);
    }
    subscriptions.add(subscription);
    return () => {
      subscriptions?.delete(subscription);
      if (subscriptions?.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  retain(
    input: SessionDetailEntryKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): () => void {
    const at = now(options);
    const entry = this.ensureEntry(input, at, options);
    entry.retainCount += 1;
    entry.lastAccessedAt = at;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.release(input, { ...options, nowMs: now(options) });
    };
  }

  release(
    input: SessionDetailEntryKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): void {
    const at = now(options);
    const entry = this.entries.get(getSessionDetailEntryKey(input));
    if (!entry) {
      return;
    }
    entry.retainCount = Math.max(0, entry.retainCount - 1);
    entry.lastAccessedAt = at;
    entry.expiresAt = at + ttlMs(options);
  }

  evictExpired(
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): number {
    const at = now(options);
    let evicted = 0;
    for (const entry of Array.from(this.entries.values())) {
      if (this.deleteIfExpired(entry, at)) {
        evicted += 1;
      }
    }
    return evicted;
  }

  clear(): void {
    const keys = new Set([...this.entries.keys(), ...this.listeners.keys()]);
    this.entries.clear();
    for (const key of keys) {
      this.notifyKey(key);
    }
  }

  deleteEntry(input: SessionDetailEntryKeyInput): boolean {
    const key = getSessionDetailEntryKey(input);
    const deleted = this.entries.delete(key);
    if (deleted) {
      this.notifyKey(key);
    }
    return deleted;
  }

  /**
   * Reset an entry's state to initial while preserving the entry itself —
   * unlike deleteEntry, this keeps retain() ownership intact, so a mounted
   * consumer restarting its load does not lose eviction protection.
   */
  resetEntryState(
    input: SessionDetailEntryKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs" | "ttlMs"> = {},
  ): void {
    const at = now(options);
    const key = getSessionDetailEntryKey(input);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.state.session === null && entry.state.messages.length === 0) {
      return;
    }
    entry.state = createInitialSessionDetailState();
    entry.updatedAt = at;
    entry.lastAccessedAt = at;
    entry.expiresAt = at + ttlMs(options);
    entry.approxBytes = 0;
    this.notifyKey(key);
  }

  getStats(): SessionDetailStoreStats {
    const entries = Array.from(this.entries.values()).map((entry) => ({
      key: entry.key,
      sourceKey: entry.sourceKey,
      projectId: entry.projectId,
      sessionId: entry.sessionId,
      tailTurns: entry.tailTurns,
      tailFrom: entry.tailFrom,
      messageCount: entry.state.messages.length,
      agentEntryCount: Object.keys(entry.state.agentContent).length,
      approxBytes: entry.approxBytes,
      retainCount: entry.retainCount,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastAccessedAt: entry.lastAccessedAt,
      expiresAt: entry.expiresAt,
      hasScrollSnapshot: entry.state.scrollSnapshot !== undefined,
    }));
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
  ): SessionDetailStoreEntry {
    const key = getSessionDetailEntryKey(input);
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }
    const entry: SessionDetailStoreEntry = {
      key,
      sourceKey: input.sourceKey,
      projectId: input.projectId,
      sessionId: input.sessionId,
      tailTurns: input.tailTurns,
      tailFrom: input.tailFrom,
      state: createInitialSessionDetailState(),
      retainCount: 0,
      createdAt: at,
      updatedAt: at,
      lastAccessedAt: at,
      expiresAt: at + ttlMs(options),
      approxBytes: 0,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private deleteIfExpired(
    entry: SessionDetailStoreEntry,
    at: number,
  ): boolean {
    if (entry.retainCount > 0 || entry.expiresAt > at) {
      return false;
    }
    this.entries.delete(entry.key);
    this.notifyKey(entry.key);
    return true;
  }

  private evictLeastRecentlyUsed(
    options: SessionDetailRetentionOptions,
  ): void {
    const maxEntryCount = maxEntries(options);
    const maxByteCount = maxBytes(options);
    const candidates = () =>
      Array.from(this.entries.values())
        .filter((entry) => entry.retainCount === 0)
        .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);

    while (this.entries.size > maxEntryCount) {
      const victim = candidates()[0];
      if (!victim) {
        break;
      }
      this.entries.delete(victim.key);
      this.notifyKey(victim.key);
    }

    // The naive per-entry sum is an upper bound on deduped usage, so an
    // under-budget fast path avoids walking rows on ordinary dispatches.
    let naiveTotal = 0;
    for (const entry of this.entries.values()) {
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
      this.entries.delete(victim.key);
      this.notifyKey(victim.key);
    }
  }

  /** Aggregate usage with rows shared across entries charged once. */
  private dedupedApproxBytes(): number {
    const seen = new Set<object>();
    let total = 0;
    for (const entry of this.entries.values()) {
      total += estimateSessionDetailStateBytes(entry.state, {
        measureUncached: false,
        seen,
      });
    }
    return total;
  }

  private notifyKey(key: string): void {
    const subscriptions = this.listeners.get(key);
    if (!subscriptions) {
      return;
    }
    const state = this.entries.get(key)?.state;
    for (const subscription of Array.from(subscriptions)) {
      const nextValue = subscription.selector(state);
      if (subscription.equality(subscription.value, nextValue)) {
        continue;
      }
      subscription.value = nextValue;
      subscription.listener();
    }
  }
}

export function createSessionDetailStore(): SessionDetailStore {
  return new SessionDetailStore();
}

export const defaultSessionDetailStore = createSessionDetailStore();
