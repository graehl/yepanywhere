import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const DEFAULT_SESSION_LOADING_PROGRESS = true;

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

function loadSessionLoadingProgress(): boolean {
  const stored = getStorage()?.getItem(UI_KEYS.sessionLoadingProgress);
  if (stored === null || stored === undefined) {
    return DEFAULT_SESSION_LOADING_PROGRESS;
  }
  return stored === "true";
}

function saveSessionLoadingProgress(enabled: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(UI_KEYS.sessionLoadingProgress, String(enabled));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === UI_KEYS.sessionLoadingProgress || event.key === null) {
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
  return loadSessionLoadingProgress();
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setSessionLoadingProgressPreference(enabled: boolean): void {
  saveSessionLoadingProgress(enabled);
  emitChange();
}

export function useSessionLoadingProgress() {
  const sessionLoadingProgressEnabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_SESSION_LOADING_PROGRESS,
  );

  const setSessionLoadingProgressEnabled = useCallback(
    setSessionLoadingProgressPreference,
    [],
  );

  return {
    sessionLoadingProgressEnabled,
    setSessionLoadingProgressEnabled,
  };
}

export function getSessionLoadingProgressEnabled(): boolean {
  return loadSessionLoadingProgress();
}
