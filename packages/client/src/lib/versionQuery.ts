import type { VersionInfo } from "../api/client";
import {
  createClientQueryKey,
  type ClientQueryRequestContext,
} from "./clientQueryController";
import type { ClientSummarySourceKey } from "./clientSummarySourceKey";

export const VERSION_QUERY_KEY = createClientQueryKey({ endpoint: "version" });

export interface VersionSnapshot {
  version: VersionInfo | null;
  observedAt?: number;
}

export const EMPTY_VERSION_SNAPSHOT: VersionSnapshot = { version: null };

const versionSnapshotsBySource = new Map<
  ClientSummarySourceKey,
  VersionSnapshot
>();
const versionSnapshotListeners = new Set<() => void>();

function emitVersionSnapshotChange(): void {
  for (const listener of Array.from(versionSnapshotListeners)) {
    listener();
  }
}

export function subscribeVersionSnapshots(listener: () => void): () => void {
  versionSnapshotListeners.add(listener);
  return () => {
    versionSnapshotListeners.delete(listener);
  };
}

export function getVersionSnapshot(
  sourceKey: ClientSummarySourceKey,
): VersionSnapshot {
  return versionSnapshotsBySource.get(sourceKey) ?? EMPTY_VERSION_SNAPSHOT;
}

function acceptVersionSnapshot(
  sourceKey: ClientSummarySourceKey,
  version: VersionInfo,
  observedAt: number,
): void {
  const current = versionSnapshotsBySource.get(sourceKey);
  if (current?.observedAt !== undefined && current.observedAt > observedAt) {
    return;
  }

  versionSnapshotsBySource.set(sourceKey, { version, observedAt });
  emitVersionSnapshotChange();
}

export function applyVersionSnapshot(
  version: VersionInfo,
  context: ClientQueryRequestContext,
): void {
  acceptVersionSnapshot(context.sourceKey, version, context.requestStartedAt);
}

/** Read source-owned version facts without starting or waiting for a request. */
export function readVersionInfo(
  sourceKey: ClientSummarySourceKey,
): VersionInfo | null {
  return getVersionSnapshot(sourceKey).version;
}

export function resetVersionQueryForTests(): void {
  versionSnapshotsBySource.clear();
  versionSnapshotListeners.clear();
}
