// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  getFlatSettingsIcons,
  useFlatSettingsIcons,
} from "../useFlatSettingsIcons";

describe("useFlatSettingsIcons", () => {
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

  it("defaults to emoji icons", () => {
    const { result } = renderHook(() => useFlatSettingsIcons());

    expect(result.current.flatSettingsIcons).toBe(false);
    expect(getFlatSettingsIcons()).toBe(false);
  });

  it("reads stored flat-icon preference", () => {
    localStorage.setItem(UI_KEYS.flatSettingsIcons, "true");

    const { result } = renderHook(() => useFlatSettingsIcons());

    expect(result.current.flatSettingsIcons).toBe(true);
    expect(getFlatSettingsIcons()).toBe(true);
  });

  it("persists and publishes updates", () => {
    const { result: first } = renderHook(() => useFlatSettingsIcons());
    const { result: second } = renderHook(() => useFlatSettingsIcons());

    act(() => {
      first.current.setFlatSettingsIcons(true);
    });

    expect(first.current.flatSettingsIcons).toBe(true);
    expect(second.current.flatSettingsIcons).toBe(true);
    expect(localStorage.getItem(UI_KEYS.flatSettingsIcons)).toBe("true");
  });
});
