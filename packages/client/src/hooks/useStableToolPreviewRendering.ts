import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(
  UI_KEYS.stableToolPreviewRendering,
  true,
);

export const setStableToolPreviewRenderingPreference = store.set;

export function useStableToolPreviewRendering() {
  const stableToolPreviewRendering = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    stableToolPreviewRendering,
    setStableToolPreviewRendering: store.set,
  };
}

export const getStableToolPreviewRendering = store.read;
