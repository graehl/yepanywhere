// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  areTooltipsSuppressed,
  beginTooltipVisibility,
  cancelTooltipIntent,
  clearTooltipWarmth,
  COMPOSER_TYPING_TOOLTIP_SUPPRESSION_MS,
  DEFAULT_TOOLTIP_DELAY_MS,
  endTooltipVisibility,
  getEffectiveTooltipDelayMs,
  getTextTooltipAttributes,
  getTooltipDelayMs,
  hasCurrentPointerIntent,
  scheduleTooltipIntent,
  setElementTextTooltip,
  suppressTooltipsFor,
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("migrates the retired session-card delay at its 3x multiplier", () => {
    localStorage.setItem(UI_KEYS.sessionHoverCardShowDelayMs, "300");
    expect(getTooltipDelayMs()).toBe(100);
  });

  it("defaults to themed while preserving explicit mode choices", () => {
    const { result } = renderHook(() => useTooltipAppearance());

    expect(result.current.tooltipMode).toBe("themed");

    act(() => result.current.setTooltipMode("native"));
    expect(result.current.tooltipMode).toBe("native");

    act(() => result.current.setTooltipMode("themed"));
    expect(result.current.tooltipMode).toBe("themed");

    act(() => result.current.setTooltipDelayMs(80));
    expect(result.current.tooltipMode).toBe("themed");
    expect(result.current.tooltipDelayMs).toBe(80);
    expect(
      localStorage.getItem(UI_KEYS.sessionHoverCardShowDelayMs),
    ).toBeNull();
  });

  it("assigns text hints to exactly one presentation owner", () => {
    expect(getTextTooltipAttributes("Hint", "themed")).toEqual({
      "data-tooltip": "Hint",
    });
    expect(getTextTooltipAttributes("Hint", "native")).toEqual({
      title: "Hint",
    });

    const target = document.createElement("button");
    target.title = "stale native";
    target.dataset.tooltip = "stale themed";
    setElementTextTooltip(target, "Current", "themed");
    expect(target.getAttribute("data-tooltip")).toBe("Current");
    expect(target.getAttribute("title")).toBeNull();

    setElementTextTooltip(target, "Current", "native");
    expect(target.getAttribute("title")).toBe("Current");
    expect(target.getAttribute("data-tooltip")).toBeNull();
  });

  it("keeps the system warm only for the grace after visible tooltips", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    expect(getEffectiveTooltipDelayMs()).toBe(DEFAULT_TOOLTIP_DELAY_MS);

    const token = beginTooltipVisibility();
    expect(getEffectiveTooltipDelayMs()).toBe(0);
    endTooltipVisibility(token);
    vi.setSystemTime(
      1_000 + DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_WARM_GRACE_MULTIPLIER - 1,
    );
    expect(getEffectiveTooltipDelayMs()).toBe(0);

    vi.setSystemTime(
      1_000 + DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_WARM_GRACE_MULTIPLIER + 1,
    );
    expect(getEffectiveTooltipDelayMs()).toBe(DEFAULT_TOOLTIP_DELAY_MS);
  });

  it("supersedes the previous visible tooltip before granting ownership", () => {
    const dismissFirst = vi.fn();
    const dismissSecond = vi.fn();
    const first = beginTooltipVisibility(dismissFirst);

    const second = beginTooltipVisibility(dismissSecond);

    expect(dismissFirst).toHaveBeenCalledOnce();
    expect(dismissSecond).not.toHaveBeenCalled();
    endTooltipVisibility(first);
    expect(getEffectiveTooltipDelayMs()).toBe(0);
    endTooltipVisibility(second);
  });

  it("keeps only the latest pending tooltip intent", () => {
    vi.useFakeTimers();
    const firstOwner = Symbol("first");
    const secondOwner = Symbol("second");
    const firstPublish = vi.fn();
    const secondPublish = vi.fn();
    const firstCancel = vi.fn();

    scheduleTooltipIntent(firstOwner, 50, firstPublish, firstCancel);
    scheduleTooltipIntent(secondOwner, 50, secondPublish);
    vi.advanceTimersByTime(50);

    expect(firstCancel).toHaveBeenCalledWith(secondOwner);
    expect(firstPublish).not.toHaveBeenCalled();
    expect(secondPublish).toHaveBeenCalledOnce();
  });

  it("publishes a zero-delay pointer sweep once on the next frame", () => {
    let flushFrame = () => {};
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      flushFrame = () => callback(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const publishFirst = vi.fn();
    const publishSecond = vi.fn();
    const publishThird = vi.fn();

    scheduleTooltipIntent(Symbol("first"), 0, publishFirst);
    scheduleTooltipIntent(Symbol("second"), 0, publishSecond);
    scheduleTooltipIntent(Symbol("third"), 0, publishThird);

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(publishFirst).not.toHaveBeenCalled();
    expect(publishSecond).not.toHaveBeenCalled();
    expect(publishThird).not.toHaveBeenCalled();
    flushFrame();
    expect(publishFirst).not.toHaveBeenCalled();
    expect(publishSecond).not.toHaveBeenCalled();
    expect(publishThird).toHaveBeenCalledOnce();
  });

  it("rejects a target when browser hover state points elsewhere", () => {
    const target = document.createElement("button");
    document.body.append(target);
    vi.spyOn(document.documentElement, "matches").mockImplementation(
      (selector) => selector === ":hover",
    );
    vi.spyOn(target, "matches").mockReturnValue(false);

    expect(hasCurrentPointerIntent(target)).toBe(false);
  });

  it("cancels a pending intent only for its owner", () => {
    vi.useFakeTimers();
    const owner = Symbol("owner");
    const publish = vi.fn();
    scheduleTooltipIntent(owner, 50, publish);

    cancelTooltipIntent(Symbol("other"));
    vi.advanceTimersByTime(49);
    cancelTooltipIntent(owner);
    vi.advanceTimersByTime(1);

    expect(publish).not.toHaveBeenCalled();
  });

  it("dismisses visible ownership for the composer suppression window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const dismiss = vi.fn();
    const token = beginTooltipVisibility(dismiss);

    suppressTooltipsFor(COMPOSER_TYPING_TOOLTIP_SUPPRESSION_MS);

    expect(dismiss).toHaveBeenCalledOnce();
    expect(areTooltipsSuppressed(1_099)).toBe(true);
    expect(areTooltipsSuppressed(1_100)).toBe(false);
    endTooltipVisibility(token);
  });
});
