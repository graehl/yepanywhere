import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  configureSessionDetailRetention,
  defaultSessionDetailStore,
} from "../lib/sessionDetail/sessionDetailStore";
import {
  DEFAULT_SESSION_SCROLL_BEHAVIOR_MODE,
  parseSessionScrollBehaviorMode,
  shouldRetainSessionScrollMemory,
  type SessionScrollBehaviorMode,
} from "../lib/sessionScrollBehavior";
import { UI_KEYS } from "../lib/storageKeys";

const DEFAULT_SESSION_DOM_LINGER_ENABLED = false;

/** Budget 0 disables the cache (matching the old default-off toggle). */
const DEFAULT_TRANSCRIPT_CACHE_BUDGET_MB = 0;
/** Budget seeded when only the legacy boolean toggle was enabled;
 * matches the byte cap that toggle governed. */
const LEGACY_ENABLED_BUDGET_MB = 24;
const DEFAULT_TRANSCRIPT_CACHE_TTL_HOURS = 1;

export const TRANSCRIPT_CACHE_BUDGET_MB_STOPS = [
  0, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256,
] as const;
export const TRANSCRIPT_CACHE_TTL_HOUR_STOPS = [
  1, 4, 12, 24, 72, 168,
] as const;

/** Placeholder when no session size has been recorded yet; roughly a
 * typical recent transcript per the 2026-07 charge calibration
 * (see sessionDetail/transcriptCharge.ts). */
export const TYPICAL_SESSION_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

// Canonical home is the store module so non-hook consumers (client
// telemetry) can sample the same stats; re-exported here for the
// settings surface.
export {
  getSessionTranscriptMemoryStats,
  type SessionTranscriptMemoryStats,
} from "../lib/sessionDetail/sessionDetailStore";

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

function loadBooleanPreference(key: string, defaultValue: boolean): boolean {
  const stored = getStorage()?.getItem(key);
  if (stored === null || stored === undefined) {
    return defaultValue;
  }
  return stored === "true";
}

