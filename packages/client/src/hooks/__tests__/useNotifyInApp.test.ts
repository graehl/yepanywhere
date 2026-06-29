// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BROWSER_LOCAL_KEYS } from "../../lib/storageKeys";
import { useNotifyInApp } from "../useNotifyInApp";

describe("useNotifyInApp", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("loads and stores the browser-local notify-in-app key", () => {
    localStorage.setItem(BROWSER_LOCAL_KEYS.notifyInApp, "true");

    const { result } = renderHook(() => useNotifyInApp());

    expect(result.current.notifyInApp).toBe(true);

    act(() => {
      result.current.setNotifyInApp(false);
    });

    expect(result.current.notifyInApp).toBe(false);
    expect(localStorage.getItem(BROWSER_LOCAL_KEYS.notifyInApp)).toBe("false");
  });
});
