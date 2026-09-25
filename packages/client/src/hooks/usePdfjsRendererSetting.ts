import { useSyncExternalStore } from "react";
import { pdfjsRendererSetting as store } from "../lib/pdfjsRenderer";

export function usePdfjsRendererSetting() {
  const pdfjsRendererEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { pdfjsRendererEnabled, setPdfjsRendererEnabled: store.set };
}
