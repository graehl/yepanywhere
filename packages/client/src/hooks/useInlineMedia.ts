import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(
  UI_KEYS.inlineMediaExpandedByDefault,
  false,
);

export const setInlineMediaExpandedPreference = store.set;

export function useInlineMedia() {
  const inlineMediaExpandedByDefault = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    inlineMediaExpandedByDefault,
    setInlineMediaExpandedByDefault: store.set,
  };
}
