import type {
  ProjectQueueItemSummary,
  UpdateProjectQueueItemRequest,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { activityBus } from "../lib/activityBus";
import { serverSupportsProjectQueue } from "../lib/projectQueueVisibility";
import {
  reportProjectQueueCollectionSnapshot,
  useProjectQueueItemsByProject,
} from "../lib/sessionCollectionExternalStore";
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

export function useProjectQueues(
  projectIds: readonly string[],
): UseProjectQueuesResult {
  const { version } = useVersion();
  const enabled = serverSupportsProjectQueue(version);
  const normalizedProjectIds = useMemo(
    () => uniqueProjectIds(projectIds),
    [projectIds],
  );
  const projectIdsKey = normalizedProjectIds.join("\0");
  const projectIdsRef = useRef(normalizedProjectIds);
  const hasResolvedInitialFetchRef = useRef(false);
  const storedQueuesByProject = useProjectQueueItemsByProject(
    normalizedProjectIds,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);

  useEffect(() => {
    projectIdsRef.current = normalizedProjectIds;
  }, [normalizedProjectIds]);

  const fetchQueues = useCallback(async () => {
    const ids = projectIdsRef.current;
    if (!enabled || ids.length === 0) {
      setError(null);
      setLoading(false);
      hasResolvedInitialFetchRef.current = true;
      return;
    }

    setLoading(!hasResolvedInitialFetchRef.current);
    setError(null);
    const requestStartedAt = Date.now();
    try {
      const responses = await Promise.all(
        ids.map((projectId) => api.getProjectQueue(projectId)),
      );
      for (const response of responses) {
        reportProjectQueueCollectionSnapshot(response, requestStartedAt);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      hasResolvedInitialFetchRef.current = true;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    hasResolvedInitialFetchRef.current = false;
    void fetchQueues();
  }, [fetchQueues, projectIdsKey]);

  useEffect(() => {
    if (!enabled) return;
    const handleRefresh = () => {
      void fetchQueues();
    };

    const unsubscribeReconnect = activityBus.on("reconnect", handleRefresh);
    const unsubscribeRefresh = activityBus.on("refresh", handleRefresh);

    return () => {
      unsubscribeReconnect();
      unsubscribeRefresh();
    };
  }, [enabled, fetchQueues]);

  const updateItem = useCallback(
    async (
      projectId: string,
      itemId: string,
      request: UpdateProjectQueueItemRequest,
    ) => {
      setMutatingItemId(itemId);
      setError(null);
      try {
        const response = await api.updateProjectQueueItem(
          projectId,
          itemId,
          request,
        );
        reportProjectQueueCollectionSnapshot(response.queue);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setMutatingItemId(null);
      }
    },
    [],
  );

  const deleteItem = useCallback(async (projectId: string, itemId: string) => {
    setMutatingItemId(itemId);
    setError(null);
    try {
      const response = await api.deleteProjectQueueItem(projectId, itemId);
      reportProjectQueueCollectionSnapshot(response.queue);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingItemId(null);
    }
  }, []);

  const retryItem = useCallback(async (projectId: string, itemId: string) => {
    setMutatingItemId(itemId);
    setError(null);
    try {
      const response = await api.retryProjectQueueItem(projectId, itemId);
      reportProjectQueueCollectionSnapshot(response.queue);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingItemId(null);
    }
  }, []);

  const items = useMemo(
    () => flattenQueues(enabled ? storedQueuesByProject : {}),
    [enabled, storedQueuesByProject],
  );

  return {
    queuesByProject: enabled ? storedQueuesByProject : {},
    items,
    loading,
    error,
    mutatingItemId,
    refetch: fetchQueues,
    updateItem,
    deleteItem,
    retryItem,
  };
}
