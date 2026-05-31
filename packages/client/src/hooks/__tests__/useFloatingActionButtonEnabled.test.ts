// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import { useFloatingActionButtonEnabled } from "../useFloatingActionButtonEnabled";

describe("useFloatingActionButtonEnabled", () => {
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

  it("defaults to disabled", () => {
    const { result } = renderHook(() => useFloatingActionButtonEnabled());

    expect(result.current.floatingActionButtonEnabled).toBe(false);
  });

  it("persists and publishes updates", () => {
    const { result: first } = renderHook(() =>
      useFloatingActionButtonEnabled(),
    );
    const { result: second } = renderHook(() =>
      useFloatingActionButtonEnabled(),
    );

    act(() => {
      first.current.setFloatingActionButtonEnabled(true);
    });

    expect(first.current.floatingActionButtonEnabled).toBe(true);
    expect(second.current.floatingActionButtonEnabled).toBe(true);
    expect(localStorage.getItem(UI_KEYS.floatingActionButtonEnabled)).toBe(
      "true",
    );
  });

  it("reads a stored enabled preference", () => {
    localStorage.setItem(UI_KEYS.floatingActionButtonEnabled, "true");

    const { result } = renderHook(() => useFloatingActionButtonEnabled());

    expect(result.current.floatingActionButtonEnabled).toBe(true);
  });
});
