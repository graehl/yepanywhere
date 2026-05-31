import { useCallback, useEffect, useRef, useState } from "react";
import { type PublicShareStatusResponse, api } from "../api/client";

interface UsePublicShareStatusOptions {
  poll?: boolean;
}

interface UsePublicShareStatusResult {
  status: PublicShareStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PUBLIC_SHARE_GLOBAL_STATUS_POLL_MS = 5000;

export function usePublicShareStatus(
  options: UsePublicShareStatusOptions = {},
): UsePublicShareStatusResult {
  const { poll = false } = options;
  const [status, setStatus] = useState<PublicShareStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const nextStatus = await api.getPublicShareStatus();
      if (!mountedRef.current) return;
      setStatus(nextStatus);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus(null);
      setError(
        err instanceof Error ? err.message : "Failed to load share status",
      );
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      await refresh();
      if (!cancelled && poll) {
        timer = setTimeout(run, PUBLIC_SHARE_GLOBAL_STATUS_POLL_MS);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [poll, refresh]);

  return { status, loading, error, refresh };
}
