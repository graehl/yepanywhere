import { useSyncExternalStore } from "react";
import { unicodeProseMathSetting as store } from "../lib/unicodeProseMath";

export function useUnicodeProseMathSetting() {
  const unicodeProseMathEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { unicodeProseMathEnabled, setUnicodeProseMathEnabled: store.set };
}
