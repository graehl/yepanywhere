// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  getSettingsIconStyle,
  useSettingsIconStyle,
} from "../useSettingsIconStyle";

describe("useSettingsIconStyle", () => {
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

  it("defaults to flat icons", () => {
    const { result } = renderHook(() => useSettingsIconStyle());

    expect(result.current.settingsIconStyle).toBe("flat");
    expect(getSettingsIconStyle()).toBe("flat");
  });

  it("reads stored flat-white icon style", () => {
    localStorage.setItem(UI_KEYS.settingsIconStyle, "flat-white");

    const { result } = renderHook(() => useSettingsIconStyle());

    expect(result.current.settingsIconStyle).toBe("flat-white");
    expect(getSettingsIconStyle()).toBe("flat-white");
  });

  it("reads stored emoji icon style", () => {
    localStorage.setItem(UI_KEYS.settingsIconStyle, "emoji");

    const { result } = renderHook(() => useSettingsIconStyle());

    expect(result.current.settingsIconStyle).toBe("emoji");
    expect(getSettingsIconStyle()).toBe("emoji");
  });

  it("migrates the legacy flat-icon preference", () => {
    localStorage.setItem(UI_KEYS.flatSettingsIcons, "false");

    const { result } = renderHook(() => useSettingsIconStyle());

    expect(result.current.settingsIconStyle).toBe("emoji");
    expect(getSettingsIconStyle()).toBe("emoji");
  });

  it("persists and publishes updates", () => {
    localStorage.setItem(UI_KEYS.flatSettingsIcons, "false");
    const { result: first } = renderHook(() => useSettingsIconStyle());
    const { result: second } = renderHook(() => useSettingsIconStyle());

    act(() => {
      first.current.setSettingsIconStyle("flat-white");
    });

    expect(first.current.settingsIconStyle).toBe("flat-white");
    expect(second.current.settingsIconStyle).toBe("flat-white");
    expect(localStorage.getItem(UI_KEYS.settingsIconStyle)).toBe("flat-white");
    expect(localStorage.getItem(UI_KEYS.flatSettingsIcons)).toBeNull();
  });
});
