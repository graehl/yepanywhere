import type {
  ProjectQueueItemSummary,
  UpdateProjectQueueItemRequest,
} from "@yep-anywhere/shared";
import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionContext";
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
  loading: boolean;
  error: Error | null;
  mutatingItemId: string | null;
  refetch: () => Promise<void>;
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
const PROJECT_QUEUE_REVALIDATE_EVENTS = ["refresh", "reconnect"] as const;

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

  const items = useMemo(
    () => flattenQueues(enabled ? storedQueuesByProject : {}),
    [enabled, storedQueuesByProject],
  );

  return {
    queuesByProject: enabled ? storedQueuesByProject : {},
    items,
    loading,
    error: mutationError ?? queryError,
    mutatingItemId,
    refetch: refetchQueues,
    updateItem,
    deleteItem,
    retryItem,
  };
}
