import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type GlobalSessionItem,
  type GlobalSessionStats,
  type ProjectOption,
} from "../api/client";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionContext";
import { isRemoteClient } from "../lib/connection";
import {
  reportGlobalSessionsCollectionSnapshot,
  reportSessionCollectionCreated,
  reportSessionCollectionMetadataChanged,
  useClientSummarySourceKey,
  useSessionCollectionQueryRecords,
  useSessionCollectionQueryState,
} from "../lib/clientSummaryStore";
import {
  createGlobalSessionsCollectionQueryDescriptor,
  createGlobalSessionsQueryKey,
  type SessionCollectionQueryDescriptor,
} from "../lib/clientSummaryState";
import {
  type ProcessStateEvent,
  type SessionCreatedEvent,
  type SessionMetadataChangedEvent,
  useFileActivity,
} from "./useFileActivity";

const REFETCH_DEBOUNCE_MS = 500;

export interface UseGlobalSessionsOptions {
  projectId?: string | null;
  searchQuery?: string;
  limit?: number;
  includeArchived?: boolean;
  starred?: boolean;
  includeStats?: boolean;
}

export interface UseGlobalSessionsFeedResult {
  query: SessionCollectionQueryDescriptor;
  ready: boolean;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  stats: GlobalSessionStats;
  projects: ProjectOption[];
}

/** Default stats when no data loaded */
export const DEFAULT_GLOBAL_SESSION_STATS: GlobalSessionStats = {
  totalCount: 0,
  unreadCount: 0,
  starredCount: 0,
  archivedCount: 0,
  providerCounts: {},
  executorCounts: {},
};

function shouldRefetchGlobalSessionsAfterProcessState(
  event: ProcessStateEvent,
  matched: boolean,
): boolean {
  return !matched || event.activity !== "in-turn";
}

function sessionCreatedEventToGlobalSessionItem(
  event: SessionCreatedEvent,
  projects: readonly ProjectOption[],
): GlobalSessionItem {
  const project = projects.find((p) => p.id === event.session.projectId);
  const projectName = event.session.projectName ?? project?.name ?? "";

  return {
    id: event.session.id,
    title: event.session.title,
    fullTitle: event.session.fullTitle,
    createdAt: event.session.createdAt,
    updatedAt: event.session.updatedAt,
    messageCount: event.session.messageCount,
    provider: event.session.provider,
    model: event.session.model,
    projectId: event.session.projectId,
    projectName,
    ownership: event.session.ownership,
    pendingInputType: event.session.pendingInputType,
    activity: event.session.activity,
    hasUnread: event.session.hasUnread,
    customTitle: event.session.customTitle,
    isArchived: event.session.isArchived,
    isStarred: event.session.isStarred,
    parentSessionId: event.session.parentSessionId,
    initialPrompt: event.session.initialPrompt,
    executor: event.session.executor,
    lastAgentText: event.session.lastAgentText,
  };
}

