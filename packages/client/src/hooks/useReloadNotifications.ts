import { useCallback, useEffect, useState } from "react";
import type { SafeRestartState } from "@yep-anywhere/shared";
import { fetchJSON } from "../api/client";
import {
  type SourceChangeEvent,
  type WorkerActivityEvent,
  activityBus,
  getInterruptibleSessionCount,
} from "../lib/activityBus";

// Re-export for consumers
export type {
  SourceChangeEvent,
  WorkerActivityEvent,
} from "../lib/activityBus";

export interface PendingReloads {
  backend: boolean;
  frontend: boolean;
}

interface DevStatus {
  noBackendReload: boolean;
  noFrontendReload: boolean;
  backendDirty?: boolean;
}

export const FRONTEND_RELOAD_QUERY_PARAM = "__ya_reload";

const IDLE_SAFE_RESTART_STATE: SafeRestartState = {
  status: "idle",
  blockers: [],
  canRestartNow: true,
  updatedAt: "",
};

export function getVisibleReloadBanners(
  isManualReloadMode: boolean,
  pendingReloads: PendingReloads,
): PendingReloads {
  if (!isManualReloadMode) {
    return { backend: false, frontend: false };
  }
  if (pendingReloads.backend) {
    return { backend: true, frontend: false };
  }
  return { backend: false, frontend: pendingReloads.frontend };
}

function toReloadUrl(currentUrl: string | URL): URL {
  return new URL(
    typeof currentUrl === "string" ? currentUrl : currentUrl.toString(),
  );
}

export function buildFrontendReloadUrl(
  currentUrl: string | URL,
  reloadToken: string,
): string {
  const url = toReloadUrl(currentUrl);
  url.searchParams.set(FRONTEND_RELOAD_QUERY_PARAM, reloadToken);
  return url.toString();
}

export function getFrontendReloadCleanupUrl(
  currentUrl: string | URL,
): string | null {
  const url = toReloadUrl(currentUrl);
  if (!url.searchParams.has(FRONTEND_RELOAD_QUERY_PARAM)) {
    return null;
  }
  url.searchParams.delete(FRONTEND_RELOAD_QUERY_PARAM);
  return url.toString();
}

/**
 * Hook to manage reload notifications when running in manual reload mode.
 * Listens for source-change events via the global activityBus.
 */
