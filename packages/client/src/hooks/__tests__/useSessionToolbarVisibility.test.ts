import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";

describe("useSessionToolbarVisibility", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.resetModules();
  });

  it("ignores persisted model indicator visibility from old settings", async () => {
    window.localStorage.setItem(
      UI_KEYS.sessionToolbarVisibility,
      JSON.stringify({
        modelIndicator: true,
        slashMenu: false,
      }),
    );
    const { DEFAULT_SESSION_TOOLBAR_VISIBILITY, useSessionToolbarVisibility } =
      await import("../useSessionToolbarVisibility");

    expect(DEFAULT_SESSION_TOOLBAR_VISIBILITY).not.toHaveProperty(
      "modelIndicator",
    );

    const { result } = renderHook(() => useSessionToolbarVisibility());

    expect(result.current.visibility).not.toHaveProperty("modelIndicator");
    expect(result.current.visibility.slashMenu).toBe(false);
  });
});
