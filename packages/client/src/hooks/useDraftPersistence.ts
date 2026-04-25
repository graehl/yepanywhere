import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEBOUNCE_MS = 500;

export interface DraftControls {
  /** Replace input state and localStorage immediately */
  setDraft: (value: string) => void;
  /** Clear input state only, keeping localStorage for failure recovery */
  clearInput: () => void;
  /** Clear both input state and localStorage (call on confirmed success) */
  clearDraft: () => void;
  /** Restore from localStorage (call on failure) */
  restoreFromStorage: () => void;
}

export interface UseDraftPersistenceOptions {
  /** Keep the current in-memory draft when switching to a new storage key that has no draft yet. */
  preserveValueOnKeyChange?: boolean;
}

/** Save a value to localStorage immediately */
function saveToStorage(key: string, value: string): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage might be full or unavailable
  }
}

/**
 * Hook for persisting draft text to localStorage with debouncing.
 * Supports failure recovery by keeping localStorage until explicitly cleared.
 *
 * @param key - localStorage key for this draft (e.g., "draft-message-{sessionId}")
 * @returns [value, setValue, controls] - state-like tuple with control functions
 */
export function useDraftPersistence(
  key: string,
  options?: UseDraftPersistenceOptions,
): [string, (value: string) => void, DraftControls] {
  const [value, setValueInternal] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(key);
  // Track pending value so we can flush on unmount/beforeunload
  const pendingValueRef = useRef<string | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Update keyRef when key changes
  useEffect(() => {
    const previousKey = keyRef.current;
    const previousValue = pendingValueRef.current ?? valueRef.current;
    const keyChanged = previousKey !== key;

    if (keyChanged && pendingValueRef.current !== null) {
      saveToStorage(previousKey, pendingValueRef.current);
      pendingValueRef.current = null;
    }

    keyRef.current = key;

    try {
      const stored = localStorage.getItem(key);
      if (
        keyChanged &&
        options?.preserveValueOnKeyChange &&
        previousValue &&
        !stored
      ) {
        saveToStorage(key, previousValue);
        setValueInternal(previousValue);
        return;
      }
      setValueInternal(stored ?? "");
    } catch {
      setValueInternal("");
    }
  }, [key, options?.preserveValueOnKeyChange]);

  // Flush pending value to localStorage
  const flushPending = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingValueRef.current !== null) {
      saveToStorage(keyRef.current, pendingValueRef.current);
      pendingValueRef.current = null;
    }
  }, []);

  // Handle beforeunload to save draft before page unload (including HMR)
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPending();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushPending]);

  // Debounced save to localStorage
  const setValue = useCallback((newValue: string) => {
    setValueInternal(newValue);
    pendingValueRef.current = newValue;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      saveToStorage(keyRef.current, newValue);
      pendingValueRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  // Replace the draft immediately. This is used when another UI action, such
  // as editing a queued message, needs to take over the composer.
  const setDraft = useCallback((newValue: string) => {
    setValueInternal(newValue);
    pendingValueRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    saveToStorage(keyRef.current, newValue);
  }, []);

  // Clear input state only (for optimistic UI on submit)
  const clearInput = useCallback(() => {
    if (pendingValueRef.current !== null) {
      saveToStorage(keyRef.current, pendingValueRef.current);
    }
    setValueInternal("");
    pendingValueRef.current = null;
    // Cancel pending debounce so we don't overwrite the recovery draft with ""
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Clear both state and localStorage (for confirmed successful send)
  const clearDraft = useCallback(() => {
    setValueInternal("");
    pendingValueRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      localStorage.removeItem(keyRef.current);
    } catch {
      // Ignore errors
    }
  }, []);

  // Restore from localStorage (for failure recovery)
  const restoreFromStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(keyRef.current);
      if (stored) {
        setValueInternal(stored);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Flush pending and cleanup on unmount
  useEffect(() => {
    return () => {
      // Flush any pending value before unmount (handles HMR and navigation)
      if (pendingValueRef.current !== null) {
        saveToStorage(keyRef.current, pendingValueRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const controls = useMemo(
    () => ({ setDraft, clearInput, clearDraft, restoreFromStorage }),
    [setDraft, clearInput, clearDraft, restoreFromStorage],
  );

  return [value, setValue, controls];
}
