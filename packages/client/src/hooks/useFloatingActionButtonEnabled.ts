import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const DEFAULT_FLOATING_ACTION_BUTTON_ENABLED = false;

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

function loadFloatingActionButtonEnabled(): boolean {
  const stored = getStorage()?.getItem(UI_KEYS.floatingActionButtonEnabled);
  if (stored === null || stored === undefined) {
    return DEFAULT_FLOATING_ACTION_BUTTON_ENABLED;
  }
  return stored === "true";
}

function saveFloatingActionButtonEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(UI_KEYS.floatingActionButtonEnabled, String(enabled));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return loadFloatingActionButtonEnabled();
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Hook to manage the global quick new-session FAB preference.
 * Defaults to disabled so the app never shows the FAB unless opted in.
 */
export function useFloatingActionButtonEnabled() {
  const floatingActionButtonEnabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_FLOATING_ACTION_BUTTON_ENABLED,
  );

  const setFloatingActionButtonEnabled = useCallback((enabled: boolean) => {
    saveFloatingActionButtonEnabled(enabled);
    emitChange();
  }, []);

  return {
    floatingActionButtonEnabled,
    setFloatingActionButtonEnabled,
  };
}

export function getFloatingActionButtonEnabled(): boolean {
  return loadFloatingActionButtonEnabled();
}
