// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n";
import { UI_KEYS } from "../../../lib/storageKeys";
import { AppearanceSettings } from "../AppearanceSettings";

function renderAppearanceSettings() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <AppearanceSettings />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("AppearanceSettings tooltip controls", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("keeps style and delay in one row and valid delay edits select themed", () => {
    const { container } = renderAppearanceSettings();
    const row = container.querySelector(".tooltip-settings-actions");
    expect(row).toBeTruthy();
    expect(row?.querySelector(".tooltip-mode-selector")).toBeTruthy();
    expect(row?.querySelector('input[type="range"]')).toBeTruthy();
    expect(row?.querySelector('input[type="number"]')).toBeTruthy();

    const nativeButton = screen.getByRole("button", { name: "Native" });
    expect(nativeButton.classList.contains("active")).toBe(true);
    fireEvent.click(nativeButton);
    expect(localStorage.getItem(UI_KEYS.tooltipMode)).toBe("native");

    const number = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: "Tooltip Style and Delay",
    });
    fireEvent.change(number, { target: { value: "" } });
    expect(localStorage.getItem(UI_KEYS.tooltipMode)).toBe("native");

    fireEvent.change(number, { target: { value: "80" } });
    expect(localStorage.getItem(UI_KEYS.tooltipMode)).toBe("themed");
    fireEvent.blur(number);
    expect(localStorage.getItem(UI_KEYS.tooltipDelayMs)).toBe("80");
  });
});
