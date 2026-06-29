import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activityBus, type ActivityEventType } from "../lib/activityBus";
import {
  createClientQueryKey,
  ensureClientQuery,
  invalidateClientQuery,
  retainClientQuery,
  type ClientQueryCoverage,
  type ClientQueryRequestContext,
} from "../lib/clientQueryController";
import type { ClientSummarySourceKey } from "../lib/clientSummaryStore";

const DEFAULT_REVALIDATE_DEBOUNCE_MS = 500;

export interface UseRetainedClientQueryOptions<T> {
  sourceKey: ClientSummarySourceKey;
  key: unknown;
  coverage?: ClientQueryCoverage;
  enabled?: boolean;
  ready?: boolean;
  hasData?: boolean;
  staleTimeMs?: number;
  debounceMs?: number;
  revalidateOn?: readonly ActivityEventType[];
  fetcher: (context: ClientQueryRequestContext) => Promise<T>;
  applySnapshot?: (
    result: T,
    context: ClientQueryRequestContext,
  ) => void | Promise<void>;
}

export interface UseRetainedClientQueryResult {
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  scheduleRevalidation: () => void;
}

export function useRetainedClientQuery<T>({
  sourceKey,
  key,
  coverage,
  enabled = true,
  ready = true,
  hasData = false,
  staleTimeMs,
  debounceMs = DEFAULT_REVALIDATE_DEBOUNCE_MS,
  revalidateOn = [],
  fetcher,
  applySnapshot,
}: UseRetainedClientQueryOptions<T>): UseRetainedClientQueryResult {
  const queryKey = useMemo(() => createClientQueryKey(key), [key]);
  const coverageKey = useMemo(() => createClientQueryKey(coverage ?? {}), [
    coverage,
  ]);
  const revalidateEventsKey = useMemo(
    () => revalidateOn.join("\0"),
    [revalidateOn],
  );
  const revalidateEvents = useMemo(
    () => [...revalidateOn],
    [revalidateEventsKey],
  );

  const [loading, setLoading] = useState(enabled && !hasData);
  const [error, setError] = useState<Error | null>(null);
  const hasSuccessfulFetchRef = useRef(hasData);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const runSequenceRef = useRef(0);
  const coverageRef = useRef(coverage);
  const fetcherRef = useRef(fetcher);
  const applySnapshotRef = useRef(applySnapshot);

  coverageRef.current = coverage;
  fetcherRef.current = fetcher;
  applySnapshotRef.current = applySnapshot;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    hasSuccessfulFetchRef.current = hasData;
    setError(null);
    setLoading(enabled && !hasData);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [enabled, hasData, sourceKey, queryKey, coverageKey]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return retainClientQuery({ sourceKey, key: queryKey });
  }, [enabled, sourceKey, queryKey]);

  const run = useCallback(
    async ({
      force = false,
      background = false,
    }: { force?: boolean; background?: boolean } = {}) => {
      if (!enabled || !ready) {
        return;
      }

      const requestId = ++runSequenceRef.current;
      const hasDataAtStart = hasSuccessfulFetchRef.current;
      if (!background || !hasDataAtStart) {
        setLoading(true);
        setError(null);
      }

      try {
        if (force) {
          invalidateClientQuery(sourceKey, queryKey);
        }
        await ensureClientQuery({
          sourceKey,
          key: queryKey,
          coverage: coverageRef.current,
          staleTimeMs,
          force,
          fetcher: (context) => fetcherRef.current(context),
          applySnapshot: (result, context) =>
            applySnapshotRef.current?.(result, context),
        });

        if (!mountedRef.current || requestId !== runSequenceRef.current) {
          return;
        }
        hasSuccessfulFetchRef.current = true;
        setError(null);
      } catch (err) {
        if (!mountedRef.current || requestId !== runSequenceRef.current) {
          return;
        }
        if (!background || !hasSuccessfulFetchRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mountedRef.current && requestId === runSequenceRef.current) {
          setLoading(false);
        }
      }
    },
    [
      enabled,
      ready,
      sourceKey,
      queryKey,
      coverageKey,
      staleTimeMs,
    ],
  );

  const scheduleRevalidation = useCallback(() => {
    if (!enabled) {
      return;
    }
    invalidateClientQuery(sourceKey, queryKey);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void run({ force: true, background: true });
    }, debounceMs);
  }, [debounceMs, enabled, run, sourceKey, queryKey]);

  useEffect(() => {
    if (!enabled || revalidateEvents.length === 0) {
      return undefined;
    }
    const unsubscribers = revalidateEvents.map((eventType) =>
      activityBus.on(eventType, () => {
        scheduleRevalidation();
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [enabled, revalidateEvents, scheduleRevalidation]);

  useEffect(() => {
    if (enabled && ready) {
      void run();
    }
  }, [enabled, ready, run]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    loading,
    error,
    refetch: () => run({ force: true }),
    scheduleRevalidation,
  };
}
