import type {
  ProjectQueueChangedEvent,
  ProjectQueueItemSummary,
  UpdateProjectQueueItemRequest,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { activityBus } from "../lib/activityBus";

export interface UseProjectQueuesResult {
  queuesByProject: Record<string, ProjectQueueItemSummary[]>;
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
  queuesByProject: Record<string, ProjectQueueItemSummary[]>,
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
  const normalizedProjectIds = useMemo(
    () => uniqueProjectIds(projectIds),
    [projectIds],
  );
  const projectIdsKey = normalizedProjectIds.join("\0");
  const projectIdsRef = useRef(normalizedProjectIds);
  const hasResolvedInitialFetchRef = useRef(false);
  const [queuesByProject, setQueuesByProject] = useState<
    Record<string, ProjectQueueItemSummary[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);

  useEffect(() => {
    projectIdsRef.current = normalizedProjectIds;
  }, [normalizedProjectIds]);

  const fetchQueues = useCallback(async () => {
    const ids = projectIdsRef.current;
    if (ids.length === 0) {
      setQueuesByProject({});
      setError(null);
      setLoading(false);
      hasResolvedInitialFetchRef.current = true;
      return;
    }

    setLoading(!hasResolvedInitialFetchRef.current);
    setError(null);
    try {
      const responses = await Promise.all(
        ids.map((projectId) => api.getProjectQueue(projectId)),
      );
      const next: Record<string, ProjectQueueItemSummary[]> = {};
      for (const response of responses) {
        next[response.projectId] = response.items;
      }
      setQueuesByProject(next);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      hasResolvedInitialFetchRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hasResolvedInitialFetchRef.current = false;
    void fetchQueues();
  }, [fetchQueues, projectIdsKey]);

  useEffect(() => {
    const handleQueueChanged = (event: ProjectQueueChangedEvent) => {
      if (!projectIdsRef.current.includes(event.projectId)) return;
      setQueuesByProject((current) => ({
        ...current,
        [event.projectId]: event.items,
      }));
    };
    const handleRefresh = () => {
      void fetchQueues();
    };

    const unsubscribeQueue = activityBus.on(
      "project-queue-changed",
      handleQueueChanged,
    );
    const unsubscribeReconnect = activityBus.on("reconnect", handleRefresh);
    const unsubscribeRefresh = activityBus.on("refresh", handleRefresh);

    return () => {
      unsubscribeQueue();
      unsubscribeReconnect();
      unsubscribeRefresh();
    };
  }, [fetchQueues]);

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
        setQueuesByProject((current) => ({
          ...current,
          [response.queue.projectId]: response.queue.items,
        }));
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
      setQueuesByProject((current) => ({
        ...current,
        [response.queue.projectId]: response.queue.items,
      }));
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
      setQueuesByProject((current) => ({
        ...current,
        [response.queue.projectId]: response.queue.items,
      }));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setMutatingItemId(null);
    }
  }, []);

  const items = useMemo(() => flattenQueues(queuesByProject), [queuesByProject]);

  return {
    queuesByProject,
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
