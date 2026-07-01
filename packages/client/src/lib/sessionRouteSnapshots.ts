import type { PaginationInfo } from "../api/client";
import type { AgentContentMap } from "../hooks/useSessionMessages";
import type { Message, SessionMetadata } from "../types";
import type { ClientSummarySourceKey } from "./clientSummaryStore";

export interface SessionRouteScrollSnapshot {
  atBottom: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchor?: {
    id: string;
    topOffset: number;
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

interface SessionRouteSnapshotEntry extends SessionRouteSnapshot {
  key: string;
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  approxBytes: number;
}

interface SessionRouteSnapshotGlobal {
  __YA_SESSION_ROUTE_SNAPSHOTS__?: Map<string, SessionRouteSnapshotEntry>;
}

export interface SessionRouteSnapshotKeyInput {
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
}

export interface SessionRouteSnapshotWriteOptions {
  nowMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  maxBytes?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 3;
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;
const APPROX_BYTES_PER_MESSAGE = 2048;
const APPROX_BYTES_PER_AGENT_ENTRY = 1024;

function now(options?: Pick<SessionRouteSnapshotWriteOptions, "nowMs">) {
  return options?.nowMs ?? Date.now();
}

function cloneSnapshot<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function getSnapshotStore(): Map<string, SessionRouteSnapshotEntry> {
  const globalCache = globalThis as typeof globalThis &
    SessionRouteSnapshotGlobal;
  if (!globalCache.__YA_SESSION_ROUTE_SNAPSHOTS__) {
    globalCache.__YA_SESSION_ROUTE_SNAPSHOTS__ = new Map();
  }
  return globalCache.__YA_SESSION_ROUTE_SNAPSHOTS__;
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function getSessionRouteSnapshotKey({
  sourceKey,
  projectId,
  sessionId,
  tailTurns,
  tailFrom,
}: SessionRouteSnapshotKeyInput): string {
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

function estimateBytes(snapshot: SessionRouteSnapshot): number {
  // Deliberately coarse: this cache is bounded primarily by entry count and TTL.
  // Full JSON serialization can block the main thread during route changes.
  return (
    snapshot.messages.length * APPROX_BYTES_PER_MESSAGE +
    Object.keys(snapshot.agentContent).length * APPROX_BYTES_PER_AGENT_ENTRY +
    snapshot.toolUseToAgentEntries.length * APPROX_BYTES_PER_AGENT_ENTRY
  );
}

function toSnapshot(entry: SessionRouteSnapshotEntry): SessionRouteSnapshot {
  return {
    messages: entry.messages,
    session: entry.session,
    pagination: entry.pagination,
    agentContent: entry.agentContent,
    toolUseToAgentEntries: entry.toolUseToAgentEntries,
    lastMessageId: entry.lastMessageId,
    maxPersistedTimestampMs: entry.maxPersistedTimestampMs,
    scrollSnapshot: entry.scrollSnapshot
      ? cloneSnapshot(entry.scrollSnapshot)
      : undefined,
  };
}

function evictExpired(
  store: Map<string, SessionRouteSnapshotEntry>,
  at: number,
) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= at) {
      store.delete(key);
    }
  }
}

function getTotalBytes(store: Map<string, SessionRouteSnapshotEntry>): number {
  let total = 0;
  for (const entry of store.values()) {
    total += entry.approxBytes;
  }
  return total;
}

function evictLeastRecentlyUsed(
  store: Map<string, SessionRouteSnapshotEntry>,
  maxEntries: number,
  maxBytes: number,
) {
  const lruEntries = () =>
    Array.from(store.values()).sort(
      (left, right) => left.lastAccessedAt - right.lastAccessedAt,
    );

  while (store.size > maxEntries) {
    const victim = lruEntries()[0];
    if (!victim) break;
    store.delete(victim.key);
  }

  while (getTotalBytes(store) > maxBytes) {
    const victim = lruEntries()[0];
    if (!victim) break;
    store.delete(victim.key);
  }
}

export function readSessionRouteSnapshot(
  input: SessionRouteSnapshotKeyInput,
  options: Pick<SessionRouteSnapshotWriteOptions, "nowMs"> = {},
): SessionRouteSnapshot | undefined {
  if (typeof window === "undefined") return undefined;
  const at = now(options);
  const store = getSnapshotStore();
  const key = getSessionRouteSnapshotKey(input);
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= at) {
    store.delete(key);
    return undefined;
  }
  entry.lastAccessedAt = at;
  return toSnapshot(entry);
}

export function writeSessionRouteSnapshot(
  input: SessionRouteSnapshotKeyInput,
  snapshot: SessionRouteSnapshot,
  options: SessionRouteSnapshotWriteOptions = {},
): boolean {
  if (typeof window === "undefined") return false;
  const at = now(options);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const approxBytes = estimateBytes(snapshot);
  const key = getSessionRouteSnapshotKey(input);
  const store = getSnapshotStore();

  evictExpired(store, at);
  if (approxBytes > maxBytes) {
    store.delete(key);
    return false;
  }

  store.set(key, {
    ...snapshot,
    key,
    sourceKey: input.sourceKey,
    projectId: input.projectId,
    sessionId: input.sessionId,
    tailTurns: input.tailTurns,
    tailFrom: input.tailFrom,
    createdAt: store.get(key)?.createdAt ?? at,
    updatedAt: at,
    lastAccessedAt: at,
    expiresAt: at + ttlMs,
    approxBytes,
  });
  evictLeastRecentlyUsed(store, maxEntries, maxBytes);
  return true;
}

export function patchSessionRouteScrollSnapshot(
  input: SessionRouteSnapshotKeyInput,
  scrollSnapshot: SessionRouteScrollSnapshot,
): void {
  if (typeof window === "undefined") return;
  const store = getSnapshotStore();
  const entry = store.get(getSessionRouteSnapshotKey(input));
  if (!entry) return;
  entry.scrollSnapshot = cloneSnapshot(scrollSnapshot);
  entry.updatedAt = Date.now();
}

export function resetSessionRouteSnapshotsForTests(): void {
  delete (globalThis as typeof globalThis & SessionRouteSnapshotGlobal)
    .__YA_SESSION_ROUTE_SNAPSHOTS__;
}
