import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export interface SessionToolbarVisibility {
  slashMenu: boolean;
  modelIndicator: boolean;
  microphone: boolean;
  contextUsage: boolean;
  btw: boolean;
  nudge: boolean;
  queueControls: boolean;
  sessionStatus: boolean;
}

export type SessionToolbarVisibilityKey = keyof SessionToolbarVisibility;

export const DEFAULT_SESSION_TOOLBAR_VISIBILITY: SessionToolbarVisibility = {
  slashMenu: true,
  modelIndicator: true,
  microphone: true,
  contextUsage: true,
  btw: true,
  nudge: true,
  queueControls: true,
  sessionStatus: true,
};

const SESSION_TOOLBAR_VISIBILITY_KEYS = Object.keys(
  DEFAULT_SESSION_TOOLBAR_VISIBILITY,
) as SessionToolbarVisibilityKey[];

function hasLocalStorage(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function"
  );
}

function normalizeVisibility(value: unknown): SessionToolbarVisibility {
  if (!value || typeof value !== "object") {
    return DEFAULT_SESSION_TOOLBAR_VISIBILITY;
  }
  const input = value as Partial<Record<SessionToolbarVisibilityKey, unknown>>;
  const normalized = { ...DEFAULT_SESSION_TOOLBAR_VISIBILITY };
  for (const key of SESSION_TOOLBAR_VISIBILITY_KEYS) {
    if (typeof input[key] === "boolean") {
      normalized[key] = input[key];
    }
  }
  return normalized;
}

function loadVisibility(): SessionToolbarVisibility {
  if (!hasLocalStorage()) {
    return DEFAULT_SESSION_TOOLBAR_VISIBILITY;
  }
  const stored = localStorage.getItem(UI_KEYS.sessionToolbarVisibility);
  if (!stored) {
    return DEFAULT_SESSION_TOOLBAR_VISIBILITY;
  }
  try {
    return normalizeVisibility(JSON.parse(stored));
  } catch {
    return DEFAULT_SESSION_TOOLBAR_VISIBILITY;
  }
}

function saveVisibility(visibility: SessionToolbarVisibility): void {
  if (!hasLocalStorage()) {
    return;
  }
  localStorage.setItem(
    UI_KEYS.sessionToolbarVisibility,
    JSON.stringify(visibility),
  );
}

let currentVisibility = loadVisibility();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentVisibility;
}

function updateVisibility(next: SessionToolbarVisibility): void {
  currentVisibility = normalizeVisibility(next);
  saveVisibility(currentVisibility);
  for (const listener of listeners) {
    listener();
  }
}

export function useSessionToolbarVisibility() {
  const visibility = useSyncExternalStore(subscribe, getSnapshot);

  const setControlVisible = useCallback(
    (key: SessionToolbarVisibilityKey, visible: boolean) => {
      updateVisibility({ ...currentVisibility, [key]: visible });
    },
    [],
  );

  const resetVisibility = useCallback(() => {
    updateVisibility(DEFAULT_SESSION_TOOLBAR_VISIBILITY);
  }, []);

  return {
    visibility,
    setControlVisible,
    resetVisibility,
  };
}
