import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientSummarySourceKey } from "../lib/clientSummaryStore";
import {
  type DraftAttachmentState,
  draftStorageValueForAttachments,
  draftStorageValueForText,
  hasDraftContentValue,
  readDraftAttachmentStateValue,
  readDraftTextValue,
} from "../lib/draftEnvelope";
import {
  createSessionDraftStorageKey,
  removeSessionDraft,
  saveSessionDraft,
  updateSessionDraftIndex,
} from "../lib/sessionDraftStorage";

export interface DraftControls {
  /** Return the current in-memory draft value */
  getDraft: () => string;
  /** Read the current staged attachment state from localStorage. */
  getAttachmentState: () => DraftAttachmentState | null;
  /** Replace input state and localStorage immediately */
  setDraft: (value: string) => void;
  /** Replace staged attachment state in the draft envelope. */
  setAttachmentState: (value: DraftAttachmentState | null) => void;
  /** Replace one draft range through the owning textarea when available. */
  replaceDraftRangeUndoably?: (
    start: number,
    end: number,
    replacement: string,
  ) => string | null;
  /** Flush any pending draft write immediately */
  flushDraft: () => void;
  /** Clear input state only, keeping localStorage for failure recovery */
  clearInput: () => void;
  /** Clear both input state and localStorage (call on confirmed success) */
  clearDraft: () => void;
  /** Restore from localStorage (call on failure) */
  restoreFromStorage: () => void;
  /** Focus the textarea that owns this draft, if it is mounted. */
  focus?: () => void;
  /** Place the textarea caret/selection, if it is mounted. */
  setSelectionRange?: (start: number, end: number) => void;
}

export interface UseDraftPersistenceOptions {
  /** Keep the current in-memory draft when switching to a new storage key that has no draft yet. */
  preserveValueOnKeyChange?: boolean;
  /** Source-scoped session draft metadata for efficient badge indexing. */
  sessionDraft?: {
    sourceKey: ClientSummarySourceKey;
    sessionId: string;
  };
}

