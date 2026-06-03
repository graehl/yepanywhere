import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TOOLBAR_VISIBILITY,
  useSessionToolbarVisibility,
} from "../useSessionToolbarVisibility";

describe("useSessionToolbarVisibility", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("keeps the model indicator hidden by default and after reset", () => {
    expect(DEFAULT_SESSION_TOOLBAR_VISIBILITY.modelIndicator).toBe(false);

    const { result } = renderHook(() => useSessionToolbarVisibility());

    expect(result.current.visibility.modelIndicator).toBe(false);

    act(() => result.current.setControlVisible("modelIndicator", true));
    expect(result.current.visibility.modelIndicator).toBe(true);

    act(() => result.current.resetVisibility());
    expect(result.current.visibility.modelIndicator).toBe(false);
  });
});
