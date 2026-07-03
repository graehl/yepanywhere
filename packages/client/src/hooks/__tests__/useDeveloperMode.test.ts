// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  __resetDeveloperModeForTest,
  getSessionDetailStoreMessagesEnabled,
  useDeveloperMode,
} from "../useDeveloperMode";

describe("useDeveloperMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetDeveloperModeForTest();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    __resetDeveloperModeForTest();
  });

  it("defaults store-backed session messages to enabled", () => {
    const { result } = renderHook(() => useDeveloperMode());

    expect(result.current.sessionDetailStoreMessagesEnabled).toBe(true);
    expect(getSessionDetailStoreMessagesEnabled()).toBe(true);
  });

  it("persists and publishes store-backed session message updates", () => {
    const { result: first } = renderHook(() => useDeveloperMode());
    const { result: second } = renderHook(() => useDeveloperMode());

    act(() => {
      first.current.setSessionDetailStoreMessagesEnabled(false);
    });

    expect(first.current.sessionDetailStoreMessagesEnabled).toBe(false);
    expect(second.current.sessionDetailStoreMessagesEnabled).toBe(false);
    expect(getSessionDetailStoreMessagesEnabled()).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(UI_KEYS.developerMode) ?? "{}"),
    ).toMatchObject({
      sessionDetailStoreMessagesEnabled: false,
    });
  });
});
