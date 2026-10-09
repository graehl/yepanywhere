import {
  type EnrichedRecentEntry,
  type RecentSessionsResponse,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../api/client";
import { createRecentsApi } from "../api/recentsClient";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionContext";
import { isRemoteClient } from "../lib/connection";
import {
  createClientQueryKey,
  ensureClientQuery,
  type ClientQueryRequestContext,
  invalidateClientQuery,
} from "../lib/clientQueryController";
import {
  type ClientSummarySourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
} from "../lib/clientSummaryStore";
import { getSourceRuntimeRegistry } from "../lib/sourceRuntime";
import { catalogLoadState } from "../lib/clientSummaryCollections";
import { useRetainedClientQuery } from "./useRetainedClientQuery";
import { readVersionInfo } from "./useVersion";

export type { EnrichedRecentEntry };

/** @deprecated Use EnrichedRecentEntry instead */
export interface RecentSessionEntry {
  sessionId: string;
  projectId: string;
  visitedAt: string;
}

interface UseRecentSessionsOptions {
  limit?: number;
}

// The server bounds this collection to 100 visits. One source collection
// serves every consumer's slice and every catalog-update revalidation.
const RECENTS_QUERY_KEY = createClientQueryKey({
  endpoint: "recents",
  limit: 100,
});
interface RecentsSnapshot {
  recents: EnrichedRecentEntry[];
  catalog?: RecentSessionsResponse["catalog"];
  loaded: boolean;
  visits: RecentSessionEntry[];
}
const EMPTY_SNAPSHOT: RecentsSnapshot = {
  recents: [],
  visits: [],
  loaded: false,
};
const snapshots = new Map<ClientSummarySourceKey, RecentsSnapshot>();
const listeners = new Set<() => void>();
const consumers = new Map<ClientSummarySourceKey, number>();
const REVALIDATE_EVENTS = [
  "refresh",
  "reconnect",
  "session-catalog-updated",
  "recents-changed",
  "session-id-remapped",
  "projects-changed",
] as const;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readSnapshot(sourceKey: ClientSummarySourceKey): RecentsSnapshot {
  return snapshots.get(sourceKey) ?? EMPTY_SNAPSHOT;
}

function publish(sourceKey: ClientSummarySourceKey, snapshot: RecentsSnapshot) {
  snapshots.set(sourceKey, snapshot);
  for (const listener of listeners) listener();
}

function acceptSnapshot(
  sourceKey: ClientSummarySourceKey,
  response: RecentSessionsResponse,
) {
  const previous = readSnapshot(sourceKey);
  const visits = response.visits ?? response.recents;
  const known = new Map(
    previous.recents.map((entry) => [entry.sessionId, entry]),
  );
  const recents = response.recents.map((entry) => ({
    ...entry,
    title:
      entry.title === undefined
        ? (known.get(entry.sessionId)?.title ?? null)
        : entry.title,
  }));
  // An uninitialized/reset catalog cannot establish that saved visits vanished.
  if (response.catalog?.complete === false || response.catalog?.refreshing) {
    const observed = new Set(recents.map((entry) => entry.sessionId));
    const pending = new Set(
      visits.map((entry) => entry.sessionId).filter((id) => !observed.has(id)),
    );
    recents.push(
      ...previous.recents.filter((entry) => pending.has(entry.sessionId)),
    );
    recents.sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  }
  publish(sourceKey, {
    recents,
    catalog: response.catalog,
    visits,
    loaded: true,
  });
}

export function resetRecentSessionsForTests() {
  snapshots.clear();
  listeners.clear();
  consumers.clear();
}

function createRecentsQuery(
  sourceKey: ClientSummarySourceKey,
  recentsApi: ReturnType<typeof createRecentsApi>,
) {
  return {
    sourceKey,
    key: RECENTS_QUERY_KEY,
    fetcher: (context: ClientQueryRequestContext) => {
      const version = readVersionInfo(context.sourceKey);
      // The legacy response remains complete when this preference is ignored.
      return recentsApi.getRecents(
        100,
        version === null ||
          serverHasCapability(version, SERVER_CAPABILITIES.retainedRecents.name)
          ? "retained"
          : undefined,
      );
    },
    applySnapshot: (
      response: RecentSessionsResponse,
      context: ClientQueryRequestContext,
    ) => acceptSnapshot(context.sourceKey, response),
  };
}

export function primeLocalRecentSessions() {
  const runtime = getSourceRuntimeRegistry().getOrCreateSourceRuntime(
    LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  );
  return ensureClientQuery(
    createRecentsQuery(
      runtime.sourceKey,
      createRecentsApi(runtime.transport.fetch.bind(runtime.transport)),
    ),
  );
}

/**
 * Record a session visit (fire-and-forget).
 * Can be called from outside React components.
 */
export function recordSessionVisit(sessionId: string, projectId: string): void {
  api.recordVisit(sessionId, projectId).catch((err) => {
    console.error("Failed to record session visit:", err);
  });
}

/**
 * Hook to access recent sessions list from the server.
 * Fetches on mount and provides methods to record visits and clear.
 * Returns enriched entries with session title and project name.
 */
export function useRecentSessions(options: UseRecentSessionsOptions = {}): {
  recentSessions: EnrichedRecentEntry[];
  recentProjectIds: string[];
  isLoadingVisits: boolean;
  isLoading: boolean;
  error: Error | null;
  recordVisit: (sessionId: string, projectId: string) => void;
  clearRecents: () => void;
  refetch: () => void;
} {
  const { limit = 50 } = options;
  const runtime = useCurrentSourceRuntime();
  const { sourceKey } = runtime;
  useEffect(() => {
    consumers.set(sourceKey, (consumers.get(sourceKey) ?? 0) + 1);
    return () => {
      const remaining = (consumers.get(sourceKey) ?? 1) - 1;
      if (remaining) consumers.set(sourceKey, remaining);
      else {
        consumers.delete(sourceKey);
        snapshots.delete(sourceKey);
        invalidateClientQuery(sourceKey, RECENTS_QUERY_KEY);
      }
    };
  }, [sourceKey]);
  const recentsApi = useMemo(
    () => createRecentsApi(runtime.transport.fetch.bind(runtime.transport)),
    [runtime],
  );
  const remoteConnection = useOptionalRemoteConnection();
  const ready = !isRemoteClient() || Boolean(remoteConnection?.connection);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => readSnapshot(sourceKey),
    () => EMPTY_SNAPSHOT,
  );
  const { loading, error, refetch } = useRetainedClientQuery({
    ...createRecentsQuery(sourceKey, recentsApi),
    bootstrapTier: "route",
    ready,
    hasData: snapshot.loaded,
    revalidateOn: REVALIDATE_EVENTS,
  });
  const fetchRecents = useCallback(() => {
    if (consumers.has(sourceKey)) void refetch({ force: true });
  }, [refetch, sourceKey]);

  const recordVisit = useCallback(
    (sessionId: string, projectId: string) => {
      // Optimistic update: move existing entry to front (preserving enrichment)
      const prev = readSnapshot(sourceKey);
      const existing = prev.recents.find((e) => e.sessionId === sessionId);
      const recents = existing
        ? [
            { ...existing, visitedAt: new Date().toISOString() },
            ...prev.recents.filter((e) => e.sessionId !== sessionId),
          ]
        : prev.recents;
      invalidateClientQuery(sourceKey, RECENTS_QUERY_KEY);
      publish(sourceKey, {
        ...prev,
        recents,
        visits: [
          { sessionId, projectId, visitedAt: new Date().toISOString() },
          ...prev.visits.filter((entry) => entry.sessionId !== sessionId),
        ].slice(0, 100),
      });

      // Fire and forget to server
      recentsApi
        .recordVisit(sessionId, projectId)
        .then(fetchRecents)
        .catch((err) => {
          console.error("Failed to record session visit:", err);
          // Refetch to sync with server state
          fetchRecents();
        });
    },
    [fetchRecents, recentsApi, sourceKey],
  );

  const clearRecents = useCallback(() => {
    // Optimistic update
    invalidateClientQuery(sourceKey, RECENTS_QUERY_KEY);
    publish(sourceKey, { recents: [], visits: [], loaded: true });

    recentsApi
      .clearRecents()
      .then(fetchRecents)
      .catch((err) => {
        console.error("Failed to clear recents:", err);
        // Refetch to sync with server state
        fetchRecents();
      });
  }, [fetchRecents, recentsApi, sourceKey]);

  const catalogState = catalogLoadState(
    snapshot.catalog,
    snapshot.recents.length,
  );
  const recentProjectIds = useMemo(
    () => [
      ...new Set(
        snapshot.visits.slice(0, limit).map((entry) => entry.projectId),
      ),
    ],
    [snapshot.visits, limit],
  );

  return {
    recentSessions: snapshot.recents.slice(0, limit),
    recentProjectIds,
    isLoadingVisits: loading || !ready,
    isLoading:
      loading ||
      !ready ||
      (snapshot.recents.length === 0 &&
        snapshot.visits.length > 0 &&
        Boolean(snapshot.catalog?.refreshing)),
    error: error ?? catalogState.refreshError,
    recordVisit,
    clearRecents,
    refetch: fetchRecents,
  };
}
