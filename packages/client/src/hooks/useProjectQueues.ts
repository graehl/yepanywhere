import type {
  ProjectQueueDispatchState,
  ProjectQueueItemSummary,
  ProjectQueueProjectStatus,
  ProjectQueuePromoteNowResult,
  ProjectQueueRecoveredSessionQueueSummary,
  UpdateProjectQueueItemRequest,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { createClientQueryKey } from "../lib/clientQueryController";
import { isRemoteClient } from "../lib/connection";
import { serverSupportsProjectQueue } from "../lib/projectQueueVisibility";
import {
  useProjectQueueDispatchState,
  useProjectQueueGlobalItems,
  useProjectQueueItemsByProject,
  useProjectQueueProjectStatusesByProject,
  useProjectQueueRecoveredSessionQueues,
} from "../lib/clientSummaryStore";
import { useRetainedClientQuery } from "./useRetainedClientQuery";
import { useVersion } from "./useVersion";

export interface UseProjectQueuesResult {
  queuesByProject: Record<string, readonly ProjectQueueItemSummary[]>;
  items: readonly ProjectQueueItemSummary[];
  projectStatusesByProject: Record<string, ProjectQueueProjectStatus>;
  recoveredSessionQueues: ProjectQueueRecoveredSessionQueueSummary[];
  loading: boolean;
  error: Error | null;
  mutatingItemId: string | null;
  mutatingDispatchState: boolean;
  mutatingPromoteItemId: string | null;
  dispatchState: ProjectQueueDispatchState;
  refetch: () => Promise<void>;
  pauseDispatch: () => Promise<void>;
  resumeDispatch: () => Promise<void>;
  promoteNow: (
    projectId: string,
    itemId: string,
    options?: { force?: boolean },
  ) => Promise<ProjectQueuePromoteNowResult>;
  updateItem: (
    projectId: string,
    itemId: string,
    request: UpdateProjectQueueItemRequest,
  ) => Promise<void>;
  deleteItem: (projectId: string, itemId: string) => Promise<void>;
  retryItem: (projectId: string, itemId: string) => Promise<void>;
  moveItemToTop: (projectId: string, itemId: string) => Promise<void>;
}

function uniqueProjectIds(projectIds: readonly string[]): string[] {
  return [...new Set(projectIds.filter(Boolean))];
}

function flattenQueues(
  queuesByProject: Record<string, readonly ProjectQueueItemSummary[]>,
): readonly ProjectQueueItemSummary[] {
  return Object.values(queuesByProject).flat();
}

const PROJECT_QUEUE_QUERY_KEY = createClientQueryKey({
  endpoint: "project-queue",
});
const PROJECT_QUEUE_REVALIDATE_EVENTS = [
  "refresh",
  "reconnect",
  "project-queue-changed",
  "session-queue-persistence-changed",
] as const;
const RUNNING_DISPATCH_STATE: ProjectQueueDispatchState = {
  status: "running",
};

export function useProjectQueues(
  projectIds: readonly string[],
): UseProjectQueuesResult {
  const { version } = useVersion();
  const runtime = useCurrentSourceRuntime();
  const sourceKey = runtime.sourceKey;
  const sourceSummary = runtime.summary;
  const remoteConnection = useOptionalRemoteConnection();
  const enabled = serverSupportsProjectQueue(version);
  const ready =
    !isRemoteClient() ||
    (remoteConnection !== null && remoteConnection.connection !== null);
  const normalizedProjectIds = useMemo(
    () => uniqueProjectIds(projectIds),
    [projectIds],
  );
  const storedQueuesByProject =
    useProjectQueueItemsByProject(normalizedProjectIds);
  const storedGlobalItems = useProjectQueueGlobalItems(normalizedProjectIds);
  const storedDispatchState = useProjectQueueDispatchState();
  const storedRecoveredSessionQueues = useProjectQueueRecoveredSessionQueues();
  const storedProjectStatusesByProject =
    useProjectQueueProjectStatusesByProject();
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [mutatingDispatchState, setMutatingDispatchState] = useState(false);
  const [mutatingPromoteItemId, setMutatingPromoteItemId] = useState<
    string | null
  >(null);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const queryEnabled = enabled && normalizedProjectIds.length > 0;
  const hasData = Object.keys(storedQueuesByProject).length > 0;
  const {
    loading,
    error: queryError,
    refetch,
  } = useRetainedClientQuery({
    sourceKey,
    key: PROJECT_QUEUE_QUERY_KEY,
    enabled: queryEnabled,
    ready,
    hasData,
    revalidateOn: PROJECT_QUEUE_REVALIDATE_EVENTS,
    fetcher: () => api.getProjectQueueItems(),
    applySnapshot: (data, context) => {
      sourceSummary.reportProjectQueueGlobalCollectionSnapshot(
        data,
        context.requestStartedAt,
      );
    },
  });

  const updateItem = useCallback(
    async (
      projectId: string,
      itemId: string,
      request: UpdateProjectQueueItemRequest,
    ) => {
      setMutatingItemId(itemId);
      setMutationError(null);
      const requestSummary = sourceSummary;
      try {
        const response = await api.updateProjectQueueItem(
          projectId,
          itemId,
          request,
        );
        requestSummary.reportProjectQueueCollectionSnapshot(response.queue);
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingItemId(null);
      }
    },
    [sourceSummary],
  );

  const deleteItem = useCallback(
    async (projectId: string, itemId: string) => {
      setMutatingItemId(itemId);
      setMutationError(null);
      const requestSummary = sourceSummary;
      try {
        const response = await api.deleteProjectQueueItem(projectId, itemId);
        requestSummary.reportProjectQueueCollectionSnapshot(response.queue);
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingItemId(null);
      }
    },
    [sourceSummary],
  );

  const retryItem = useCallback(
    async (projectId: string, itemId: string) => {
      setMutatingItemId(itemId);
      setMutationError(null);
      const requestSummary = sourceSummary;
      try {
        const response = await api.retryProjectQueueItem(projectId, itemId);
        requestSummary.reportProjectQueueCollectionSnapshot(response.queue);
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingItemId(null);
      }
    },
    [sourceSummary],
  );

  const moveItemToTop = useCallback(
    async (projectId: string, itemId: string) => {
      setMutatingItemId(itemId);
      setMutationError(null);
      const requestSummary = sourceSummary;
      try {
        const response = await api.moveProjectQueueItemToTop(projectId, itemId);
        requestSummary.reportProjectQueueCollectionSnapshot(response.queue);
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingItemId(null);
      }
    },
    [sourceSummary],
  );

  const refetchQueues = useCallback(async () => {
    setMutationError(null);
    await refetch();
  }, [refetch]);

  const pauseDispatch = useCallback(async () => {
    setMutatingDispatchState(true);
    setMutationError(null);
    const requestSummary = sourceSummary;
    try {
      const response = await api.pauseProjectQueueDispatch();
      requestSummary.reportProjectQueueGlobalCollectionSnapshot(response);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingDispatchState(false);
    }
  }, [sourceSummary]);

  const resumeDispatch = useCallback(async () => {
    setMutatingDispatchState(true);
    setMutationError(null);
    const requestSummary = sourceSummary;
    try {
      const response = await api.resumeProjectQueueDispatch();
      requestSummary.reportProjectQueueGlobalCollectionSnapshot(response);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingDispatchState(false);
    }
  }, [sourceSummary]);

  const promoteNow = useCallback(
    async (
      projectId: string,
      itemId: string,
      options: { force?: boolean } = {},
    ) => {
      setMutatingPromoteItemId(itemId);
      setMutationError(null);
      const requestSummary = sourceSummary;
      try {
        const response = await api.promoteProjectQueueNow(projectId, {
          itemId,
          ...(options.force ? { force: true } : {}),
        });
        requestSummary.reportProjectQueueGlobalCollectionSnapshot(response);
        return response.promoteResult;
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingPromoteItemId(null);
      }
    },
    [sourceSummary],
  );

  const items = useMemo(
    () =>
      enabled
        ? storedGlobalItems.length > 0
          ? storedGlobalItems
          : flattenQueues(storedQueuesByProject)
        : [],
    [enabled, storedGlobalItems, storedQueuesByProject],
  );
  const projectIdSet = useMemo(
    () => new Set(normalizedProjectIds),
    [normalizedProjectIds],
  );
  const recoveredSessionQueues = useMemo(
    () =>
      enabled
        ? storedRecoveredSessionQueues.filter((item) =>
            projectIdSet.has(item.projectId),
          )
        : [],
    [enabled, projectIdSet, storedRecoveredSessionQueues],
  );

  useEffect(() => {
    if (
      !enabled ||
      (items.length === 0 && recoveredSessionQueues.length === 0)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refetchQueues();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, items.length, recoveredSessionQueues.length, refetchQueues]);

  return {
    queuesByProject: enabled ? storedQueuesByProject : {},
    items,
    projectStatusesByProject: enabled ? storedProjectStatusesByProject : {},
    recoveredSessionQueues,
    loading,
    error: mutationError ?? queryError,
    mutatingItemId,
    mutatingDispatchState,
    mutatingPromoteItemId,
    dispatchState: enabled ? storedDispatchState : RUNNING_DISPATCH_STATE,
    refetch: refetchQueues,
    pauseDispatch,
    resumeDispatch,
    promoteNow,
    updateItem,
    deleteItem,
    retryItem,
    moveItemToTop,
  };
}
