import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(
  UI_KEYS.floatingActionButtonEnabled,
  false,
);

/**
 * Hook to manage the global quick new-session FAB preference.
 * Defaults to disabled so the app never shows the FAB unless opted in.
 */
export function useFloatingActionButtonEnabled() {
  const floatingActionButtonEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    floatingActionButtonEnabled,
    setFloatingActionButtonEnabled: store.set,
  };
}

export const getFloatingActionButtonEnabled = store.read;
