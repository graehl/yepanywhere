import type { ServerSettings } from "../api/client";
import type { NewSessionDefaults } from "@yep-anywhere/shared";
import {
  readNewSessionDisplayDefaults,
  writeNewSessionDisplayDefaults,
} from "./newSessionDisplayDefaults";
import {
  createClientQueryKey,
  type ClientQueryRequestContext,
} from "./clientQueryController";
import type { ClientSummarySourceKey } from "./clientSummarySourceKey";

export interface ServerSettingsSnapshot {
  settings: ServerSettings | null;
  displayDefaults?: NewSessionDefaults;
  observedAt?: number;
}

export const EMPTY_SERVER_SETTINGS_SNAPSHOT: ServerSettingsSnapshot = {
  settings: null,
};

export const SERVER_SETTINGS_QUERY_KEY = createClientQueryKey({
  endpoint: "settings",
});
export type ServerSettingsResponse = { settings: ServerSettings };

const serverSettingsSnapshotsBySource = new Map<
  ClientSummarySourceKey,
  ServerSettingsSnapshot
>();
const serverSettingsSnapshotListeners = new Set<() => void>();

function emitServerSettingsSnapshotChange(): void {
  for (const listener of Array.from(serverSettingsSnapshotListeners)) {
    listener();
  }
}

export function subscribeServerSettingsSnapshots(
  listener: () => void,
): () => void {
  serverSettingsSnapshotListeners.add(listener);
  return () => {
    serverSettingsSnapshotListeners.delete(listener);
  };
}

export function getServerSettingsSnapshot(
  sourceKey: ClientSummarySourceKey,
): ServerSettingsSnapshot {
  let snapshot = serverSettingsSnapshotsBySource.get(sourceKey);
  if (!snapshot) {
    snapshot = {
      settings: null,
      displayDefaults: readNewSessionDisplayDefaults(sourceKey),
    };
    serverSettingsSnapshotsBySource.set(sourceKey, snapshot);
  }
  return snapshot;
}

export function acceptServerSettingsSnapshot(
  sourceKey: ClientSummarySourceKey,
  settings: ServerSettings,
  observedAt: number,
): void {
  const current = serverSettingsSnapshotsBySource.get(sourceKey);
  if (current?.observedAt !== undefined && current.observedAt > observedAt) {
    return;
  }

  serverSettingsSnapshotsBySource.set(sourceKey, {
    settings,
    observedAt,
  });
  writeNewSessionDisplayDefaults(sourceKey, settings.newSessionDefaults);
  emitServerSettingsSnapshotChange();
}

export function nextMutationObservedAt(
  sourceKey: ClientSummarySourceKey,
): number {
  const currentObservedAt =
    serverSettingsSnapshotsBySource.get(sourceKey)?.observedAt ??
    Number.NEGATIVE_INFINITY;
  return Math.max(Date.now(), currentObservedAt + 1);
}

export function applySettingsQuerySnapshot(
  response: ServerSettingsResponse,
  context: ClientQueryRequestContext,
) {
  acceptServerSettingsSnapshot(
    context.sourceKey,
    response.settings,
    context.requestStartedAt,
  );
}

export function resetServerSettingsForTests(): void {
  serverSettingsSnapshotsBySource.clear();
  serverSettingsSnapshotListeners.clear();
}