function loadNonNegativeNumberPreference(key: string): number | null {
  const stored = getStorage()?.getItem(key);
  if (stored === null || stored === undefined) {
    return null;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function savePreference(key: string, value: string): void {
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(key, value);
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === UI_KEYS.sessionDomLinger ||
      event.key === UI_KEYS.sessionTranscriptCache ||
      event.key === UI_KEYS.sessionTranscriptCacheBudgetMb ||
      event.key === UI_KEYS.sessionTranscriptCacheTtlHours ||
      event.key === UI_KEYS.sessionScrollBehavior ||
      event.key === null
    ) {
      applySessionDetailRetentionPreferences();
      listener();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function getSnapshot() {
  return [
    getSessionDomLingerEnabled() ? "1" : "0",
    String(getSessionTranscriptCacheBudgetMb()),
    String(getSessionTranscriptCacheTtlHours()),
    getSessionScrollBehaviorMode(),
  ].join(":");
}

function parseSnapshot(snapshot: string) {
  const [domLinger, budgetMb, ttlHours, scrollBehavior] = snapshot.split(":");
  const parsedBudget = Number(budgetMb);
  const parsedTtl = Number(ttlHours);
  const sessionTranscriptCacheBudgetMb = Number.isFinite(parsedBudget)
    ? parsedBudget
    : DEFAULT_TRANSCRIPT_CACHE_BUDGET_MB;
  return {
    sessionDomLingerEnabled: domLinger !== "0",
    sessionTranscriptCacheBudgetMb,
    sessionTranscriptCacheEnabled: sessionTranscriptCacheBudgetMb > 0,
    sessionTranscriptCacheTtlHours: Number.isFinite(parsedTtl)
      ? parsedTtl
      : DEFAULT_TRANSCRIPT_CACHE_TTL_HOURS,
    sessionScrollBehaviorMode:
      parseSessionScrollBehaviorMode(scrollBehavior),
  };
}

export function getSessionDomLingerEnabled(): boolean {
  return loadBooleanPreference(
    UI_KEYS.sessionDomLinger,
    DEFAULT_SESSION_DOM_LINGER_ENABLED,
  );
}

export function getSessionTranscriptCacheBudgetMb(): number {
  const stored = loadNonNegativeNumberPreference(
    UI_KEYS.sessionTranscriptCacheBudgetMb,
  );
  if (stored !== null) {
    return stored;
  }
  if (loadBooleanPreference(UI_KEYS.sessionTranscriptCache, false)) {
    return LEGACY_ENABLED_BUDGET_MB;
  }
  return DEFAULT_TRANSCRIPT_CACHE_BUDGET_MB;
}

export function getSessionTranscriptCacheTtlHours(): number {
  return (
    loadNonNegativeNumberPreference(UI_KEYS.sessionTranscriptCacheTtlHours) ??
    DEFAULT_TRANSCRIPT_CACHE_TTL_HOURS
  );
}

export function getSessionTranscriptCacheEnabled(): boolean {
  return getSessionTranscriptCacheBudgetMb() > 0;
}

export function getSessionScrollBehaviorMode(): SessionScrollBehaviorMode {
  return parseSessionScrollBehaviorMode(
    getStorage()?.getItem(UI_KEYS.sessionScrollBehavior),
  );
}

function applySessionDetailRetentionPreferences(): void {
  const budgetMb = getSessionTranscriptCacheBudgetMb();
  configureSessionDetailRetention({
    // Budget is the sole size policy; no entry-count cap.
    maxEntries: Number.POSITIVE_INFINITY,
    // Off (budget 0) is enforced at the hook layer (no snapshot
    // reads/writes, delete at unmount), so keep a sane byte floor here
    // rather than a 0 cap that would reject unrelated store writes.
    maxBytes:
      (budgetMb > 0 ? budgetMb : LEGACY_ENABLED_BUDGET_MB) * 1024 * 1024,
    ttlMs: getSessionTranscriptCacheTtlHours() * 60 * 60 * 1000,
  });
}

export function setSessionDomLingerPreference(enabled: boolean): void {
  savePreference(UI_KEYS.sessionDomLinger, String(enabled));
  emitChange();
}

export function setSessionTranscriptCacheBudgetMbPreference(
  budgetMb: number,
): void {
  const normalized = Number.isFinite(budgetMb) ? Math.max(0, budgetMb) : 0;
  savePreference(UI_KEYS.sessionTranscriptCacheBudgetMb, String(normalized));
  // Keep the legacy boolean coherent for older bundles reading it.
  savePreference(UI_KEYS.sessionTranscriptCache, String(normalized > 0));
  if (normalized <= 0) {
    defaultSessionDetailStore.clear();
  }
  applySessionDetailRetentionPreferences();
  emitChange();
}

export function setSessionTranscriptCacheTtlHoursPreference(
  ttlHours: number,
): void {
  const normalized =
    Number.isFinite(ttlHours) && ttlHours > 0
      ? ttlHours
      : DEFAULT_TRANSCRIPT_CACHE_TTL_HOURS;
  savePreference(UI_KEYS.sessionTranscriptCacheTtlHours, String(normalized));
  applySessionDetailRetentionPreferences();
  emitChange();
}

export function setSessionScrollBehaviorModePreference(
  mode: SessionScrollBehaviorMode,
): void {
  const normalized = parseSessionScrollBehaviorMode(mode);
  savePreference(UI_KEYS.sessionScrollBehavior, normalized);
  if (!shouldRetainSessionScrollMemory(normalized)) {
    defaultSessionDetailStore.clearScrollSnapshots();
  }
  emitChange();
}

/**
 * Most recent measured transcript size at session leave; feeds the
 * budget slider's "sessions like your last" hint.
 */
export function recordLastSessionTranscriptBytes(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return;
  }
  savePreference(UI_KEYS.sessionLastTranscriptBytes, String(Math.round(bytes)));
}

export function getLastSessionTranscriptBytes(): number | null {
  const stored = loadNonNegativeNumberPreference(
    UI_KEYS.sessionLastTranscriptBytes,
  );
  return stored !== null && stored > 0 ? stored : null;
}

// TTL eviction otherwise only runs when something calls into the store,
// so an idle background tab would keep its cache past expiry. A
// low-frequency sweep (browser-throttled when backgrounded) reclaims it.
const SWEEP_INTERVAL_MS = 60 * 1000;

if (typeof window !== "undefined") {
  applySessionDetailRetentionPreferences();
  if (import.meta.env.MODE !== "test") {
    window.setInterval(() => {
      defaultSessionDetailStore.evictExpired();
    }, SWEEP_INTERVAL_MS);
  }
}

export function useSessionPerformanceSettings() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => `0:0:1:${DEFAULT_SESSION_SCROLL_BEHAVIOR_MODE}`,
  );
  const settings = useMemo(() => parseSnapshot(snapshot), [snapshot]);

  const setSessionDomLingerEnabled = useCallback(
    setSessionDomLingerPreference,
    [],
  );
  const setSessionTranscriptCacheBudgetMb = useCallback(
    setSessionTranscriptCacheBudgetMbPreference,
    [],
  );
  const setSessionTranscriptCacheTtlHours = useCallback(
    setSessionTranscriptCacheTtlHoursPreference,
    [],
  );
  const setSessionScrollBehaviorMode = useCallback(
    setSessionScrollBehaviorModePreference,
    [],
  );

  return {
    ...settings,
    setSessionDomLingerEnabled,
    setSessionTranscriptCacheBudgetMb,
    setSessionTranscriptCacheTtlHours,
    setSessionScrollBehaviorMode,
  };
}
