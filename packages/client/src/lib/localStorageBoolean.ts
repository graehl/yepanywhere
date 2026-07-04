/**
 * Shared store for one boolean UI preference persisted in localStorage,
 * shaped for useSyncExternalStore: pass `subscribe` and `read` straight
 * through (`read` also serves as the server snapshot — it returns the
 * default wherever storage is unavailable).
 *
 * `read` goes to storage on every call so writes that bypass `set` (tests,
 * other tabs' handlers) are picked up on the next render. `set` persists and
 * notifies same-tab subscribers; storage failures (privacy mode, quota,
 * SSR) fall back to the default and never block the in-memory update —
 * these are local display preferences. One "storage" listener per store,
 * attached while subscribers exist, relays cross-tab changes.
 *
 * Absent key reads as `defaultValue`; any stored value other than "true"
 * reads as false. `set` only ever writes "true"/"false".
 */
export interface LocalStorageBooleanStore {
  read(): boolean;
  set(value: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): LocalStorageBooleanStore {
  const listeners = new Set<() => void>();
  let onStorage: ((event: StorageEvent) => void) | null = null;

  const read = (): boolean => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : stored === "true";
    } catch {
      return defaultValue;
    }
  };

  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (!onStorage && typeof window !== "undefined") {
      onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          emit();
        }
      };
      window.addEventListener("storage", onStorage);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && onStorage) {
        window.removeEventListener("storage", onStorage);
        onStorage = null;
      }
    };
  };

  const set = (value: boolean): void => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Persistence failed; in-memory subscribers still update.
    }
    emit();
  };

  return { read, set, subscribe };
}
