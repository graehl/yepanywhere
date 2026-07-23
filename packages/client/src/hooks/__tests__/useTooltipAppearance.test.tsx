// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTooltipVisibility,
  clearTooltipWarmth,
  DEFAULT_TOOLTIP_DELAY_MS,
  endTooltipVisibility,
  getEffectiveTooltipDelayMs,
  getTooltipDelayMs,
  TOOLTIP_WARM_GRACE_MULTIPLIER,
  useTooltipAppearance,
} from "../useTooltipAppearance";
import { UI_KEYS } from "../../lib/storageKeys";

describe("useTooltipAppearance", () => {
  beforeEach(() => {
    localStorage.clear();
    clearTooltipWarmth();
  });

  afterEach(() => {
    cleanup();
    clearTooltipWarmth();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("migrates the retired session-card delay at its 3x multiplier", () => {
    localStorage.setItem(UI_KEYS.sessionHoverCardShowDelayMs, "300");
    expect(getTooltipDelayMs()).toBe(100);
  });

  it("keeps native mode explicit and valid delay edits select themed mode", () => {
    const { result } = renderHook(() => useTooltipAppearance());

    act(() => result.current.setTooltipMode("native"));
    expect(result.current.tooltipMode).toBe("native");

    act(() => result.current.setTooltipDelayMs(80));
    expect(result.current.tooltipMode).toBe("themed");
    expect(result.current.tooltipDelayMs).toBe(80);
    expect(localStorage.getItem(UI_KEYS.sessionHoverCardShowDelayMs)).toBeNull();
  });

  it("keeps the system warm only for the grace after visible tooltips", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    expect(getEffectiveTooltipDelayMs()).toBe(DEFAULT_TOOLTIP_DELAY_MS);

    const token = beginTooltipVisibility();
    expect(getEffectiveTooltipDelayMs()).toBe(0);
    endTooltipVisibility(token);
    vi.setSystemTime(
      1_000 +
        DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_WARM_GRACE_MULTIPLIER -
        1,
    );
    expect(getEffectiveTooltipDelayMs()).toBe(0);

    vi.setSystemTime(
      1_000 + DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_WARM_GRACE_MULTIPLIER + 1,
    );
    expect(getEffectiveTooltipDelayMs()).toBe(DEFAULT_TOOLTIP_DELAY_MS);
  });
});
