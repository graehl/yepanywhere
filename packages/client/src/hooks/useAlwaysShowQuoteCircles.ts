import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageBoolean";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.alwaysShowQuoteCircles, false);

export function useAlwaysShowQuoteCircles() {
  const alwaysShowQuoteCircles = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { alwaysShowQuoteCircles, setAlwaysShowQuoteCircles: store.set };
}
