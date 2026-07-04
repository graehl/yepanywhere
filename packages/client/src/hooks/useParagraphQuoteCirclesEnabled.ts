import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const listeners = new Set<() => void>();

function loadParagraphQuoteCirclesEnabled(): boolean {
  try {
    return (
      localStorage.getItem(UI_KEYS.paragraphQuoteCirclesEnabled) !== "false"
    );
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === UI_KEYS.paragraphQuoteCirclesEnabled ||
      event.key === null
    ) {
      listener();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useParagraphQuoteCirclesEnabled() {
  const paragraphQuoteCirclesEnabled = useSyncExternalStore(
    subscribe,
    loadParagraphQuoteCirclesEnabled,
    () => true,
  );

  const setParagraphQuoteCirclesEnabled = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(
        UI_KEYS.paragraphQuoteCirclesEnabled,
        String(enabled),
      );
    } catch {
      // Local display preference; in-memory subscribers still update.
    }
    emitChange();
  }, []);

  return {
    paragraphQuoteCirclesEnabled,
    setParagraphQuoteCirclesEnabled,
  };
}