export function useGlobalSessionsFeed(
  options: UseGlobalSessionsOptions = {},
): UseGlobalSessionsFeedResult {
  const {
    projectId,
    searchQuery,
    limit,
    includeArchived,
    starred,
    includeStats = false,
  } = options;
  const remoteConnection = useOptionalRemoteConnection();
  const ready =
    !isRemoteClient() ||
    (remoteConnection !== null && remoteConnection.connection !== null);
  const query = useMemo(
    () =>
      createGlobalSessionsCollectionQueryDescriptor({
        projectId,
        searchQuery,
        limit,
        includeArchived,
        starred,
      }),
    [projectId, searchQuery, limit, includeArchived, starred],
  );
  const queryKey = useMemo(() => createGlobalSessionsQueryKey(query), [query]);
  const sourceKey = useClientSummarySourceKey();
  const queryState = useSessionCollectionQueryState(query);
  const queryRecords = useSessionCollectionQueryRecords(query);

  const [stats, setStats] = useState<GlobalSessionStats>(
    DEFAULT_GLOBAL_SESSION_STATS,
  );
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const queryStateRef = useRef(queryState);
  queryStateRef.current = queryState;
  const queryRecordsRef = useRef(queryRecords);
  queryRecordsRef.current = queryRecords;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const projectsRef = useRef<ProjectOption[]>([]);
  projectsRef.current = projects;
  const lastFetchKeyRef = useRef<string | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);

  const fetch = useCallback(async () => {
    if (!readyRef.current) {
      if (!queryStateRef.current) {
        setLoading(true);
      }
      return;
    }

    const fetchKey = `${queryKey}|stats:${includeStats === true && !projectId}`;
    const optionsChanged = lastFetchKeyRef.current !== fetchKey;
    lastFetchKeyRef.current = fetchKey;

    if (!queryStateRef.current || optionsChanged) {
      setLoading(true);
    }
    setError(null);

    const requestId = ++requestSequenceRef.current;
    const requestStartedAt = Date.now();
    const requestSourceKey = sourceKey;
    const queryForRequest = query;

    try {
      const sessionsPromise = api.getGlobalSessions({
        project: projectId ?? undefined,
        q: searchQuery || undefined,
        limit,
        includeArchived,
        starred,
        includeStats: false,
      });
      const statsPromise =
        includeStats && !projectId ? api.getGlobalSessionStats() : null;

      const [data, statsResponse] = await Promise.all([
        sessionsPromise,
        statsPromise,
      ]);

      reportGlobalSessionsCollectionSnapshot(
        requestSourceKey,
        {
          query: queryForRequest,
          sessions: data.sessions,
          hasMore: data.hasMore,
          mode: "replace",
        },
        requestStartedAt,
      );

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setStats(statsResponse?.stats ?? DEFAULT_GLOBAL_SESSION_STATS);
      setProjects(data.projects);
    } catch (err) {
      if (requestId === requestSequenceRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [
    query,
    queryKey,
    projectId,
    searchQuery,
    limit,
    includeArchived,
    starred,
    includeStats,
    sourceKey,
  ]);

  const loadMore = useCallback(async () => {
    if (!readyRef.current || !queryStateRef.current?.hasMore) {
      return;
    }

    const records = queryRecordsRef.current;
    const lastRecord = records[records.length - 1];
    if (!lastRecord) {
      return;
    }
    if (!lastRecord.updatedAt) {
      await fetch();
      return;
    }

    try {
      setError(null);
      const requestStartedAt = Date.now();
      const requestSourceKey = sourceKey;
      const data = await api.getGlobalSessions({
        project: projectId ?? undefined,
        q: searchQuery || undefined,
        limit,
        after: lastRecord.updatedAt,
        includeArchived,
        starred,
        includeStats: false,
      });

      reportGlobalSessionsCollectionSnapshot(
        requestSourceKey,
        {
          query,
          sessions: data.sessions,
          hasMore: data.hasMore,
          mode: "append",
        },
        requestStartedAt,
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [
    fetch,
    query,
    projectId,
    searchQuery,
    limit,
    includeArchived,
    starred,
    sourceKey,
  ]);

  const debouncedRefetch = useCallback(() => {
    if (!readyRef.current) {
      return;
    }
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current);
    }
    refetchTimerRef.current = setTimeout(() => {
      void fetch();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetch]);

  const handleProcessStateChange = useCallback(
    (event: ProcessStateEvent) => {
      const currentlyMatched = queryRecordsRef.current.some(
        (record) => record.id === event.sessionId,
      );
      if (
        shouldRefetchGlobalSessionsAfterProcessState(event, currentlyMatched)
      ) {
        debouncedRefetch();
      }
    },
    [debouncedRefetch],
  );

  const handleSessionCreated = useCallback(
    (event: SessionCreatedEvent) => {
      const observedAt = Date.now();
      reportSessionCollectionCreated(sourceKey, event, observedAt);

      if (projectId && event.session.projectId !== projectId) return;
      if (starred && !event.session.isStarred) return;
      if (includeArchived !== true && event.session.isArchived) return;

      if (searchQuery) {
        debouncedRefetch();
        return;
      }

      reportGlobalSessionsCollectionSnapshot(
        sourceKey,
        {
          query,
          sessions: [
            sessionCreatedEventToGlobalSessionItem(event, projectsRef.current),
          ],
          hasMore: queryStateRef.current?.hasMore ?? false,
          mode: "prepend",
        },
        observedAt,
      );
    },
    [
      projectId,
      starred,
      includeArchived,
      searchQuery,
      debouncedRefetch,
      query,
      sourceKey,
    ],
  );

  const handleSessionMetadataChange = useCallback(
    (event: SessionMetadataChangedEvent) => {
      reportSessionCollectionMetadataChanged(sourceKey, event);

      if (
        searchQuery ||
        (projectId &&
          event.projectId !== undefined &&
          event.projectId !== projectId)
      ) {
        debouncedRefetch();
      }
    },
    [debouncedRefetch, projectId, searchQuery, sourceKey],
  );

  useFileActivity({
    maxEvents: 0,
    onSessionCreated: handleSessionCreated,
    onProcessStateChange: handleProcessStateChange,
    onSessionMetadataChange: handleSessionMetadataChange,
    onReconnect: () => {
      void fetch();
    },
  });

  useEffect(() => {
    if (ready) {
      void fetch();
    }
  }, [fetch, ready]);

  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }
    };
  }, []);

  return {
    query,
    ready,
    loading: loading || (!ready && !queryState),
    error,
    hasMore: queryState?.hasMore ?? false,
    loadMore,
    refetch: fetch,
    stats,
    projects,
  };
}
