import {
  type EnrichedRecentEntry,
  type RecentSessionsResponse,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import {
  createClientQueryKey,
  type ClientQueryRequestContext,
  invalidateClientQuery,
} from "./clientQueryController";
import type { ClientSummarySourceKey } from "./clientSummarySourceKey";
import { readVersionInfo } from "./versionQuery";

export const RECENTS_QUERY_KEY = createClientQueryKey({
  endpoint: "recents",
  limit: 100,
});
interface RecentsSnapshot {
  recents: EnrichedRecentEntry[];
  catalog?: RecentSessionsResponse["catalog"];
  loaded: boolean;
  visits: { sessionId: string; projectId: string; visitedAt: string }[];
}
export const EMPTY_RECENTS_SNAPSHOT: RecentsSnapshot = {
  recents: [],
  visits: [],
  loaded: false,
};
const snapshots = new Map<ClientSummarySourceKey, RecentsSnapshot>();
const listeners = new Set<() => void>();
const consumers = new Map<ClientSummarySourceKey, number>();

export function subscribeRecents(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readRecentsSnapshot(
  sourceKey: ClientSummarySourceKey,
): RecentsSnapshot {
  return snapshots.get(sourceKey) ?? EMPTY_RECENTS_SNAPSHOT;
}

export function publishRecentsSnapshot(
  sourceKey: ClientSummarySourceKey,
  snapshot: RecentsSnapshot,
) {
  snapshots.set(sourceKey, snapshot);
  for (const listener of listeners) listener();
}

function acceptRecentsSnapshot(
  sourceKey: ClientSummarySourceKey,
  response: RecentSessionsResponse,
) {
  const previous = readRecentsSnapshot(sourceKey);
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
  publishRecentsSnapshot(sourceKey, {
    recents,
    catalog: response.catalog,
    visits,
    loaded: true,
  });
}

export function retainRecentsSource(sourceKey: ClientSummarySourceKey) {
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
}

export function hasRecentsConsumers(sourceKey: ClientSummarySourceKey) {
  return consumers.has(sourceKey);
}

export function resetRecentSessionsForTests() {
  snapshots.clear();
  listeners.clear();
  consumers.clear();
}

/** One bounded recent-visits collection serves every route consumer. */
export function createRecentsQuery(
  sourceKey: ClientSummarySourceKey,
  recentsApi: {
    getRecents: (
      limit: number,
      summaryMode: "retained" | undefined,
    ) => Promise<RecentSessionsResponse>;
  },
) {
  return {
    sourceKey,
    key: RECENTS_QUERY_KEY,
    fetcher: (context: ClientQueryRequestContext) => {
      const version = readVersionInfo(context.sourceKey);
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
    ) => acceptRecentsSnapshot(context.sourceKey, response),
  };
}
