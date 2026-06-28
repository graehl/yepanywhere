// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asClientSummarySourceKey } from "../../lib/clientSummaryStore";
import { useDraftPersistence } from "../useDraftPersistence";

function readStoredText(key: string): string | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  return (JSON.parse(raw) as { text?: string }).text ?? null;
}

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

    expect(readStoredText("draft-test")).toBe("still typing");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(readStoredText("draft-test")).toBe("still typing");
  });

  it("keeps the explicit flush control harmless for blur handlers", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("blur save");
    });

    expect(readStoredText("draft-test")).toBe("blur save");

    act(() => {
      result.current[2].flushDraft();
    });

    expect(readStoredText("draft-test")).toBe("blur save");
  });

  it("reads legacy raw-string drafts and rewrites them as envelopes", () => {
    store.set("draft-test", "legacy draft");

    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    expect(result.current[0]).toBe("legacy draft");

    act(() => {
      result.current[1]("updated draft");
    });

    expect(readStoredText("draft-test")).toBe("updated draft");
  });

  it("ignores malformed envelope values without crashing", () => {
    store.set("draft-test", '{"version":1,');

    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    expect(result.current[0]).toBe("");

    act(() => {
      result.current[1]("recovered");
    });

    expect(readStoredText("draft-test")).toBe("recovered");
  });

  it("removes empty text-only envelopes", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("temporary draft");
    });
    act(() => {
      result.current[1]("");
    });

    expect(window.localStorage.getItem("draft-test")).toBe(null);
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
    ).not.toBe(null);
    expect(
      readStoredText("draft-message:host%3Amacbook:session-a"),
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
