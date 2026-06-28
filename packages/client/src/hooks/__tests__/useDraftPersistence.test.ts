// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asClientSummarySourceKey } from "../../lib/clientSummaryStore";
import { useDraftPersistence } from "../useDraftPersistence";

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      key: vi.fn((index: number) => [...store.keys()][index] ?? null),
      get length() {
        return store.size;
      },
    },
  });
  return store;
}

describe("useDraftPersistence", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = installLocalStorageMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    store.clear();
  });

  it("persists each draft edit immediately", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("still typing");
    });

    expect(window.localStorage.getItem("draft-test")).toBe("still typing");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(window.localStorage.getItem("draft-test")).toBe("still typing");
  });

  it("keeps the explicit flush control harmless for blur handlers", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("blur save");
    });

    expect(window.localStorage.getItem("draft-test")).toBe("blur save");

    act(() => {
      result.current[2].flushDraft();
    });

    expect(window.localStorage.getItem("draft-test")).toBe("blur save");
  });

  it("updates source draft indexes for session drafts", () => {
    const sourceKey = asClientSummarySourceKey("host:macbook");
    const { result } = renderHook(() =>
      useDraftPersistence("draft-message:host%3Amacbook:session-a", {
        sessionDraft: { sourceKey, sessionId: "session-a" },
      }),
    );

    act(() => {
      result.current[1]("indexed draft");
    });

    expect(
      window.localStorage.getItem("draft-message:host%3Amacbook:session-a"),
    ).toBe("indexed draft");
    expect(window.localStorage.getItem("draft-index-message:host%3Amacbook")).toBe(
      '["session-a"]',
    );

    act(() => {
      result.current[2].clearDraft();
    });

    expect(
      window.localStorage.getItem("draft-message:host%3Amacbook:session-a"),
    ).toBe(null);
    expect(window.localStorage.getItem("draft-index-message:host%3Amacbook")).toBe(
      null,
    );
  });
});
