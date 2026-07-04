import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

export interface TabTitleActivityPreference {
  enabled: boolean;
}

export const DEFAULT_TAB_TITLE_ACTIVITY_PREFERENCE: TabTitleActivityPreference =
  {
    enabled: false,
  };

const store = createLocalStorageBoolean(
  UI_KEYS.tabTitleActivityEnabled,
  DEFAULT_TAB_TITLE_ACTIVITY_PREFERENCE.enabled,
);

export function getTabTitleActivityPreference(): TabTitleActivityPreference {
  return { enabled: store.read() };
}

export function useTabTitleActivityPreference() {
  const tabTitleActivityEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { tabTitleActivityEnabled, setTabTitleActivityEnabled: store.set };
}
