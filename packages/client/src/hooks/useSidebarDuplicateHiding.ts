import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(
  UI_KEYS.sidebarDuplicateHidingEnabled,
  true,
);

export function useSidebarDuplicateHiding() {
  const sidebarDuplicateHidingEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    sidebarDuplicateHidingEnabled,
    setSidebarDuplicateHidingEnabled: store.set,
  };
}

export const getSidebarDuplicateHidingEnabled = store.read;
