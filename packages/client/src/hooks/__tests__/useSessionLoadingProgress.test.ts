// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  getSessionLoadingProgressEnabled,
  useSessionLoadingProgress,
} from "../useSessionLoadingProgress";

describe("useSessionLoadingProgress", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("defaults to enabled", () => {
    const { result } = renderHook(() => useSessionLoadingProgress());

    expect(result.current.sessionLoadingProgressEnabled).toBe(true);
    expect(getSessionLoadingProgressEnabled()).toBe(true);
  });

  it("reads a stored disabled preference", () => {
    localStorage.setItem(UI_KEYS.sessionLoadingProgress, "false");

    const { result } = renderHook(() => useSessionLoadingProgress());

    expect(result.current.sessionLoadingProgressEnabled).toBe(false);
    expect(getSessionLoadingProgressEnabled()).toBe(false);
  });

  it("persists and publishes updates", () => {
    const { result: first } = renderHook(() => useSessionLoadingProgress());
    const { result: second } = renderHook(() => useSessionLoadingProgress());

    act(() => {
      first.current.setSessionLoadingProgressEnabled(false);
    });

    expect(first.current.sessionLoadingProgressEnabled).toBe(false);
    expect(second.current.sessionLoadingProgressEnabled).toBe(false);
    expect(localStorage.getItem(UI_KEYS.sessionLoadingProgress)).toBe("false");
  });
});
