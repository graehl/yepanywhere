// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTooltipWarmth,
  DEFAULT_TOOLTIP_DELAY_MS,
} from "../../hooks/useTooltipAppearance";
import { RiskAffordance } from "../RiskAffordance";

describe("RiskAffordance tooltip timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    clearTooltipWarmth();
  });

  afterEach(() => {
    cleanup();
    clearTooltipWarmth();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("requires pointer rest and stays dismissed until pointer leave", () => {
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

    fireEvent.pointerEnter(target);
    fireEvent.pointerMove(target);
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");

    fireEvent.pointerMove(target);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerMove(target);
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerLeave(target);
    fireEvent.pointerEnter(target);
    expect(screen.getByRole("tooltip").textContent).toBe("Risk explanation");
  });
});
