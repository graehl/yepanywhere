import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const DEFAULT_FLAT_SETTINGS_ICONS = false;

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

function loadFlatSettingsIcons(): boolean {
  const stored = getStorage()?.getItem(UI_KEYS.flatSettingsIcons);
  if (stored === null || stored === undefined) {
    return DEFAULT_FLAT_SETTINGS_ICONS;
  }
  return stored === "true";
}

function saveFlatSettingsIcons(enabled: boolean): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(UI_KEYS.flatSettingsIcons, String(enabled));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return loadFlatSettingsIcons();
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setFlatSettingsIconsPreference(enabled: boolean): void {
  saveFlatSettingsIcons(enabled);
  emitChange();
}

export function useFlatSettingsIcons() {
  const flatSettingsIcons = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_FLAT_SETTINGS_ICONS,
  );

  const setFlatSettingsIcons = useCallback(setFlatSettingsIconsPreference, []);

  return {
    flatSettingsIcons,
    setFlatSettingsIcons,
  };
}

export function getFlatSettingsIcons(): boolean {
  return loadFlatSettingsIcons();
}
