import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export const QUOTE_REPLY_BUTTON_MODES = [
  "block",
  "paragraph-hover",
  "paragraph-always",
] as const;
export type QuoteReplyButtonMode = (typeof QUOTE_REPLY_BUTTON_MODES)[number];

const DEFAULT_QUOTE_REPLY_BUTTON_MODE: QuoteReplyButtonMode =
  "paragraph-hover";

const listeners = new Set<() => void>();

function getStorage(): Storage | null {
  if (
    typeof globalThis.localStorage === "undefined" ||
    typeof globalThis.localStorage.getItem !== "function"
  ) {
    return null;
  }
  return globalThis.localStorage;
}

function isQuoteReplyButtonMode(
  value: string | null,
): value is QuoteReplyButtonMode {
  return (
    value === "block" ||
    value === "paragraph-hover" ||
    value === "paragraph-always"
  );
}

function loadQuoteReplyButtonMode(): QuoteReplyButtonMode {
  try {
    const stored = getStorage()?.getItem(UI_KEYS.quoteReplyButtonMode) ?? null;
    return isQuoteReplyButtonMode(stored)
      ? stored
      : DEFAULT_QUOTE_REPLY_BUTTON_MODE;
  } catch {
    return DEFAULT_QUOTE_REPLY_BUTTON_MODE;
  }
}

function saveQuoteReplyButtonMode(mode: QuoteReplyButtonMode): void {
  try {
    const storage = getStorage();
    if (!storage || typeof storage.setItem !== "function") return;
    storage.setItem(UI_KEYS.quoteReplyButtonMode, mode);
  } catch {
    // Local display preference; in-memory subscribers still update.
  }
}

let currentQuoteReplyButtonMode = loadQuoteReplyButtonMode();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === UI_KEYS.quoteReplyButtonMode || event.key === null) {
      currentQuoteReplyButtonMode = loadQuoteReplyButtonMode();
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function getSnapshot() {
  return currentQuoteReplyButtonMode;
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setQuoteReplyButtonModePreference(
  mode: QuoteReplyButtonMode,
): void {
  currentQuoteReplyButtonMode = mode;
  saveQuoteReplyButtonMode(mode);
  emitChange();
}

export function useQuoteReplyButtonMode() {
  const quoteReplyButtonMode = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_QUOTE_REPLY_BUTTON_MODE,
  );

  const setQuoteReplyButtonMode = useCallback(
    setQuoteReplyButtonModePreference,
    [],
  );

  return {
    quoteReplyButtonMode,
    setQuoteReplyButtonMode,
  };
}

export function getQuoteReplyButtonMode(): QuoteReplyButtonMode {
  return currentQuoteReplyButtonMode;
}
