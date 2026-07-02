import type { ClientSummarySourceKey } from "../clientSummaryStore";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import {
  createInitialSessionDetailState,
  reduceSessionDetailState,
} from "./transcriptReducer";
import type { SessionDetailAction, SessionDetailState } from "./types";

export interface SessionDetailStoreKeyInput {
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
}

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
const APPROX_BYTES_PER_MESSAGE = 2048;
const APPROX_BYTES_PER_AGENT_ENTRY = 1024;

function now(options?: Pick<SessionDetailRetentionOptions, "nowMs">): number {
  return options?.nowMs ?? Date.now();
}

function ttlMs(options?: SessionDetailRetentionOptions): number {
  return options?.ttlMs ?? DEFAULT_TTL_MS;
}

function maxEntries(options?: SessionDetailRetentionOptions): number {
  return options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
}

function maxBytes(options?: SessionDetailRetentionOptions): number {
  return options?.maxBytes ?? DEFAULT_MAX_BYTES;
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

export function getSessionDetailStoreKey({
  sourceKey,
  projectId,
  sessionId,
  tailTurns,
  tailFrom,
}: SessionDetailStoreKeyInput): string {
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

function estimateStateBytes(state: SessionDetailState): number {
  return (
    state.messages.length * APPROX_BYTES_PER_MESSAGE +
    Object.keys(state.agentContent).length * APPROX_BYTES_PER_AGENT_ENTRY +
    state.toolUseToAgentEntries.length * APPROX_BYTES_PER_AGENT_ENTRY
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
    input: SessionDetailStoreKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionDetailState | undefined {
    const at = now(options);
    const key = getSessionDetailStoreKey(input);
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
    input: SessionDetailStoreKeyInput,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> = {},
  ): SessionRouteSnapshot | undefined {
    const state = this.read(input, options);
    return state ? stateToRouteSnapshot(state) : undefined;
  }

  writeRouteSnapshot(
    input: SessionDetailStoreKeyInput,
    snapshot: SessionRouteSnapshot,
    options: SessionDetailRetentionOptions = {},
  ): boolean {
    const at = now(options);
    const key = getSessionDetailStoreKey(input);
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
    input: SessionDetailStoreKeyInput,
    action: SessionDetailAction,
    options: SessionDetailRetentionOptions = {},
  ): SessionDetailState | undefined {
    const at = now(options);
    const key = getSessionDetailStoreKey(input);
    const entry = this.ensureEntry(input, at, options);
    const nextState = reduceSessionDetailState(entry.state, action);
    if (nextState === entry.state) {
      entry.lastAccessedAt = at;
      return entry.state;
    }

    entry.state = nextState;
    entry.updatedAt = at;
    entry.lastAccessedAt = at;
    entry.expiresAt = at + ttlMs(options);
    entry.approxBytes = estimateStateBytes(nextState);

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
    input: SessionDetailStoreKeyInput,
    scrollSnapshot: SessionRouteScrollSnapshot,
    options: Pick<SessionDetailRetentionOptions, "nowMs"> & {
      notify?: boolean;
    } = {},
  ): void {
    const at = now(options);
    const key = getSessionDetailStoreKey(input);
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
    input: SessionDetailStoreKeyInput,
    selector: Selector<T>,
    listener: () => void,
    equality: Equality<T> = Object.is,
  ): () => void {
    const key = getSessionDetailStoreKey(input);
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
    input: SessionDetailStoreKeyInput,
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
    input: SessionDetailStoreKeyInput,
    options: SessionDetailRetentionOptions = {},
  ): void {
    const at = now(options);
    const entry = this.entries.get(getSessionDetailStoreKey(input));
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

  deleteEntry(input: SessionDetailStoreKeyInput): boolean {
    const key = getSessionDetailStoreKey(input);
    const deleted = this.entries.delete(key);
    if (deleted) {
      this.notifyKey(key);
    }
    return deleted;
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
      entries,
    };
  }

  private ensureEntry(
    input: SessionDetailStoreKeyInput,
    at: number,
    options: SessionDetailRetentionOptions,
  ): SessionDetailStoreEntry {
    const key = getSessionDetailStoreKey(input);
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

    while (this.getStats().approxBytes > maxByteCount) {
      const victim = candidates()[0];
      if (!victim) {
        break;
      }
      this.entries.delete(victim.key);
      this.notifyKey(victim.key);
    }
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
