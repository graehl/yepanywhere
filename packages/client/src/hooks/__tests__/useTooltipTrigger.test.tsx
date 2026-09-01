// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  clearTooltipWarmth,
  COMPOSER_TYPING_TOOLTIP_SUPPRESSION_MS,
  DEFAULT_TOOLTIP_DELAY_MS,
  suppressTooltipsFor,
} from "../useTooltipAppearance";
import { useTooltipTrigger } from "../useTooltipTrigger";
import { UI_KEYS } from "../../lib/storageKeys";
import "../../../test/pointerEventShim";

function RichTooltipTarget() {
  const [open, setOpen] = useState(false);
  const trigger = useTooltipTrigger({ open, onOpenChange: setOpen });
  return (
    <button
      type="button"
      onPointerEnter={trigger.onPointerEnter}
      onPointerMove={trigger.onPointerMove}
    >
      {open ? "Open" : "Closed"}
    </button>
  );
}

function NamedRichTooltipTarget({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useTooltipTrigger({ open, onOpenChange: setOpen });
  return (
    <button
      type="button"
      data-open={open}
      onPointerEnter={trigger.onPointerEnter}
      onPointerMove={trigger.onPointerMove}
    >
      {name}
    </button>
  );
}

describe("useTooltipTrigger", () => {
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

  it("cancels pending rich tooltips while composer typing is suppressed", () => {
    render(<RichTooltipTarget />);
    const target = screen.getByRole("button", { name: "Closed" });

    fireEvent.pointerEnter(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      suppressTooltipsFor(COMPOSER_TYPING_TOOLTIP_SUPPRESSION_MS);
      vi.advanceTimersByTime(COMPOSER_TYPING_TOOLTIP_SUPPRESSION_MS);
    });
    expect(screen.getByRole("button", { name: "Closed" })).toBeTruthy();

    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      clientX: 16,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("publishes only the latest rich tooltip target", () => {
    render(
      <>
        <NamedRichTooltipTarget name="First" />
        <NamedRichTooltipTarget name="Second" />
      </>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });

    fireEvent.pointerEnter(first, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerEnter(second, {
      pointerType: "mouse",
      clientX: 30,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(first.dataset.open).toBe("false");
    expect(second.dataset.open).toBe("true");
  });
});
