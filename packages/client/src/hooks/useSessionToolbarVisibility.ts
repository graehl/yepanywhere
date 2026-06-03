import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export interface SessionToolbarVisibility {
  modeSelector: boolean;
  attachments: boolean;
  slashMenu: boolean;
  thinkingToggle: boolean;
  renderMode: boolean;
  modelIndicator: boolean;
  microphone: boolean;
  shortcutsHelp: boolean;
  contextUsage: boolean;
  btw: boolean;
  nudge: boolean;
  queueControls: boolean;
  sessionStatus: boolean;
}

export type SessionToolbarVisibilityKey = keyof SessionToolbarVisibility;

export const DEFAULT_SESSION_TOOLBAR_VISIBILITY: SessionToolbarVisibility = {
  modeSelector: true,
  attachments: true,
  slashMenu: true,
  thinkingToggle: true,
  renderMode: false,
  modelIndicator: false,
  microphone: true,
  shortcutsHelp: true,
  contextUsage: true,
  btw: false,
  nudge: false,
  queueControls: true,
  sessionStatus: true,
};

const MOBILE_SESSION_TOOLBAR_VISIBILITY_DEFAULTS: Partial<SessionToolbarVisibility> =
  {
    modelIndicator: false,
    microphone: false,
    shortcutsHelp: false,
    sessionStatus: false,
  };

const SESSION_TOOLBAR_MOBILE_QUERY = "(max-width: 600px)";

function isMobileToolbarLayout(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SESSION_TOOLBAR_MOBILE_QUERY).matches
  );
}

function getDefaultSessionToolbarVisibility(): SessionToolbarVisibility {
  if (!isMobileToolbarLayout()) {
    return DEFAULT_SESSION_TOOLBAR_VISIBILITY;
  }
  return {
    ...DEFAULT_SESSION_TOOLBAR_VISIBILITY,
    ...MOBILE_SESSION_TOOLBAR_VISIBILITY_DEFAULTS,
  };
}

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
    return getDefaultSessionToolbarVisibility();
  }
  const input = value as Partial<Record<SessionToolbarVisibilityKey, unknown>>;
  const normalized = { ...getDefaultSessionToolbarVisibility() };
  for (const key of SESSION_TOOLBAR_VISIBILITY_KEYS) {
    if (typeof input[key] === "boolean") {
      normalized[key] = input[key];
    }
  }
  return normalized;
}

function loadVisibility(): SessionToolbarVisibility {
  if (!hasLocalStorage()) {
    return getDefaultSessionToolbarVisibility();
  }
  const stored = localStorage.getItem(UI_KEYS.sessionToolbarVisibility);
  if (!stored) {
    return getDefaultSessionToolbarVisibility();
  }
  try {
    return normalizeVisibility(JSON.parse(stored));
  } catch {
    return getDefaultSessionToolbarVisibility();
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
    updateVisibility(getDefaultSessionToolbarVisibility());
  }, []);

  return {
    visibility,
    setControlVisible,
    resetVisibility,
  };
}
