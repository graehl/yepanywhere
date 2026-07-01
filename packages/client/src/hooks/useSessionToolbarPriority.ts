import type {
  ClientDefaults,
  ToolbarNarrowingPriority,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../api/client";
import {
  type DefaultedEnumRecord,
  normalizeDefaultedEnumRecord,
  resolveDefaultedEnumRecord,
  setDefaultedEnumRecordValue,
} from "../lib/defaultedStorage";
import { UI_KEYS } from "../lib/storageKeys";
import type { SessionToolbarVisibilityKey } from "./useSessionToolbarVisibility";
import { useVersion } from "./useVersion";

export type { ToolbarNarrowingPriority };

/** Priority levels, ordered highest-survival first (last to collapse → first). */
export const TOOLBAR_NARROWING_PRIORITIES: readonly ToolbarNarrowingPriority[] =
  ["pin", "last", "mid", "first"];

export type SessionToolbarPriority = Record<
  SessionToolbarVisibilityKey,
  ToolbarNarrowingPriority
>;

// Defaults reproduce today's hardcoded overflow tiers exactly: `first` == the
// old `early` (collapses first), `mid` == `medium`, `last` == `late` (collapses
// last). Controls that never collapsed (the right-side / always-on group) are
// `pin`. Keeping these as defaults means the data-driven tiers change nothing
// until a user reconfigures. Right-side priority is configurable but not yet
// functionally effective — see topics/toolbar-settings-ui.md.
export const DEFAULT_SESSION_TOOLBAR_PRIORITY: SessionToolbarPriority = {
  modeSelector: "first",
  attachments: "first",
  slashMenu: "mid",
  thinkingToggle: "mid",
  renderMode: "last",
  nudge: "last",
  shortcutsHelp: "last",
  microphone: "pin",
  waveform: "pin",
  steerNow: "pin",
  contextUsage: "pin",
  btw: "pin",
  sessionStatus: "pin",
  projectQueue: "pin",
};

type StoredSessionToolbarPriority = DefaultedEnumRecord<
  SessionToolbarVisibilityKey,
  ToolbarNarrowingPriority
>;
type SessionToolbarPriorityDefaults = Partial<SessionToolbarPriority>;

const SESSION_TOOLBAR_PRIORITY_KEYS = Object.keys(
  DEFAULT_SESSION_TOOLBAR_PRIORITY,
) as SessionToolbarVisibilityKey[];

function isToolbarNarrowingPriority(
  value: unknown,
): value is ToolbarNarrowingPriority {
  return (
    value === "pin" || value === "last" || value === "mid" || value === "first"
  );
}

function normalizeClientDefaultPriority(
  value: ClientDefaults["sessionToolbarPriority"] | undefined,
): SessionToolbarPriorityDefaults {
  if (!value || typeof value !== "object") {
    return {};
  }
  const normalized: SessionToolbarPriorityDefaults = {};
  for (const key of SESSION_TOOLBAR_PRIORITY_KEYS) {
    const candidate = value[key];
    if (isToolbarNarrowingPriority(candidate)) {
      normalized[key] = candidate;
    }
  }
  return normalized;
}

function getDefaultSessionToolbarPriority(): SessionToolbarPriority {
  return {
    ...DEFAULT_SESSION_TOOLBAR_PRIORITY,
    ...currentClientDefaultPriority,
  };
}

function hasLocalStorage(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function"
  );
}

function resolvePriority(
  stored: StoredSessionToolbarPriority,
): SessionToolbarPriority {
  return resolveDefaultedEnumRecord(
    stored,
    getDefaultSessionToolbarPriority(),
    SESSION_TOOLBAR_PRIORITY_KEYS,
  );
}

function normalizeStoredPriority(value: unknown): StoredSessionToolbarPriority {
  return normalizeDefaultedEnumRecord(
    value,
    SESSION_TOOLBAR_PRIORITY_KEYS,
    isToolbarNarrowingPriority,
  );
}

function loadStoredPriority(): StoredSessionToolbarPriority {
  if (!hasLocalStorage()) {
    return {};
  }
  const stored = localStorage.getItem(UI_KEYS.sessionToolbarPriority);
  if (!stored) {
    return {};
  }
  try {
    return normalizeStoredPriority(JSON.parse(stored));
  } catch {
    return {};
  }
}

function saveStoredPriority(priority: StoredSessionToolbarPriority): void {
  if (!hasLocalStorage()) {
    return;
  }
  if (Object.keys(priority).length === 0) {
    localStorage.removeItem(UI_KEYS.sessionToolbarPriority);
    return;
  }
  localStorage.setItem(
    UI_KEYS.sessionToolbarPriority,
    JSON.stringify(priority),
  );
}

let currentStoredPriority = loadStoredPriority();
let currentClientDefaultPriority: SessionToolbarPriorityDefaults = {};
let currentPriority = resolvePriority(currentStoredPriority);
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentPriority;
}

function updateStoredPriority(next: StoredSessionToolbarPriority): void {
  currentStoredPriority = normalizeStoredPriority(next);
  currentPriority = resolvePriority(currentStoredPriority);
  saveStoredPriority(currentStoredPriority);
  for (const listener of listeners) {
    listener();
  }
}

function updateClientDefaultPriority(
  next: ClientDefaults["sessionToolbarPriority"] | undefined,
): void {
  currentClientDefaultPriority = normalizeClientDefaultPriority(next);
  currentPriority = resolvePriority(currentStoredPriority);
  for (const listener of listeners) {
    listener();
  }
}

function saveClientDefaultPriority(
  key: SessionToolbarVisibilityKey,
  priority: ToolbarNarrowingPriority,
): void {
  void api
    .updateServerSettings({
      clientDefaults: {
        sessionToolbarPriority: { [key]: priority },
      },
    })
    .catch((err) => {
      console.warn(
        "[useSessionToolbarPriority] Failed to save server client default:",
        err instanceof Error ? err.message : String(err),
      );
    });
}

export function useSessionToolbarPriority() {
  const { version } = useVersion();
  const priority = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!version) return;
    updateClientDefaultPriority(
      version?.clientDefaults?.sessionToolbarPriority,
    );
  }, [version]);

  const setControlPriority = useCallback(
    (key: SessionToolbarVisibilityKey, value: ToolbarNarrowingPriority) => {
      updateStoredPriority(
        setDefaultedEnumRecordValue(currentStoredPriority, key, value),
      );
      saveClientDefaultPriority(key, value);
    },
    [],
  );

  const resetPriority = useCallback(() => {
    updateStoredPriority({});
  }, []);

  return useMemo(
    () => ({ priority, setControlPriority, resetPriority }),
    [priority, setControlPriority, resetPriority],
  );
}
