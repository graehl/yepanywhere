// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTooltipWarmth,
  DEFAULT_TOOLTIP_DELAY_MS,
} from "../../../hooks/useTooltipAppearance";
import { UI_KEYS } from "../../../lib/storageKeys";
import { TooltipLayer } from "../TooltipLayer";

const originalClipboard = navigator.clipboard;

describe("TooltipLayer", () => {
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
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("waits for pointer rest and dismisses on later movement", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Command tail">
          Ran
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Ran" });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    expect(target.getAttribute("title")).toBeNull();
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS - 1));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      clientX: 11,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.getByRole("tooltip").textContent).toBe("Command tail");

    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      clientX: 12,
      clientY: 10,
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(target.getAttribute("title")).toBe("Command tail");

    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      clientX: 13,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens a temporally adjacent tooltip immediately only after a reveal", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="First tip">
          First
        </button>
        <button type="button" title="Second tip">
          Second
        </button>
      </>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });

    fireEvent.pointerOver(first, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    expect(screen.getByRole("tooltip").textContent).toBe("First tip");

    fireEvent.pointerOut(first, {
      pointerType: "mouse",
      relatedTarget: second,
    });
    fireEvent.pointerOver(second, {
      pointerType: "mouse",
      clientX: 30,
      clientY: 10,
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Second tip");
  });

  it("captures titles computed on pointer entry", () => {
    render(
      <>
        <TooltipLayer />
        <button
          type="button"
          onPointerEnter={(event) => {
            event.currentTarget.title = "took 1.2s";
          }}
        >
          Ran
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Ran" });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(screen.getByRole("tooltip").textContent).toBe("took 1.2s");
  });

  it("uses explicit data-tooltip text for custom tooltip targets", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" data-tooltip={"Send message\nEnter"}>
          Send
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Send" });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(screen.getByRole("tooltip").textContent).toBe(
      "Send message\nEnter",
    );
  });

  it("uses the same delay and description association for keyboard focus", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Focused hint">
          Focus me
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Focus me" });

    fireEvent.focusIn(target);
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(screen.getByRole("tooltip").textContent).toBe("Focused hint");
    expect(target.getAttribute("aria-describedby")).toBe("ya-global-tooltip");

    fireEvent.focusOut(target);
    expect(target.getAttribute("aria-describedby")).toBeNull();
    expect(target.getAttribute("title")).toBe("Focused hint");
  });

  it("copies and enlarges plain text on an otherwise unused context click", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Copy this tail">
          Ran
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Ran" });
    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    fireEvent.contextMenu(target);

    expect(writeText).toHaveBeenCalledWith("Copy this tail");
    expect(screen.getByRole("tooltip").classList).toContain(
      "ya-tooltip--enlarged",
    );
  });

  it("preserves an app-owned context click instead of copying", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <>
        <TooltipLayer />
        <button
          type="button"
          title="App action"
          onContextMenu={(event) => event.preventDefault()}
        >
          Action
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Action" });
    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    fireEvent.contextMenu(target);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip").classList).not.toContain(
      "ya-tooltip--enlarged",
    );
  });

  it("preserves a browser-owned link context menu instead of copying", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <>
        <TooltipLayer />
        <a href="/elsewhere" title="Link destination">
          Link
        </a>
      </>,
    );
    const target = screen.getByRole("link", { name: "Link" });
    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    fireEvent.contextMenu(target);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip").classList).not.toContain(
      "ya-tooltip--enlarged",
    );
  });

  it("leaves title timing and presentation to the browser in native mode", () => {
    localStorage.setItem(UI_KEYS.tooltipMode, "native");
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Browser tip">
          Native
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Native" });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS * 2));

    expect(target.getAttribute("title")).toBe("Browser tip");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
