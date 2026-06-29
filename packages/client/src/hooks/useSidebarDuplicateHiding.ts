import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const DEFAULT_SIDEBAR_DUPLICATE_HIDING_ENABLED = true;

const listeners = new Set<() => void>();

function getStorage(): Storage | null {
  if (
    typeof globalThis.localStorage === "undefined" ||
    typeof globalThis.localStorage.getItem !== "function"
  ) {
    return null;
  }
  return globalThis.localStorage;
}

function loadSidebarDuplicateHidingEnabled(): boolean {
  const stored = getStorage()?.getItem(UI_KEYS.sidebarDuplicateHidingEnabled);
  if (stored === null || stored === undefined) {
    return DEFAULT_SIDEBAR_DUPLICATE_HIDING_ENABLED;
  }
  return stored === "true";
}

function saveSidebarDuplicateHidingEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(UI_KEYS.sidebarDuplicateHidingEnabled, String(enabled));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === UI_KEYS.sidebarDuplicateHidingEnabled ||
      event.key === null
    ) {
      listener();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function getSnapshot() {
  return loadSidebarDuplicateHidingEnabled();
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useSidebarDuplicateHiding() {
  const sidebarDuplicateHidingEnabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_SIDEBAR_DUPLICATE_HIDING_ENABLED,
  );

  const setSidebarDuplicateHidingEnabled = useCallback((enabled: boolean) => {
    saveSidebarDuplicateHidingEnabled(enabled);
    emitChange();
  }, []);

  return {
    sidebarDuplicateHidingEnabled,
    setSidebarDuplicateHidingEnabled,
  };
}

export function getSidebarDuplicateHidingEnabled(): boolean {
  return loadSidebarDuplicateHidingEnabled();
}
