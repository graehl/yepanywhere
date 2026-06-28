import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import {
  reportProjectCollectionSnapshot,
  reportProjectsCollectionSnapshot,
  useProjectCollectionRecord,
  useProjectCollectionRecords,
} from "../lib/sessionCollectionExternalStore";
import { useFileActivity } from "./useFileActivity";

const REFETCH_DEBOUNCE_MS = 500;

/**
 * Fetch a single project by ID.
 */
export function useProject(projectId: string | undefined) {
  const project = useProjectCollectionRecord(projectId) ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const loadedProjectIdRef = useRef<string | undefined>(undefined);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshProject = useCallback(
    (changedProjectId?: string) => {
      if (!projectId || (changedProjectId && changedProjectId !== projectId)) {
        return;
      }
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }
      const targetProjectId = projectId;
      refetchTimerRef.current = setTimeout(() => {
        const requestStartedAt = Date.now();
        api
          .getProject(targetProjectId)
          .then((data) => {
            if (loadedProjectIdRef.current === targetProjectId) {
              reportProjectCollectionSnapshot(
                { project: data.project },
                requestStartedAt,
              );
              setError(null);
            }
          })
          .catch((err) => {
            if (loadedProjectIdRef.current === targetProjectId) {
              setError(err instanceof Error ? err : new Error(String(err)));
            }
          });
      }, REFETCH_DEBOUNCE_MS);
    },
    [projectId],
  );

  useFileActivity({
    onProcessStateChange: (event) => refreshProject(event.projectId),
    onSessionStatusChange: (event) => refreshProject(event.projectId),
    onSessionCreated: (event) => refreshProject(event.session.projectId),
    onReconnect: () => refreshProject(),
  });

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      loadedProjectIdRef.current = undefined;
      return;
    }

    // Reset when switching projects
    if (loadedProjectIdRef.current !== projectId) {
      setLoading(true);
      setError(null);
      loadedProjectIdRef.current = projectId;
    }

    let cancelled = false;
    const requestStartedAt = Date.now();

    api
      .getProject(projectId)
      .then((data) => {
        if (!cancelled) {
          reportProjectCollectionSnapshot(
            { project: data.project },
            requestStartedAt,
          );
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }
    };
  }, []);

  return useMemo(
    () => ({ project, loading, error }),
    [project, loading, error],
  );
}

export function useProjects() {
  const projects = useProjectCollectionRecords();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFetchedRef = useRef(false);
  const hasResolvedInitialFetchRef = useRef(false);

  const fetch = useCallback(async () => {
    // Preserve existing UI during background refetches triggered by activity
    // events so pages don't bounce back to their initial loading state.
    setLoading(!hasResolvedInitialFetchRef.current);
    setError(null);
    const requestStartedAt = Date.now();
    try {
      const data = await api.getProjects();
      reportProjectsCollectionSnapshot(
        { projects: data.projects },
        requestStartedAt,
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      hasResolvedInitialFetchRef.current = true;
      setLoading(false);
    }
  }, []);

  // Initial fetch - only once (avoid StrictMode double-fetch)
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetch();
  }, [fetch]);

  // Debounced refetch for status change events
  const debouncedRefetch = useCallback(() => {
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current);
    }
    refetchTimerRef.current = setTimeout(() => {
      fetch();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetch]);

  // Subscribe to activity that can change live project counts.
  useFileActivity({
    onProcessStateChange: debouncedRefetch,
    onSessionStatusChange: debouncedRefetch,
    onSessionCreated: debouncedRefetch,
    onReconnect: fetch,
  });

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }
    };
  }, []);

  return { projects, loading, error, refetch: fetch };
}
