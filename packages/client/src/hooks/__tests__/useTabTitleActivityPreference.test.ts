// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  getTabTitleActivityPreference,
  useTabTitleActivityPreference,
} from "../useTabTitleActivityPreference";

describe("useTabTitleActivityPreference", () => {
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

  it("defaults to disabled for the focused session", () => {
    const { result } = renderHook(() => useTabTitleActivityPreference());

    expect(result.current.tabTitleActivityEnabled).toBe(false);
    expect(result.current.tabTitleActivityScope).toBe("focused");
  });

  it("reads stored preferences", () => {
    localStorage.setItem(UI_KEYS.tabTitleActivityEnabled, "true");
    localStorage.setItem(UI_KEYS.tabTitleActivityScope, "all");

    const { result } = renderHook(() => useTabTitleActivityPreference());

    expect(result.current.tabTitleActivityEnabled).toBe(true);
    expect(result.current.tabTitleActivityScope).toBe("all");
  });

  it("falls back to focused scope for invalid stored values", () => {
    localStorage.setItem(UI_KEYS.tabTitleActivityEnabled, "true");
    localStorage.setItem(UI_KEYS.tabTitleActivityScope, "everything");

    expect(getTabTitleActivityPreference()).toEqual({
      enabled: true,
      scope: "focused",
    });
  });

  it("persists and publishes updates to mounted consumers", () => {
    const { result: first } = renderHook(() =>
      useTabTitleActivityPreference(),
    );
    const { result: second } = renderHook(() =>
      useTabTitleActivityPreference(),
    );

    act(() => {
      first.current.setTabTitleActivityEnabled(true);
      first.current.setTabTitleActivityScope("all");
    });

    expect(first.current.tabTitleActivityEnabled).toBe(true);
    expect(first.current.tabTitleActivityScope).toBe("all");
    expect(second.current.tabTitleActivityEnabled).toBe(true);
    expect(second.current.tabTitleActivityScope).toBe("all");
    expect(localStorage.getItem(UI_KEYS.tabTitleActivityEnabled)).toBe("true");
    expect(localStorage.getItem(UI_KEYS.tabTitleActivityScope)).toBe("all");
  });
});