export function useReloadNotifications() {
  const [pendingReloads, setPendingReloads] = useState<PendingReloads>({
    backend: false,
    frontend: false,
  });
  const [dismissedReloads, setDismissedReloads] = useState<PendingReloads>({
    backend: false,
    frontend: false,
  });
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [connected, setConnected] = useState(activityBus.connected);
  const [safeRestartState, setSafeRestartState] =
    useState<SafeRestartState>(IDLE_SAFE_RESTART_STATE);
  const [safeRestartMutating, setSafeRestartMutating] = useState(false);
  const [workerActivity, setWorkerActivity] = useState<WorkerActivityEvent>({
    type: "worker-activity-changed",
    activeWorkers: 0,
    interruptibleSessionCount: 0,
    queueLength: 0,
    queuedSessionMessageCount: 0,
    hasActiveWork: false,
    timestamp: "",
  });

  const showReloadIfNotDismissed = useCallback(
    (target: "backend" | "frontend") => {
      setPendingReloads((prev) => {
        if (dismissedReloads[target]) return prev;
        return { ...prev, [target]: true };
      });
    },
    [dismissedReloads],
  );

  // Sync dev status and worker activity from server
  const syncFromServer = useCallback(() => {
    if (window.location.pathname === "/login") {
      return;
    }

    // Sync dev status
    fetchJSON<DevStatus>("/dev/status")
      .then((data) => {
        if (data && !data.backendDirty) {
          setPendingReloads((prev) => ({ ...prev, backend: false }));
        } else if (data?.backendDirty) {
          showReloadIfNotDismissed("backend");
        }
      })
      .catch(() => {
        // Ignore errors
      });

    // Sync worker activity
    fetchJSON<WorkerActivityEvent>("/status/workers")
      .then((data) => {
        if (data) setWorkerActivity(data);
      })
      .catch(() => {
        // Ignore errors
      });

    fetchJSON<SafeRestartState>("/dev/safe-restart")
      .then((data) => {
        if (!data) return;
        setSafeRestartState(data);
        if (data.status !== "idle") {
          showReloadIfNotDismissed("backend");
        }
      })
      .catch(() => {
        // Ignore errors
      });
  }, [showReloadIfNotDismissed]);

  // Check if server is in dev mode and get persisted dirty state
  useEffect(() => {
    if (window.location.pathname === "/login") {
      return;
    }

    fetchJSON<DevStatus>("/dev/status")
      .then((data) => {
        setDevStatus(data);
        if (data.backendDirty) {
          showReloadIfNotDismissed("backend");
        }
      })
      .catch(() => {
        setDevStatus(null);
      });
  }, [showReloadIfNotDismissed]);

  // Clean the cache-busting reload param back out after the fresh document loads
  // so copied/shared URLs do not retain reload-only query state.
  useEffect(() => {
    const cleanupUrl = getFrontendReloadCleanupUrl(window.location.href);
    if (!cleanupUrl) {
      return;
    }
    window.history.replaceState(window.history.state, "", cleanupUrl);
  }, []);

  // Subscribe to events from the bus
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      activityBus.on("source-change", (data: SourceChangeEvent) => {
        showReloadIfNotDismissed(data.target);
      }),
    );

    unsubscribers.push(
      activityBus.on("backend-reloaded", () => {
        setPendingReloads((prev) => ({ ...prev, backend: false }));
        setSafeRestartState(IDLE_SAFE_RESTART_STATE);
      }),
    );

    unsubscribers.push(
      activityBus.on("worker-activity-changed", (data: WorkerActivityEvent) => {
        setWorkerActivity(data);
      }),
    );

    unsubscribers.push(
      activityBus.on("safe-restart-changed", (data) => {
        setSafeRestartState(data.state);
        if (data.state.status !== "idle") {
          showReloadIfNotDismissed("backend");
        }
      }),
    );

    // On reconnect, sync state from server
    unsubscribers.push(
      activityBus.on("reconnect", () => {
        setConnected(true);
        syncFromServer();
      }),
    );

    // On visibility restore, refresh data
    unsubscribers.push(
      activityBus.on("refresh", () => {
        syncFromServer();
      }),
    );

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [showReloadIfNotDismissed, syncFromServer]);

  // Sync connected state with bus
  useEffect(() => {
    const checkConnection = () => {
      setConnected(activityBus.connected);
    };
    const interval = setInterval(checkConnection, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initial sync when dev mode is detected
  useEffect(() => {
    if (devStatus?.noBackendReload || devStatus?.noFrontendReload) {
      syncFromServer();
    }
  }, [devStatus, syncFromServer]);

  // Reload the backend (triggers server restart)
  const reloadBackend = useCallback(async () => {
    console.log("[ReloadNotifications] Requesting backend reload...");
    try {
      await fetchJSON<{ ok: boolean }>("/server/restart", { method: "POST" });
      console.log("[ReloadNotifications] Reload completed");
      setPendingReloads((prev) => ({ ...prev, backend: false }));
    } catch (err) {
      console.log("[ReloadNotifications] Reload error (may be expected):", err);
    }
  }, []);

  const scheduleSafeRestart = useCallback(async () => {
    setSafeRestartMutating(true);
    try {
      const state = await fetchJSON<SafeRestartState>("/dev/safe-restart", {
        method: "POST",
      });
      setSafeRestartState(state);
      setPendingReloads((prev) => ({ ...prev, backend: true }));
    } finally {
      setSafeRestartMutating(false);
    }
  }, []);

  const cancelSafeRestart = useCallback(async () => {
    setSafeRestartMutating(true);
    try {
      const state = await fetchJSON<SafeRestartState>("/dev/safe-restart", {
        method: "DELETE",
      });
      setSafeRestartState(state);
    } finally {
      setSafeRestartMutating(false);
    }
  }, []);

  // Reload the frontend (browser refresh)
  const reloadFrontend = useCallback(() => {
    const reloadUrl = buildFrontendReloadUrl(
      window.location.href,
      String(Date.now()),
    );
    window.location.replace(reloadUrl);
  }, []);

  // Reload whichever needs it (backend first if both)
  const reload = useCallback(() => {
    if (pendingReloads.backend) {
      reloadBackend();
    } else if (pendingReloads.frontend) {
      reloadFrontend();
    }
  }, [pendingReloads, reloadBackend, reloadFrontend]);

  // Dismiss a pending reload notification
  const dismiss = useCallback((target: "backend" | "frontend") => {
    setDismissedReloads((prev) => ({
      ...prev,
      [target]: true,
    }));
    setPendingReloads((prev) => ({
      ...prev,
      [target]: false,
    }));
  }, []);

  // Dismiss all
  const dismissAll = useCallback(() => {
    setDismissedReloads({ backend: true, frontend: true });
    setPendingReloads({ backend: false, frontend: false });
  }, []);

  // Keyboard shortcut: Ctrl+Shift+R
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "R") {
        e.preventDefault();
        reload();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reload]);

  // Check if manual reload mode is active at all
  const isManualReloadMode =
    devStatus?.noBackendReload || devStatus?.noFrontendReload;
  const interruptibleSessionCount =
    getInterruptibleSessionCount(workerActivity);
  const queuedSessionMessageCount = Math.max(
    0,
    workerActivity.queuedSessionMessageCount ?? workerActivity.queueLength,
  );

  return {
    isManualReloadMode,
    pendingReloads,
    connected,
    reloadBackend,
    reloadFrontend,
    reload,
    scheduleSafeRestart,
    cancelSafeRestart,
    dismiss,
    dismissAll,
    workerActivity,
    interruptibleSessionCount,
    queuedSessionMessageCount,
    safeRestartState,
    safeRestartMutating,
    unsafeToRestart:
      interruptibleSessionCount > 0 || queuedSessionMessageCount > 0,
  };
}
