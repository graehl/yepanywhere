import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageBoolean";
import { UI_KEYS } from "../lib/storageKeys";

// Opt-in: title generation uses the agent (and tokens), so default to off.
const store = createLocalStorageBoolean(
  UI_KEYS.sessionGeneratedTitleEnabled,
  false,
);

export function useGeneratedTitleEnabled() {
  const generatedTitleEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { generatedTitleEnabled, setGeneratedTitleEnabled: store.set };
}
