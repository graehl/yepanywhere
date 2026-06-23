import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const listeners = new Set<() => void>();

function loadAlwaysShowQuoteCircles(): boolean {
  try {
    return localStorage.getItem(UI_KEYS.alwaysShowQuoteCircles) === "true";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === UI_KEYS.alwaysShowQuoteCircles || event.key === null) {
      listener();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useAlwaysShowQuoteCircles() {
  const alwaysShowQuoteCircles = useSyncExternalStore(
    subscribe,
    loadAlwaysShowQuoteCircles,
    () => false,
  );

  const setAlwaysShowQuoteCircles = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(UI_KEYS.alwaysShowQuoteCircles, String(enabled));
    } catch {
      // Local display preference; in-memory subscribers still update.
    }
    emitChange();
  }, []);

  return { alwaysShowQuoteCircles, setAlwaysShowQuoteCircles };
}
