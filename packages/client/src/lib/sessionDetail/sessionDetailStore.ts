import type { ClientSummarySourceKey } from "../clientSummaryStore";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import {
  estimateSessionDetailStateBytes,
  type EstimateStateBytesOptions,
} from "./transcriptCharge";
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

interface SessionDetailEntryRecord {
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

class SessionDetailEntry {
  private record: SessionDetailEntryRecord | null = null;
  private subscriptions = new Set<SelectorSubscription>();

  constructor(
    readonly key: string,
    readonly input: SessionDetailEntryKeyInput,
  ) {}

  get hasRecord(): boolean {
    return this.record !== null;
  }

  get hasSubscriptions(): boolean {
    return this.subscriptions.size > 0;
  }

  get state(): SessionDetailState | undefined {
    return this.record?.state;
  }

  get retainCount(): number {
    return this.record?.retainCount ?? 0;
  }

  get approxBytes(): number {
    return this.record?.approxBytes ?? 0;
  }

  get lastAccessedAt(): number {
    return this.record?.lastAccessedAt ?? 0;
  }

  markAccessed(at: number): void {
    if (this.record) {
      this.record.lastAccessedAt = at;
    }
  }

  ensureRecord(
    at: number,
    options: SessionDetailRetentionOptions,
  ): SessionDetailEntryRecord {
    if (!this.record) {
      this.record = {
        state: createInitialSessionDetailState(),
        retainCount: 0,
        createdAt: at,
        updatedAt: at,
        lastAccessedAt: at,
        expiresAt: at + ttlMs(options),
        approxBytes: 0,
      };
    }
    return this.record;
  }

  replaceState(
    state: SessionDetailState,
    at: number,
    options: SessionDetailRetentionOptions,
    approxBytes: number,
  ): void {
    const existing = this.record;
    this.record = {
      state,
      retainCount: existing?.retainCount ?? 0,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      lastAccessedAt: at,
      expiresAt: at + ttlMs(options),
      approxBytes,
    };
    this.notify();
  }

  applyState(
    state: SessionDetailState,
    at: number,
    options: SessionDetailRetentionOptions,
    approxBytes: number,
  ): void {
    const record = this.ensureRecord(at, options);
    record.state = state;
    record.updatedAt = at;
    record.lastAccessedAt = at;
    record.expiresAt = at + ttlMs(options);
    record.approxBytes = approxBytes;
    this.notify();
  }

  patchScrollSnapshot(
    scrollSnapshot: SessionRouteScrollSnapshot,
    at: number,
    notify: boolean,
  ): void {
    if (!this.record) {
      return;
    }
    this.record.state = {
      ...this.record.state,
      scrollSnapshot: cloneScrollSnapshot(scrollSnapshot),
    };
    this.record.updatedAt = at;
    this.record.lastAccessedAt = at;
    if (notify) {
      this.notify();
    }
  }

  resetState(
    at: number,
    options: Pick<SessionDetailRetentionOptions, "ttlMs">,
  ): void {
    if (!this.record) {
      return;
    }
    this.record.state = createInitialSessionDetailState();
    this.record.updatedAt = at;
    this.record.lastAccessedAt = at;
    this.record.expiresAt = at + ttlMs(options);
    this.record.approxBytes = 0;
    this.notify();
  }

  incrementRetain(at: number, options: SessionDetailRetentionOptions): void {
    const record = this.ensureRecord(at, options);
    record.retainCount += 1;
    record.lastAccessedAt = at;
  }

  release(at: number, options: SessionDetailRetentionOptions): void {
    if (!this.record) {
      return;
    }
    this.record.retainCount = Math.max(0, this.record.retainCount - 1);
    this.record.lastAccessedAt = at;
    this.record.expiresAt = at + ttlMs(options);
  }

  deleteRecord(): boolean {
    if (!this.record) {
      return false;
    }
    this.record = null;
    this.notify();
    return true;
  }

  deleteIfExpired(at: number): boolean {
    if (
      !this.record ||
      this.record.retainCount > 0 ||
      this.record.expiresAt > at
    ) {
      return false;
    }
    return this.deleteRecord();
  }

  subscribe<T>(
    selector: Selector<T>,
    listener: () => void,
    equality: Equality<T>,
  ): () => void {
    const subscription: SelectorSubscription = {
      selector: selector as Selector<unknown>,
      listener,
      equality: equality as Equality<unknown>,
      value: selector(this.state),
    };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  toStats(): SessionDetailStoreEntryStats {
    if (!this.record) {
      throw new Error("Cannot build stats for an empty session detail entry");
    }
    return {
      key: this.key,
      sourceKey: this.input.sourceKey,
      projectId: this.input.projectId,
      sessionId: this.input.sessionId,
      tailTurns: this.input.tailTurns,
      tailFrom: this.input.tailFrom,
      messageCount: this.record.state.messages.length,
      agentEntryCount: Object.keys(this.record.state.agentContent).length,
      approxBytes: this.record.approxBytes,
      retainCount: this.record.retainCount,
      createdAt: this.record.createdAt,
      updatedAt: this.record.updatedAt,
      lastAccessedAt: this.record.lastAccessedAt,
      expiresAt: this.record.expiresAt,
      hasScrollSnapshot: this.record.state.scrollSnapshot !== undefined,
    };
  }

  estimateBytes(options: EstimateStateBytesOptions): number {
    return this.record
      ? estimateSessionDetailStateBytes(this.record.state, options)
      : 0;
  }

  private notify(): void {
    const state = this.state;
    for (const subscription of Array.from(this.subscriptions)) {
      const nextValue = subscription.selector(state);
      if (subscription.equality(subscription.value, nextValue)) {
        continue;
      }
      subscription.value = nextValue;
      subscription.listener();
    }
  }
}

export class SessionDetailStore {
  private entries = new Map<string, SessionDetailEntry>();

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
    const at = now(options);
    const key = getSessionDetailEntryKey(input);
    this.evictExpired({ nowMs: at });

    const state = routeSnapshotToState(snapshot);
    const approxBytes = estimateStateBytes(state);
    if (approxBytes > maxBytes(options)) {
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
    const at = now(options);
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

    if (entry.approxBytes > maxBytes(options) && entry.retainCount === 0) {
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
    const at = now(options);
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
    const at = now(options);
    const entry = this.ensureEntry(input, at, options);
    entry.incrementRetain(at, options);
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
    entry.release(at, options);
    this.deleteEntryIfIdle(entry);
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
    const maxEntryCount = maxEntries(options);
    const maxByteCount = maxBytes(options);
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

export function createSessionDetailStore(): SessionDetailStore {
  return new SessionDetailStore();
}

export const defaultSessionDetailStore = createSessionDetailStore();
