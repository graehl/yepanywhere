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
import { createClientQueryKey } from "../lib/clientQueryController";
import { isRemoteClient } from "../lib/connection";
import { serverSupportsProjectQueue } from "../lib/projectQueueVisibility";
import {
  reportProjectQueueCollectionSnapshot,
  reportProjectQueueGlobalCollectionSnapshot,
  useClientSummarySourceKey,
  useProjectQueueDispatchState,
  useProjectQueueItemsByProject,
  useProjectQueueRecoveredSessionQueues,
} from "../lib/clientSummaryStore";
import { useRetainedClientQuery } from "./useRetainedClientQuery";
import { useVersion } from "./useVersion";

export interface UseProjectQueuesResult {
  queuesByProject: Record<string, readonly ProjectQueueItemSummary[]>;
  items: ProjectQueueItemSummary[];
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
): ProjectQueueItemSummary[] {
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

function mergeProjectStatuses(
  current: Record<string, ProjectQueueProjectStatus>,
  next: Record<string, ProjectQueueProjectStatus> | undefined,
): Record<string, ProjectQueueProjectStatus> {
  return next ? { ...current, ...next } : current;
}

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
  const storedDispatchState = useProjectQueueDispatchState();
  const storedRecoveredSessionQueues = useProjectQueueRecoveredSessionQueues();
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [mutatingDispatchState, setMutatingDispatchState] = useState(false);
  const [mutatingPromoteItemId, setMutatingPromoteItemId] = useState<
    string | null
  >(null);
  const [projectStatusesByProject, setProjectStatusesByProject] = useState<
    Record<string, ProjectQueueProjectStatus>
  >({});
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
      setProjectStatusesByProject(data.projectStatuses ?? {});
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
        setProjectStatusesByProject((current) =>
          mergeProjectStatuses(current, response.queue.projectStatuses),
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
      setProjectStatusesByProject((current) =>
        mergeProjectStatuses(current, response.queue.projectStatuses),
      );
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
      setProjectStatusesByProject((current) =>
        mergeProjectStatuses(current, response.queue.projectStatuses),
      );
      reportProjectQueueCollectionSnapshot(requestSourceKey, response.queue);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingItemId(null);
    }
  }, [sourceKey]);

  const moveItemToTop = useCallback(async (projectId: string, itemId: string) => {
    setMutatingItemId(itemId);
    setMutationError(null);
    const requestSourceKey = sourceKey;
    try {
      const response = await api.moveProjectQueueItemToTop(projectId, itemId);
      setProjectStatusesByProject((current) =>
        mergeProjectStatuses(current, response.queue.projectStatuses),
      );
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
      setProjectStatusesByProject(response.projectStatuses ?? {});
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
      setProjectStatusesByProject(response.projectStatuses ?? {});
      reportProjectQueueGlobalCollectionSnapshot(requestSourceKey, response);
    } catch (err) {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingDispatchState(false);
    }
  }, [sourceKey]);

  const promoteNow = useCallback(
    async (
      projectId: string,
      itemId: string,
      options: { force?: boolean } = {},
    ) => {
      setMutatingPromoteItemId(itemId);
      setMutationError(null);
      const requestSourceKey = sourceKey;
      try {
        const response = await api.promoteProjectQueueNow(projectId, {
          itemId,
          ...(options.force ? { force: true } : {}),
        });
        setProjectStatusesByProject(response.projectStatuses ?? {});
        reportProjectQueueGlobalCollectionSnapshot(requestSourceKey, response);
        return response.promoteResult;
      } catch (err) {
        setMutationError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingPromoteItemId(null);
      }
    },
    [sourceKey],
  );

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

  useEffect(() => {
    if (!enabled || (items.length === 0 && recoveredSessionQueues.length === 0)) {
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
    projectStatusesByProject: enabled ? projectStatusesByProject : {},
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
