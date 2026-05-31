import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export type TabTitleActivityScope = "focused" | "all";

export interface TabTitleActivityPreference {
  enabled: boolean;
  scope: TabTitleActivityScope;
}

export const DEFAULT_TAB_TITLE_ACTIVITY_PREFERENCE: TabTitleActivityPreference =
  {
    enabled: false,
    scope: "focused",
  };

const VALID_SCOPES = new Set<TabTitleActivityScope>(["focused", "all"]);
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

function normalizeScope(value: unknown): TabTitleActivityScope {
  return typeof value === "string" &&
    VALID_SCOPES.has(value as TabTitleActivityScope)
    ? (value as TabTitleActivityScope)
    : DEFAULT_TAB_TITLE_ACTIVITY_PREFERENCE.scope;
}

function loadTabTitleActivityPreference(): TabTitleActivityPreference {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_TAB_TITLE_ACTIVITY_PREFERENCE;
  }

  const enabled = storage.getItem(UI_KEYS.tabTitleActivityEnabled) === "true";
  const scope = normalizeScope(storage.getItem(UI_KEYS.tabTitleActivityScope));

  return { enabled, scope };
}

function saveTabTitleActivityPreference(
  preference: TabTitleActivityPreference,
): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") {
    return;
  }
  storage.setItem(UI_KEYS.tabTitleActivityEnabled, String(preference.enabled));
  storage.setItem(UI_KEYS.tabTitleActivityScope, preference.scope);
}

function encodePreference(preference: TabTitleActivityPreference): string {
  return `${preference.enabled ? "1" : "0"}:${preference.scope}`;
}

function decodePreferenceSnapshot(
  snapshot: string,
): TabTitleActivityPreference {
  const [enabledValue, scopeValue] = snapshot.split(":");
  return {
    enabled: enabledValue === "1",
    scope: normalizeScope(scopeValue),
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return encodePreference(loadTabTitleActivityPreference());
}

function getServerSnapshot() {
  return encodePreference(DEFAULT_TAB_TITLE_ACTIVITY_PREFERENCE);
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function updatePreference(preference: TabTitleActivityPreference): void {
  saveTabTitleActivityPreference(preference);
  emitChange();
}

export function getTabTitleActivityPreference(): TabTitleActivityPreference {
  return loadTabTitleActivityPreference();
}

export function useTabTitleActivityPreference() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const preference = decodePreferenceSnapshot(snapshot);

  const setTabTitleActivityEnabled = useCallback((enabled: boolean) => {
    updatePreference({
      ...loadTabTitleActivityPreference(),
      enabled,
    });
  }, []);

  const setTabTitleActivityScope = useCallback(
    (scope: TabTitleActivityScope) => {
      updatePreference({
        ...loadTabTitleActivityPreference(),
        scope: normalizeScope(scope),
      });
    },
    [],
  );

  return {
    tabTitleActivityEnabled: preference.enabled,
    tabTitleActivityScope: preference.scope,
    setTabTitleActivityEnabled,
    setTabTitleActivityScope,
  };
}
