// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../../lib/storageKeys";
import { PerformanceSettings } from "../PerformanceSettings";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../SettingsPaneTitleContext", () => ({
  useSettingsPaneTitle: vi.fn(),
}));

const undoMocks = vi.hoisted(() => ({
  useSettingsUndoBaseline: vi.fn(),
}));

vi.mock("../SettingsUndoContext", () => undoMocks);

describe("PerformanceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    undoMocks.useSettingsUndoBaseline.mockClear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("defaults off-screen transcript rendering off and persists opt-in", () => {
    render(<PerformanceSettings />);

    const toggle = screen.getByRole("checkbox", {
      name: "performanceOffscreenTranscriptRenderingTitle",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);

    expect(toggle.checked).toBe(true);
    expect(
      window.localStorage.getItem(UI_KEYS.sessionOffscreenTranscriptRendering),
    ).toBe("true");
  });

  it("defaults active-window trimming on and persists an explicit opt-out", () => {
    render(<PerformanceSettings />);

    const toggle = screen.getByRole("checkbox", {
      name: "performanceActiveWindowTrimTitle",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    expect(toggle.checked).toBe(false);
    expect(
      window.localStorage.getItem(UI_KEYS.sessionActiveWindowTrim),
    ).toBe("false");
  });

  it("includes active-window trimming in the pane undo baseline", () => {
    render(<PerformanceSettings />);
    const initialCall = undoMocks.useSettingsUndoBaseline.mock.calls[0];
    const initialState = initialCall?.[0];
    expect(initialState?.sessionActiveWindowTrimEnabled).toBe(true);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "performanceActiveWindowTrimTitle",
      }),
    );
    expect(
      window.localStorage.getItem(UI_KEYS.sessionActiveWindowTrim),
    ).toBe("false");

    const latestCall = undoMocks.useSettingsUndoBaseline.mock.calls.at(-1);
    const restore = latestCall?.[1];
    act(() => {
      restore?.(initialState);
    });

    expect(
      window.localStorage.getItem(UI_KEYS.sessionActiveWindowTrim),
    ).toBe("true");
    expect(
      (
        screen.getByRole("checkbox", {
          name: "performanceActiveWindowTrimTitle",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
});
