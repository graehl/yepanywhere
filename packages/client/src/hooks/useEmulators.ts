import type { EmulatorInfo } from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

interface UseEmulatorsResult {
  emulators: EmulatorInfo[];
  loading: boolean;
  error: string | null;
  startEmulator: (id: string) => Promise<void>;
  stopEmulator: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and manage emulator list.
 * Polls every `pollIntervalMs` (default 5s) while active.
 */
export function useEmulators(pollIntervalMs = 5000): UseEmulatorsResult {
  const [emulators, setEmulators] = useState<EmulatorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getEmulators();
      if (mountedRef.current) {
        setEmulators(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const startEmulator = useCallback(
    async (id: string) => {
      try {
        await api.startEmulator(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const stopEmulator = useCallback(
    async (id: string) => {
      try {
        await api.stopEmulator(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = setInterval(refresh, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh, pollIntervalMs]);

  return { emulators, loading, error, startEmulator, stopEmulator, refresh };
}
