import { useCallback, useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export type TooltipMode = "themed" | "native";

export const TOOLTIP_DELAY_MIN_MS = 0;
export const TOOLTIP_DELAY_MAX_MS = 1000;
export const TOOLTIP_DELAY_STEP_MS = 10;
export const DEFAULT_TOOLTIP_DELAY_MS = 50;

/** Larger session previews should not open during a casual pass over a list. */
export const SESSION_HOVERCARD_DELAY_MULTIPLIER = 3;

/**
 * Once a tooltip has opened, a short time-only adjacency window makes scanning
 * neighboring targets immediate. Targets merely crossed before opening do not
 * warm the system.
 */
export const TOOLTIP_WARM_GRACE_MULTIPLIER = 6;

const listeners = new Set<() => void>();
const visibleTooltipTokens = new Set<symbol>();
let warmUntilMs = 0;
let storageListener: ((event: StorageEvent) => void) | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTooltipDelay(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOOLTIP_DELAY_MS;
  return clamp(
    Math.round(value / TOOLTIP_DELAY_STEP_MS) * TOOLTIP_DELAY_STEP_MS,
    TOOLTIP_DELAY_MIN_MS,
    TOOLTIP_DELAY_MAX_MS,
  );
}

function readStoredNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

export function getTooltipMode(): TooltipMode {
  try {
    return localStorage.getItem(UI_KEYS.tooltipMode) === "native"
      ? "native"
      : "themed";
  } catch {
    return "themed";
  }
}

/**
 * The retired hover-card delay seeds the shared base at one third of its old
 * value, preserving the existing card timing for browsers that customized it.
 */
export function getTooltipDelayMs(): number {
  const stored = readStoredNumber(UI_KEYS.tooltipDelayMs);
  if (stored !== null) return normalizeTooltipDelay(stored);

  const legacyHoverCardDelay = readStoredNumber(
    UI_KEYS.sessionHoverCardShowDelayMs,
  );
  return legacyHoverCardDelay === null
    ? DEFAULT_TOOLTIP_DELAY_MS
    : normalizeTooltipDelay(
        legacyHoverCardDelay / SESSION_HOVERCARD_DELAY_MULTIPLIER,
      );
}

function applyTooltipDelayCssVariable(delayMs: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--tooltip-delay-ms",
    `${delayMs}ms`,
  );
  document.documentElement.dataset.tooltipMode = getTooltipMode();
}

function emitChange(): void {
  applyTooltipDelayCssVariable(getTooltipDelayMs());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListener && typeof window !== "undefined") {
    storageListener = (event) => {
      if (
        event.key === null ||
        event.key === UI_KEYS.tooltipMode ||
        event.key === UI_KEYS.tooltipDelayMs ||
        event.key === UI_KEYS.sessionHoverCardShowDelayMs
      ) {
        emitChange();
      }
    };
    window.addEventListener("storage", storageListener);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListener) {
      window.removeEventListener("storage", storageListener);
      storageListener = null;
    }
  };
}

export function initializeTooltipAppearance(): void {
  applyTooltipDelayCssVariable(getTooltipDelayMs());
}

export function useTooltipDelayMs(): number {
  return useSyncExternalStore(
    subscribe,
    getTooltipDelayMs,
    () => DEFAULT_TOOLTIP_DELAY_MS,
  );
}

export function useTooltipAppearance() {
  const tooltipMode = useSyncExternalStore(
    subscribe,
    getTooltipMode,
    () => "themed" as const,
  );
  const tooltipDelayMs = useTooltipDelayMs();

  const setTooltipMode = useCallback((value: TooltipMode) => {
    try {
      localStorage.setItem(UI_KEYS.tooltipMode, value);
    } catch {
      // See setTooltipDelayMs.
    }
    warmUntilMs = 0;
    emitChange();
  }, []);

  const setTooltipDelayMs = useCallback((value: number) => {
    try {
      localStorage.setItem(
        UI_KEYS.tooltipDelayMs,
        String(normalizeTooltipDelay(value)),
      );
      localStorage.setItem(UI_KEYS.tooltipMode, "themed");
      localStorage.removeItem(UI_KEYS.sessionHoverCardShowDelayMs);
    } catch {
      // This browser-local presentation preference may remain at its default
      // when persistence is unavailable.
    }
    warmUntilMs = 0;
    emitChange();
  }, []);

  const resetTooltipDelayMs = useCallback(() => {
    try {
      localStorage.removeItem(UI_KEYS.tooltipDelayMs);
      localStorage.removeItem(UI_KEYS.sessionHoverCardShowDelayMs);
    } catch {
      // See setTooltipDelayMs.
    }
    warmUntilMs = 0;
    emitChange();
  }, []);

  return {
    tooltipMode,
    tooltipDelayMs,
    setTooltipMode,
    setTooltipDelayMs,
    resetTooltipDelayMs,
  };
}

export function isTooltipWarm(nowMs = Date.now()): boolean {
  return visibleTooltipTokens.size > 0 || nowMs <= warmUntilMs;
}

export function getEffectiveTooltipDelayMs(
  multiplier = 1,
  nowMs = Date.now(),
): number {
  return isTooltipWarm(nowMs)
    ? 0
    : Math.round(getTooltipDelayMs() * multiplier);
}

export function beginTooltipVisibility(): symbol {
  const token = Symbol("visible-tooltip");
  visibleTooltipTokens.add(token);
  return token;
}

export function endTooltipVisibility(
  token: symbol,
  nowMs = Date.now(),
): void {
  if (!visibleTooltipTokens.delete(token) || visibleTooltipTokens.size > 0) {
    return;
  }
  warmUntilMs =
    nowMs + getTooltipDelayMs() * TOOLTIP_WARM_GRACE_MULTIPLIER;
}

/** Clears process-local hover state after navigation/tests or a hard reset. */
export function clearTooltipWarmth(): void {
  visibleTooltipTokens.clear();
  warmUntilMs = 0;
}
