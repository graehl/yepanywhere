// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setsEqual, useNewSessionDraft } from "../useDrafts";

beforeEach(() => {
  const store = new Map<string, string>();
  const localStorageMock = {
    get length() {
      return store.size;
    },
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("setsEqual", () => {
  it("returns prev when both sets are empty", () => {
    const prev = new Set<string>();
    const next = new Set<string>();
    expect(setsEqual(prev, next)).toBe(prev);
  });

  it("returns prev when contents are identical", () => {
    const prev = new Set(["a", "b", "c"]);
    const next = new Set(["a", "b", "c"]);
    expect(setsEqual(prev, next)).toBe(prev);
  });

  it("returns next when an element is added", () => {
    const prev = new Set(["a", "b"]);
    const next = new Set(["a", "b", "c"]);
    expect(setsEqual(prev, next)).toBe(next);
  });

  it("returns next when an element is removed", () => {
    const prev = new Set(["a", "b", "c"]);
    const next = new Set(["a", "b"]);
    expect(setsEqual(prev, next)).toBe(next);
  });

  it("returns next when an element is swapped (same size, different content)", () => {
    const prev = new Set(["a", "b"]);
    const next = new Set(["a", "c"]);
    expect(setsEqual(prev, next)).toBe(next);
  });

  it("returns next when going from empty to non-empty", () => {
    const prev = new Set<string>();
    const next = new Set(["a"]);
    expect(setsEqual(prev, next)).toBe(next);
  });

  it("returns next when going from non-empty to empty", () => {
    const prev = new Set(["a"]);
    const next = new Set<string>();
    expect(setsEqual(prev, next)).toBe(next);
  });

  it("returns prev for single identical element", () => {
    const prev = new Set(["x"]);
    const next = new Set(["x"]);
    expect(setsEqual(prev, next)).toBe(prev);
  });

  it("returns next when completely disjoint sets of same size", () => {
    const prev = new Set(["a", "b", "c"]);
    const next = new Set(["x", "y", "z"]);
    expect(setsEqual(prev, next)).toBe(next);
  });
});

describe("useNewSessionDraft", () => {
  it("detects the shared new-session draft key", () => {
    localStorage.setItem("draft-new-session", "draft the migration plan");

    const { result } = renderHook(() => useNewSessionDraft());

    expect(result.current).toBe(true);
  });

  it("still detects legacy project-scoped new-session draft keys", () => {
    localStorage.setItem("draft-new-session-project-1", "draft the fix");

    const { result } = renderHook(() => useNewSessionDraft("project-1"));

    expect(result.current).toBe(true);
  });
});
