export const CLIENT_STORAGE_DEFAULT = "default" as const;

export type ClientStorageDefault = typeof CLIENT_STORAGE_DEFAULT;
export type DefaultedValue<T> = T | ClientStorageDefault;
export type DefaultedBoolean = boolean | ClientStorageDefault;
export type DefaultedBooleanRecord<Key extends string> = Partial<
  Record<Key, DefaultedBoolean>
>;

export function isClientStorageDefault(
  value: unknown,
): value is ClientStorageDefault {
  return value === CLIENT_STORAGE_DEFAULT;
}

export function resolveDefaultedValue<T>(
  stored: DefaultedValue<T>,
  defaultValue: T,
): T {
  return isClientStorageDefault(stored) ? defaultValue : stored;
}

export function normalizeDefaultedBooleanRecord<Key extends string>(
  value: unknown,
  keys: readonly Key[],
): DefaultedBooleanRecord<Key> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const input = value as Partial<Record<Key, unknown>>;
  const normalized: DefaultedBooleanRecord<Key> = {};
  for (const key of keys) {
    const stored = input[key];
    if (typeof stored === "boolean") {
      normalized[key] = stored;
    } else if (stored === CLIENT_STORAGE_DEFAULT) {
      normalized[key] = CLIENT_STORAGE_DEFAULT;
    }
  }
  return normalized;
}

export function resolveDefaultedBooleanRecord<Key extends string>(
  stored: DefaultedBooleanRecord<Key>,
  defaults: Record<Key, boolean>,
  keys: readonly Key[],
): Record<Key, boolean> {
  const resolved = { ...defaults };
  for (const key of keys) {
    const storedValue = stored[key];
    if (typeof storedValue === "boolean") {
      resolved[key] = storedValue;
    }
  }
  return resolved;
}

export function setDefaultedBooleanRecordValue<Key extends string>(
  stored: DefaultedBooleanRecord<Key>,
  key: Key,
  value: DefaultedBoolean,
): DefaultedBooleanRecord<Key> {
  const next = { ...stored };
  if (value === CLIENT_STORAGE_DEFAULT) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export type DefaultedEnumRecord<Key extends string, V extends string> = Partial<
  Record<Key, DefaultedValue<V>>
>;

export function normalizeDefaultedEnumRecord<
  Key extends string,
  V extends string,
>(
  value: unknown,
  keys: readonly Key[],
  isValue: (candidate: unknown) => candidate is V,
): DefaultedEnumRecord<Key, V> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const input = value as Partial<Record<Key, unknown>>;
  const normalized: DefaultedEnumRecord<Key, V> = {};
  for (const key of keys) {
    const stored = input[key];
    if (isValue(stored)) {
      normalized[key] = stored;
    } else if (stored === CLIENT_STORAGE_DEFAULT) {
      normalized[key] = CLIENT_STORAGE_DEFAULT;
    }
  }
  return normalized;
}

export function resolveDefaultedEnumRecord<
  Key extends string,
  V extends string,
>(
  stored: DefaultedEnumRecord<Key, V>,
  defaults: Record<Key, V>,
  keys: readonly Key[],
): Record<Key, V> {
  const resolved = { ...defaults };
  for (const key of keys) {
    const storedValue = stored[key];
    if (storedValue !== undefined && storedValue !== CLIENT_STORAGE_DEFAULT) {
      // Excluding undefined and the "default" sentinel leaves V; TS cannot prove
      // V excludes the "default" literal for an arbitrary V extends string, so
      // cast. Callers store only normalized (validated) values.
      resolved[key] = storedValue as V;
    }
  }
  return resolved;
}

export function setDefaultedEnumRecordValue<
  Key extends string,
  V extends string,
>(
  stored: DefaultedEnumRecord<Key, V>,
  key: Key,
  value: DefaultedValue<V>,
): DefaultedEnumRecord<Key, V> {
  const next = { ...stored };
  if (value === CLIENT_STORAGE_DEFAULT) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}
