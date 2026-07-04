/**
 * Shared store for one primitive UI preference persisted in localStorage,
 * shaped for useSyncExternalStore: pass `subscribe` and `read` straight
 * through (`read` also serves as the server snapshot — it returns the
 * default wherever storage is unavailable).
 *
 * `read` goes to storage on every call so writes that bypass `set` (tests,
 * other tabs' handlers) are picked up on the next render; values are
 * constrained to primitives so read-through snapshots stay `===`-stable
 * for useSyncExternalStore. `set` persists and notifies same-tab
 * subscribers; storage failures (privacy mode, quota, SSR) fall back to
 * the default and never block the in-memory update — these are local
 * display preferences. One "storage" listener per store, attached while
 * subscribers exist, relays cross-tab changes.
 *
 * An absent key reads as `defaultValue`; a present value is interpreted
 * by `parse`, whose `undefined` also falls back to `defaultValue`.
 */
export interface LocalStorageValueStore<T> {
  read(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createLocalStorageValue<T extends string | number | boolean>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string = String,
): LocalStorageValueStore<T> {
  const listeners = new Set<() => void>();
  let onStorage: ((event: StorageEvent) => void) | null = null;

  const read = (): T => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return defaultValue;
      return parse(stored) ?? defaultValue;
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

  const set = (value: T): void => {
    try {
      localStorage.setItem(key, serialize(value));
    } catch {
      // Persistence failed; in-memory subscribers still update.
    }
    emit();
  };

  return { read, set, subscribe };
}

/**
 * Boolean instantiation preserving the original boolean-store contract:
 * absent key reads as `defaultValue`, but any present value other than
 * "true" reads as false (not as the default).
 */
export function createLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): LocalStorageValueStore<boolean> {
  return createLocalStorageValue(key, defaultValue, (raw) => raw === "true");
}
