import { useCallback, useMemo, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";
import { clearSessionRouteSnapshots } from "../lib/sessionRouteSnapshots";

const DEFAULT_SESSION_DOM_LINGER_ENABLED = false;
const DEFAULT_SESSION_TRANSCRIPT_CACHE_ENABLED = false;

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

function loadBooleanPreference(key: string, defaultValue: boolean): boolean {
  const stored = getStorage()?.getItem(key);
  if (stored === null || stored === undefined) {
    return defaultValue;
  }
  return stored === "true";
}

function saveBooleanPreference(key: string, enabled: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(key, String(enabled));
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === UI_KEYS.sessionDomLinger ||
      event.key === UI_KEYS.sessionTranscriptCache ||
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
  return [
    getSessionDomLingerEnabled() ? "1" : "0",
    getSessionTranscriptCacheEnabled() ? "1" : "0",
  ].join(":");
}

function parseSnapshot(snapshot: string) {
  const [domLinger, transcriptCache] = snapshot.split(":");
  return {
    sessionDomLingerEnabled: domLinger !== "0",
    sessionTranscriptCacheEnabled: transcriptCache !== "0",
  };
}

export function getSessionDomLingerEnabled(): boolean {
  return loadBooleanPreference(
    UI_KEYS.sessionDomLinger,
    DEFAULT_SESSION_DOM_LINGER_ENABLED,
  );
}

export function getSessionTranscriptCacheEnabled(): boolean {
  return loadBooleanPreference(
    UI_KEYS.sessionTranscriptCache,
    DEFAULT_SESSION_TRANSCRIPT_CACHE_ENABLED,
  );
}

export function setSessionDomLingerPreference(enabled: boolean): void {
  saveBooleanPreference(UI_KEYS.sessionDomLinger, enabled);
  emitChange();
}

export function setSessionTranscriptCachePreference(enabled: boolean): void {
  saveBooleanPreference(UI_KEYS.sessionTranscriptCache, enabled);
  if (!enabled) {
    clearSessionRouteSnapshots();
  }
  emitChange();
}

export function useSessionPerformanceSettings() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "0:0",
  );
  const settings = useMemo(() => parseSnapshot(snapshot), [snapshot]);

  const setSessionDomLingerEnabled = useCallback(
    setSessionDomLingerPreference,
    [],
  );
  const setSessionTranscriptCacheEnabled = useCallback(
    setSessionTranscriptCachePreference,
    [],
  );

  return {
    ...settings,
    setSessionDomLingerEnabled,
    setSessionTranscriptCacheEnabled,
  };
}
