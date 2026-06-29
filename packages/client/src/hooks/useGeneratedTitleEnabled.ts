import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

// Opt-in: title generation uses the agent (and tokens), so default to off.
const DEFAULT_GENERATED_TITLE_ENABLED = false;

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

function loadGeneratedTitleEnabled(): boolean {
  const stored = getStorage()?.getItem(UI_KEYS.sessionGeneratedTitleEnabled);
  if (stored === null || stored === undefined) {
    return DEFAULT_GENERATED_TITLE_ENABLED;
  }
  return stored === "true";
}

function saveGeneratedTitleEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(UI_KEYS.sessionGeneratedTitleEnabled, String(enabled));
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
      event.key === UI_KEYS.sessionGeneratedTitleEnabled ||
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
  return loadGeneratedTitleEnabled();
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useGeneratedTitleEnabled() {
  const generatedTitleEnabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_GENERATED_TITLE_ENABLED,
  );

  const setGeneratedTitleEnabled = useCallback((enabled: boolean) => {
    saveGeneratedTitleEnabled(enabled);
    emitChange();
  }, []);

  return {
    generatedTitleEnabled,
    setGeneratedTitleEnabled,
  };
}
