import type {
  ProjectQueueDispatchState,
  ProjectQueueItemSummary,
  ProjectQueueRecoveredSessionQueueSummary,
  UpdateProjectQueueItemRequest,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionContext";
import { activityBus } from "../lib/activityBus";
import { createClientQueryKey } from "../lib/clientQueryController";
import { isRemoteClient } from "../lib/connection";
import { serverSupportsProjectQueue } from "../lib/projectQueueVisibility";
import {
  reportProjectQueueCollectionSnapshot,
  reportProjectQueueGlobalCollectionSnapshot,
  useClientSummarySourceKey,
  useProjectQueueItemsByProject,
} from "../lib/clientSummaryStore";
import { useRetainedClientQuery } from "./useRetainedClientQuery";
import { useVersion } from "./useVersion";

export interface UseProjectQueuesResult {
  queuesByProject: Record<string, readonly ProjectQueueItemSummary[]>;
  items: ProjectQueueItemSummary[];
  recoveredSessionQueues: ProjectQueueRecoveredSessionQueueSummary[];
  loading: boolean;
  error: Error | null;
  mutatingItemId: string | null;
  mutatingDispatchState: boolean;
  dispatchState: ProjectQueueDispatchState;
  refetch: () => Promise<void>;
  pauseDispatch: () => Promise<void>;
  resumeDispatch: () => Promise<void>;
  updateItem: (
    projectId: string,
    itemId: string,
    request: UpdateProjectQueueItemRequest,
  ) => Promise<void>;
  deleteItem: (projectId: string, itemId: string) => Promise<void>;
  retryItem: (projectId: string, itemId: string) => Promise<void>;
}

function uniqueProjectIds(projectIds: readonly string[]): string[] {
  return [...new Set(projectIds.filter(Boolean))];
}

function flattenQueues(
  queuesByProject: Record<string, readonly ProjectQueueItemSummary[]>,
): ProjectQueueItemSummary[] {
  return Object.values(queuesByProject)
    .flat()
    .sort((a, b) => {
      const created = a.createdAt.localeCompare(b.createdAt);
      return created !== 0 ? created : a.id.localeCompare(b.id);
    });
}

const PROJECT_QUEUE_QUERY_KEY = createClientQueryKey({
  endpoint: "project-queue",
});
const PROJECT_QUEUE_REVALIDATE_EVENTS = [
  "refresh",
  "reconnect",
  "session-queue-persistence-changed",
] as const;
const RUNNING_DISPATCH_STATE: ProjectQueueDispatchState = { status: "running" };

export function useProjectQueues(
  projectIds: readonly string[],
): UseProjectQueuesResult {
  const { version } = useVersion();
  const sourceKey = useClientSummarySourceKey();
  const remoteConnection = useOptionalRemoteConnection();
  const enabled = serverSupportsProjectQueue(version);
  const ready =
    !isRemoteClient() ||
    (remoteConnection !== null && remoteConnection.connection !== null);
  const normalizedProjectIds = useMemo(
    () => uniqueProjectIds(projectIds),
    [projectIds],
  );
  const storedQueuesByProject = useProjectQueueItemsByProject(
    normalizedProjectIds,
  );
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [mutatingDispatchState, setMutatingDispatchState] = useState(false);
  const [dispatchState, setDispatchState] = useState<ProjectQueueDispatchState>(
    RUNNING_DISPATCH_STATE,
  );
  const [storedRecoveredSessionQueues, setStoredRecoveredSessionQueues] =
    useState<ProjectQueueRecoveredSessionQueueSummary[]>([]);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const queryEnabled = enabled && normalizedProjectIds.length > 0;
  const hasData = Object.keys(storedQueuesByProject).length > 0;
  const { loading, error: queryError, refetch } = useRetainedClientQuery({
    sourceKey,
    key: PROJECT_QUEUE_QUERY_KEY,
    enabled: queryEnabled,
    ready,
    hasData,
    revalidateOn: PROJECT_QUEUE_REVALIDATE_EVENTS,
    fetcher: () => api.getProjectQueueItems(),
    applySnapshot: (data, context) => {
      setDispatchState(data.dispatchState ?? RUNNING_DISPATCH_STATE);
      setStoredRecoveredSessionQueues(data.recoveredSessionQueues ?? []);
      reportProjectQueueGlobalCollectionSnapshot(
        context.sourceKey,
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
      const requestSourceKey = sourceKey;
      try {
        const response = await api.updateProjectQueueItem(
          projectId,
          itemId,
          request,
        );
        setDispatchState(
          response.queue.dispatchState ?? RUNNING_DISPATCH_STATE,
        );
        reportProjectQueueCollectionSnapshot(requestSourceKey, response.queue);
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingItemId(null);
      }
    },
    [sourceKey],
  );

  const deleteItem = useCallback(async (projectId: string, itemId: string) => {
    setMutatingItemId(itemId);
    setMutationError(null);
    const requestSourceKey = sourceKey;
    try {
      const response = await api.deleteProjectQueueItem(projectId, itemId);
      setDispatchState(response.queue.dispatchState ?? RUNNING_DISPATCH_STATE);
      reportProjectQueueCollectionSnapshot(requestSourceKey, response.queue);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingItemId(null);
    }
  }, [sourceKey]);

  const retryItem = useCallback(async (projectId: string, itemId: string) => {
    setMutatingItemId(itemId);
    setMutationError(null);
    const requestSourceKey = sourceKey;
    try {
      const response = await api.retryProjectQueueItem(projectId, itemId);
      setDispatchState(response.queue.dispatchState ?? RUNNING_DISPATCH_STATE);
      reportProjectQueueCollectionSnapshot(requestSourceKey, response.queue);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingItemId(null);
    }
  }, [sourceKey]);

  const refetchQueues = useCallback(async () => {
    setMutationError(null);
    await refetch();
  }, [refetch]);

  const pauseDispatch = useCallback(async () => {
    setMutatingDispatchState(true);
    setMutationError(null);
    const requestSourceKey = sourceKey;
    try {
      const response = await api.pauseProjectQueueDispatch();
      setDispatchState(response.dispatchState ?? RUNNING_DISPATCH_STATE);
      setStoredRecoveredSessionQueues(response.recoveredSessionQueues ?? []);
      reportProjectQueueGlobalCollectionSnapshot(requestSourceKey, response);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingDispatchState(false);
    }
  }, [sourceKey]);

  const resumeDispatch = useCallback(async () => {
    setMutatingDispatchState(true);
    setMutationError(null);
    const requestSourceKey = sourceKey;
    try {
      const response = await api.resumeProjectQueueDispatch();
      setDispatchState(response.dispatchState ?? RUNNING_DISPATCH_STATE);
      setStoredRecoveredSessionQueues(response.recoveredSessionQueues ?? []);
      reportProjectQueueGlobalCollectionSnapshot(requestSourceKey, response);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingDispatchState(false);
    }
  }, [sourceKey]);

  useEffect(() => {
    return activityBus.on("project-queue-changed", (event) => {
      if (event.dispatchState) {
        setDispatchState(event.dispatchState);
      }
    });
  }, []);

  const items = useMemo(
    () => flattenQueues(enabled ? storedQueuesByProject : {}),
    [enabled, storedQueuesByProject],
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

  return {
    queuesByProject: enabled ? storedQueuesByProject : {},
    items,
    recoveredSessionQueues,
    loading,
    error: mutationError ?? queryError,
    mutatingItemId,
    mutatingDispatchState,
    dispatchState: enabled ? dispatchState : RUNNING_DISPATCH_STATE,
    refetch: refetchQueues,
    pauseDispatch,
    resumeDispatch,
    updateItem,
    deleteItem,
    retryItem,
  };
}
