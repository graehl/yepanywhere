export interface SessionDetailRetentionOptions {
  nowMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  maxBytes?: number;
}

export interface SessionDetailRetentionDefaults {
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 3;
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;

// Built-in fallbacks apply until user preferences configure them (the
// performance-settings module does so at load and on change).
const retentionDefaults: SessionDetailRetentionDefaults = {
  ttlMs: DEFAULT_TTL_MS,
  maxEntries: DEFAULT_MAX_ENTRIES,
  maxBytes: DEFAULT_MAX_BYTES,
};

export function configureSessionDetailRetention(
  overrides: Partial<SessionDetailRetentionDefaults>,
): void {
  Object.assign(retentionDefaults, overrides);
}

export function getSessionDetailRetentionDefaults(): SessionDetailRetentionDefaults {
  return { ...retentionDefaults };
}

export function getSessionDetailNow(
  options?: Pick<SessionDetailRetentionOptions, "nowMs">,
): number {
  return options?.nowMs ?? Date.now();
}

export function getSessionDetailTtlMs(
  options?: Pick<SessionDetailRetentionOptions, "ttlMs">,
): number {
  return options?.ttlMs ?? retentionDefaults.ttlMs;
}

export function getSessionDetailMaxEntries(
  options?: Pick<SessionDetailRetentionOptions, "maxEntries">,
): number {
  return options?.maxEntries ?? retentionDefaults.maxEntries;
}

export function getSessionDetailMaxBytes(
  options?: Pick<SessionDetailRetentionOptions, "maxBytes">,
): number {
  return options?.maxBytes ?? retentionDefaults.maxBytes;
}
