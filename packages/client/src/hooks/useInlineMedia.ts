import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const DEFAULT_INLINE_MEDIA_EXPANDED_BY_DEFAULT = false;

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

function loadInlineMediaExpandedByDefault(): boolean {
  const stored = getStorage()?.getItem(UI_KEYS.inlineMediaExpandedByDefault);
  if (stored === null || stored === undefined) {
    return DEFAULT_INLINE_MEDIA_EXPANDED_BY_DEFAULT;
  }
  return stored === "true";
}

function saveInlineMediaExpandedByDefault(expanded: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(UI_KEYS.inlineMediaExpandedByDefault, String(expanded));
}

let currentInlineMediaExpandedByDefault = loadInlineMediaExpandedByDefault();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentInlineMediaExpandedByDefault;
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setInlineMediaExpandedPreference(expanded: boolean): void {
  currentInlineMediaExpandedByDefault = expanded;
  saveInlineMediaExpandedByDefault(expanded);
  emitChange();
}

export function useInlineMedia() {
  const inlineMediaExpandedByDefault = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_INLINE_MEDIA_EXPANDED_BY_DEFAULT,
  );

  const setInlineMediaExpandedByDefault = useCallback(
    setInlineMediaExpandedPreference,
    [],
  );

  return {
    inlineMediaExpandedByDefault,
    setInlineMediaExpandedByDefault,
  };
}

export function getInlineMediaExpandedByDefault(): boolean {
  return currentInlineMediaExpandedByDefault;
}
