import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_LOCAL_KEYS } from "../../lib/storageKeys";
import { resolvePreferredProjectId } from "../useRecentProject";

describe("resolvePreferredProjectId", () => {
  const projects = [{ id: "jstorrent" }, { id: "webvam" }];

  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
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
      },
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("prefers the valid recent project from browser-local localStorage", () => {
    localStorage.setItem(BROWSER_LOCAL_KEYS.recentProject, "webvam");

    expect(resolvePreferredProjectId(projects, "jstorrent")).toBe("webvam");
  });

  it("falls back to the caller-provided project when the recent project is stale", () => {
    localStorage.setItem(BROWSER_LOCAL_KEYS.recentProject, "missing-project");

    expect(resolvePreferredProjectId(projects, "jstorrent")).toBe("jstorrent");
  });

  it("falls back to the first available project when nothing else matches", () => {
    expect(resolvePreferredProjectId(projects, "missing-project")).toBe(
      "jstorrent",
    );
  });

  it("returns null when no projects are available", () => {
    expect(resolvePreferredProjectId([], "jstorrent")).toBeNull();
  });
});
