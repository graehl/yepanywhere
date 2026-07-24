// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTooltipWarmth,
  DEFAULT_TOOLTIP_DELAY_MS,
  TOOLTIP_CLOSE_DELAY_MULTIPLIER,
} from "../../hooks/useTooltipAppearance";
import { UI_KEYS } from "../../lib/storageKeys";
import "../../../test/pointerEventShim";
import { RiskAffordance } from "../RiskAffordance";

describe("RiskAffordance tooltip timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem(UI_KEYS.tooltipMode, "themed");
    clearTooltipWarmth();
  });

  afterEach(() => {
    cleanup();
    clearTooltipWarmth();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("persists through motion and closes after deliberate departure", () => {
    render(
      <RiskAffordance
        label="what is the risk?"
        modalTitle="Risk"
        explanation="Risk explanation"
      />,
    );
    const target = screen.getByRole("button", {
      name: "what is the risk?",
    });

    const hoverRegion = target.closest(".external-session-risk");
    expect(hoverRegion).toBeTruthy();
    if (!(hoverRegion instanceof HTMLElement)) return;

    fireEvent.pointerEnter(hoverRegion, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(hoverRegion, {
      pointerType: "mouse",
      clientX: 11,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");
    expect(hoverRegion.classList).toContain(
      "external-session-risk--tooltip-visible",
    );

    const tooltip = screen.getByRole("tooltip");
    fireEvent.pointerMove(tooltip, {
      pointerType: "mouse",
      clientX: 12,
      clientY: 10,
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");

    fireEvent.pointerLeave(hoverRegion, {
      pointerType: "mouse",
      clientX: 12,
      clientY: 10,
      relatedTarget: document.body,
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");

    fireEvent.pointerMove(document.body, {
      pointerType: "mouse",
      clientX: 14,
      clientY: 10,
    });
    act(() =>
      vi.advanceTimersByTime(
        DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_CLOSE_DELAY_MULTIPLIER,
      ),
    );
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");

    fireEvent.pointerMove(document.body, {
      pointerType: "mouse",
      clientX: 20,
      clientY: 10,
    });
    act(() =>
      vi.advanceTimersByTime(
        DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_CLOSE_DELAY_MULTIPLIER - 1,
      ),
    );
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(hoverRegion.classList).not.toContain(
      "external-session-risk--tooltip-visible",
    );
  });
});
