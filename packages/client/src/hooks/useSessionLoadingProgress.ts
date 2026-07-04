import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageBoolean";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.sessionLoadingProgress, true);

export const setSessionLoadingProgressPreference = store.set;

export function useSessionLoadingProgress() {
  const sessionLoadingProgressEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    sessionLoadingProgressEnabled,
    setSessionLoadingProgressEnabled: store.set,
  };
}

export const getSessionLoadingProgressEnabled = store.read;
