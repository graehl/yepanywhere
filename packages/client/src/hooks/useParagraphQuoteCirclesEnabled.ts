import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageBoolean";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(
  UI_KEYS.paragraphQuoteCirclesEnabled,
  true,
);

export function useParagraphQuoteCirclesEnabled() {
  const paragraphQuoteCirclesEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    paragraphQuoteCirclesEnabled,
    setParagraphQuoteCirclesEnabled: store.set,
  };
}