/** Save a value to localStorage immediately */
function saveToStorage(
  key: string,
  value: string,
  sessionDraft?: UseDraftPersistenceOptions["sessionDraft"],
): void {
  if (sessionDraft) {
    saveSessionDraft(sessionDraft, value);
    return;
  }

  try {
    const nextValue = draftStorageValueForText(value, localStorage.getItem(key));
    if (nextValue) {
      localStorage.setItem(key, nextValue);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage might be full or unavailable
  }
}

function saveAttachmentStateToStorage(
  key: string,
  value: DraftAttachmentState | null,
  sessionDraft?: UseDraftPersistenceOptions["sessionDraft"],
): void {
  const storageKey = sessionDraft
    ? createSessionDraftStorageKey(sessionDraft)
    : key;
  let nextValue: string | null = null;

  try {
    nextValue = draftStorageValueForAttachments(
      value,
      localStorage.getItem(storageKey),
    );
    if (nextValue) {
      localStorage.setItem(storageKey, nextValue);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // localStorage might be full or unavailable.
  }

  if (sessionDraft) {
    updateSessionDraftIndex(sessionDraft, nextValue);
  }
}

function removeFromStorage(
  key: string,
  sessionDraft?: UseDraftPersistenceOptions["sessionDraft"],
): void {
  if (sessionDraft) {
    removeSessionDraft(sessionDraft);
    return;
  }

  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage might be unavailable.
  }
}

function readStorageText(key: string): string {
  try {
    return readDraftTextValue(localStorage.getItem(key));
  } catch {
    return "";
  }
}

function readStorageAttachmentState(key: string): DraftAttachmentState | null {
  try {
    return readDraftAttachmentStateValue(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function hasStorageDraftContent(key: string): boolean {
  try {
    return hasDraftContentValue(localStorage.getItem(key));
  } catch {
    return false;
  }
}

function updateStoredSessionDraftIndex(
  sessionDraft: UseDraftPersistenceOptions["sessionDraft"],
): void {
  if (!sessionDraft) return;
  try {
    updateSessionDraftIndex(
      sessionDraft,
      localStorage.getItem(createSessionDraftStorageKey(sessionDraft)),
    );
  } catch {
    updateSessionDraftIndex(sessionDraft, "");
  }
}

/**
 * Hook for persisting draft text to localStorage.
 * Supports failure recovery by keeping localStorage until explicitly cleared.
 *
 * @param key - localStorage key for this draft (e.g., "draft-message-{sessionId}")
 * @returns [value, setValue, controls] - state-like tuple with control functions
 */
export function useDraftPersistence(
  key: string,
  options?: UseDraftPersistenceOptions,
): [string, (value: string) => void, DraftControls] {
  const [value, setValueInternal] = useState(() => readStorageText(key));

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(key);
  const sessionDraftRef = useRef(options?.sessionDraft);
  // Track pending value so we can flush on unmount/beforeunload
  const pendingValueRef = useRef<string | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Update keyRef when key changes
  useEffect(() => {
    const previousKey = keyRef.current;
    const previousSessionDraft = sessionDraftRef.current;
    const previousValue = pendingValueRef.current ?? valueRef.current;
    const keyChanged = previousKey !== key;
    const sessionDraftChanged =
      previousSessionDraft?.sourceKey !== options?.sessionDraft?.sourceKey ||
      previousSessionDraft?.sessionId !== options?.sessionDraft?.sessionId;

    if (
      (keyChanged || sessionDraftChanged) &&
      pendingValueRef.current !== null
    ) {
      saveToStorage(previousKey, pendingValueRef.current, previousSessionDraft);
      pendingValueRef.current = null;
    }
    if (sessionDraftChanged && previousSessionDraft) {
      updateStoredSessionDraftIndex(previousSessionDraft);
    }

    keyRef.current = key;
    sessionDraftRef.current = options?.sessionDraft;

    try {
      const hasStoredDraft = hasStorageDraftContent(key);
      if (
        (keyChanged || sessionDraftChanged) &&
        options?.preserveValueOnKeyChange &&
        previousValue &&
        !hasStoredDraft
      ) {
        saveToStorage(key, previousValue, options.sessionDraft);
        valueRef.current = previousValue;
        setValueInternal(previousValue);
        return;
      }
      const storedText = readStorageText(key);
      valueRef.current = storedText;
      setValueInternal(storedText);
    } catch {
      valueRef.current = "";
      setValueInternal("");
    }
  }, [
    key,
    options?.preserveValueOnKeyChange,
    options?.sessionDraft?.sourceKey,
    options?.sessionDraft?.sessionId,
  ]);

  // Flush pending value to localStorage
  const flushPending = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingValueRef.current !== null) {
      saveToStorage(
        keyRef.current,
        pendingValueRef.current,
        sessionDraftRef.current,
      );
      pendingValueRef.current = null;
    }
  }, []);

  // Handle lifecycle boundaries to save drafts before the page can be frozen,
  // discarded, or refreshed. `pagehide` covers mobile/browser cache paths where
  // `beforeunload` is skipped.
  useEffect(() => {
    const handlePageExit = () => {
      flushPending();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPending();
      }
    };
    window.addEventListener("beforeunload", handlePageExit);
    window.addEventListener("pagehide", handlePageExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handlePageExit);
      window.removeEventListener("pagehide", handlePageExit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPending]);

  // Save each edit immediately. A debounce window can lose the newest typed
  // text during HMR/reload paths that do not reliably fire page lifecycle
  // events before React remounts and restores the previous storage value.
  const setValue = useCallback((newValue: string) => {
    valueRef.current = newValue;
    setValueInternal(newValue);
    pendingValueRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    saveToStorage(keyRef.current, newValue, sessionDraftRef.current);
  }, []);

  // Read the current in-memory value for UI actions that append to the draft.
  const getDraft = useCallback(() => valueRef.current, []);

  const getAttachmentState = useCallback(
    () => readStorageAttachmentState(keyRef.current),
    [],
  );

  // Replace the draft immediately. This is used when another UI action, such
  // as editing a queued message, needs to take over the composer.
  const setDraft = useCallback((newValue: string) => {
    valueRef.current = newValue;
    setValueInternal(newValue);
    pendingValueRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    saveToStorage(keyRef.current, newValue, sessionDraftRef.current);
  }, []);

  const setAttachmentState = useCallback(
    (newValue: DraftAttachmentState | null) => {
      saveAttachmentStateToStorage(
        keyRef.current,
        newValue,
        sessionDraftRef.current,
      );
    },
    [],
  );

  // Clear input state only (for optimistic UI on submit)
  const clearInput = useCallback(() => {
    if (pendingValueRef.current !== null) {
      saveToStorage(
        keyRef.current,
        pendingValueRef.current,
        sessionDraftRef.current,
      );
    }
    valueRef.current = "";
    setValueInternal("");
    pendingValueRef.current = null;
    // Cancel pending write so we don't overwrite the recovery draft with ""
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Clear both state and localStorage (for confirmed successful send)
  const clearDraft = useCallback(() => {
    valueRef.current = "";
    setValueInternal("");
    pendingValueRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    removeFromStorage(keyRef.current, sessionDraftRef.current);
  }, []);

  // Restore from localStorage (for failure recovery)
  const restoreFromStorage = useCallback(() => {
    try {
      const storedText = readStorageText(keyRef.current);
      valueRef.current = storedText;
      setValueInternal(storedText);
    } catch {
      // Ignore errors
    }
  }, []);

  // Flush pending and cleanup on unmount
  useEffect(() => {
    return () => {
      // Flush any pending value before unmount (handles HMR and navigation)
      if (pendingValueRef.current !== null) {
        saveToStorage(
          keyRef.current,
          pendingValueRef.current,
          sessionDraftRef.current,
        );
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const controls = useMemo(
    () => ({
      getDraft,
      getAttachmentState,
      setDraft,
      setAttachmentState,
      flushDraft: flushPending,
      clearInput,
      clearDraft,
      restoreFromStorage,
    }),
    [
      getDraft,
      getAttachmentState,
      setDraft,
      setAttachmentState,
      flushPending,
      clearInput,
      clearDraft,
      restoreFromStorage,
    ],
  );

  return [value, setValue, controls];
}
