// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../SettingsUndoContext", () => ({
  useSettingsUndoBaseline: vi.fn(),
}));

describe("PerformanceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
