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
  TOOLTIP_CLOSE_DELAY_MULTIPLIER,
} from "../../../hooks/useTooltipAppearance";
import { UI_KEYS } from "../../../lib/storageKeys";
import "../../../../test/pointerEventShim";
import { TooltipLayer } from "../TooltipLayer";

const originalClipboard = navigator.clipboard;

describe("TooltipLayer", () => {
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
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("stays readable through same-target motion and follow scroll", () => {
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
    expect(screen.getByRole("tooltip").textContent).toBe("Command tail");
    expect(target.getAttribute("title")).toBeNull();

    fireEvent.keyDown(document, {
      key: "Shift",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Command tail");

    fireEvent.scroll(window);
    fireEvent.pointerOut(target, {
      pointerType: "mouse",
      clientX: 12,
      clientY: 10,
      relatedTarget: document.body,
    });
    fireEvent.pointerOver(document.body, {
      pointerType: "mouse",
      clientX: 12,
      clientY: 10,
      relatedTarget: target,
    });
    act(() =>
      vi.advanceTimersByTime(
        DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_CLOSE_DELAY_MULTIPLIER,
      ),
    );
    expect(screen.getByRole("tooltip").textContent).toBe("Command tail");

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
    expect(screen.getByRole("tooltip").textContent).toBe("Command tail");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("Command tail");
  });

  it("keeps the tooltip open while hovering and selecting its text", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Selectable tail">
          Ran
        </button>
        <button type="button" title="Underlying tip">
          Under
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Ran" });
    const underlyingTarget = screen.getByRole("button", { name: "Under" });
    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));
    const tooltip = screen.getByRole("tooltip");

    fireEvent.pointerOut(target, {
      pointerType: "mouse",
      clientX: 20,
      clientY: 20,
      relatedTarget: tooltip,
    });
    fireEvent.pointerOver(tooltip, {
      pointerType: "mouse",
      clientX: 20,
      clientY: 20,
      relatedTarget: target,
    });
    fireEvent.pointerMove(tooltip, {
      pointerType: "mouse",
      clientX: 22,
      clientY: 20,
    });
    fireEvent.pointerDown(tooltip, {
      pointerType: "mouse",
      button: 0,
      clientX: 22,
      clientY: 20,
    });
    act(() =>
      vi.advanceTimersByTime(
        DEFAULT_TOOLTIP_DELAY_MS * TOOLTIP_CLOSE_DELAY_MULTIPLIER,
      ),
    );
    expect(screen.getByRole("tooltip").textContent).toBe("Selectable tail");
    expect(underlyingTarget.getAttribute("aria-describedby")).toBeNull();
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
      clientX: 12,
      clientY: 10,
      relatedTarget: second,
    });
    fireEvent.pointerOver(second, {
      pointerType: "mouse",
      clientX: 12,
      clientY: 10,
    });
    expect(screen.getByRole("tooltip").textContent).toBe("First tip");
    expect(first.getAttribute("aria-describedby")).toBe("ya-global-tooltip");
    expect(second.getAttribute("aria-describedby")).toBeNull();

    fireEvent.pointerMove(second, {
      pointerType: "mouse",
      clientX: 16,
      clientY: 10,
    });
    expect(first.getAttribute("aria-describedby")).toBeNull();
    expect(second.getAttribute("aria-describedby")).toBe("ya-global-tooltip");
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
    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("took 1.2s");
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

    expect(screen.getByRole("tooltip").textContent).toBe("Send message\nEnter");
  });

  it("suppresses an exact-content tooltip while the full text is visible", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Visible command">
          Visible command
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Visible command" });
    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 120 },
      clientHeight: { configurable: true, value: 24 },
      scrollWidth: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 24 },
    });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(target.getAttribute("title")).toBeNull();
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      clientX: 11,
      clientY: 10,
    });
    expect(target.getAttribute("title")).toBeNull();
    fireEvent.pointerOut(target, { relatedTarget: document.body });
    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("Visible command");
  });

  it("keeps an exact-content tooltip when the visible text is clipped", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Clipped command">
          Clipped command
        </button>
      </>,
    );
    const target = screen.getByRole("button", { name: "Clipped command" });
    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 60 },
      clientHeight: { configurable: true, value: 24 },
      scrollWidth: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 24 },
    });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(screen.getByRole("tooltip").textContent).toBe("Clipped command");
  });

  it("keeps an exact-content tooltip when a scroll ancestor clips it", () => {
    render(
      <>
        <TooltipLayer />
        <div data-testid="scrollport" style={{ overflow: "hidden" }}>
          <button type="button" title="Clipped command">
            Clipped command
          </button>
        </div>
      </>,
    );
    const target = screen.getByRole("button", { name: "Clipped command" });
    const scrollport = screen.getByTestId("scrollport");
    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 120 },
      clientHeight: { configurable: true, value: 24 },
      scrollWidth: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 24 },
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 0,
      left: 40,
      top: 0,
      right: 160,
      bottom: 24,
      width: 120,
      height: 24,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 40,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });

    fireEvent.pointerOver(target, {
      pointerType: "mouse",
      clientX: 50,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(DEFAULT_TOOLTIP_DELAY_MS));

    expect(screen.getByRole("tooltip").textContent).toBe("Clipped command");
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
    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("Focused hint");
  });

  it("detaches native titles for all of themed mode and restores Native mode", () => {
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Browser-owned hint">
          Target
        </button>
        <svg role="img" aria-label="Starred">
          <title>Starred</title>
        </svg>
      </>,
    );
    const target = screen.getByRole("button", { name: "Target" });
    const svgTarget = screen.getByRole("img", { name: "Starred" });
    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("Browser-owned hint");
    expect(svgTarget.querySelector("title")).toBeNull();
    expect(svgTarget.getAttribute("data-tooltip")).toBe("Starred");

    act(() => {
      localStorage.setItem(UI_KEYS.tooltipMode, "native");
      window.dispatchEvent(
        new StorageEvent("storage", { key: UI_KEYS.tooltipMode }),
      );
    });
    expect(target.getAttribute("title")).toBe("Browser-owned hint");
    expect(target.getAttribute("data-tooltip")).toBeNull();
    expect(svgTarget.querySelector("title")?.textContent).toBe("Starred");
    expect(svgTarget.getAttribute("data-tooltip")).toBeNull();

    act(() => {
      localStorage.setItem(UI_KEYS.tooltipMode, "themed");
      window.dispatchEvent(
        new StorageEvent("storage", { key: UI_KEYS.tooltipMode }),
      );
    });
    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("Browser-owned hint");
    expect(svgTarget.querySelector("title")).toBeNull();
    expect(svgTarget.getAttribute("data-tooltip")).toBe("Starred");
  });

  it("detaches titles added after themed mode mounts", async () => {
    render(<TooltipLayer />);
    const target = document.createElement("button");
    target.textContent = "Late target";
    target.title = "Late hint";
    document.body.append(target);

    await act(async () => Promise.resolve());

    expect(target.getAttribute("title")).toBeNull();
    expect(target.getAttribute("data-tooltip")).toBe("Late hint");
    target.remove();
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

    fireEvent.contextMenu(screen.getByRole("tooltip"));

    expect(writeText).toHaveBeenCalledWith("Copy this tail");
    expect(screen.getByRole("tooltip").classList).toContain(
      "ya-tooltip--enlarged",
    );
  });

  it("preserves the browser menu for selected tooltip text", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(document, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "Selected tail",
    } as Selection);
    render(
      <>
        <TooltipLayer />
        <button type="button" title="Selected tail">
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

    fireEvent.contextMenu(screen.getByRole("tooltip"));

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip").classList).not.toContain(
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

  it("leaves title timing and presentation to the browser by default", () => {
    localStorage.removeItem(UI_KEYS.tooltipMode);
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
