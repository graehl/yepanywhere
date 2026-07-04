import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalStorageBoolean,
  createLocalStorageValue,
} from "../localStorageValue";

const MODES = ["block", "paragraph-hover", "paragraph-always"] as const;
type Mode = (typeof MODES)[number];

function parseMode(raw: string): Mode | undefined {
  return (MODES as readonly string[]).includes(raw)
    ? (raw as Mode)
    : undefined;
}

function createModeStore(key = "test-mode-key") {
  return createLocalStorageValue<Mode>(key, "paragraph-hover", parseMode);
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createLocalStorageValue", () => {
  it("reads the default when the key is absent", () => {
    expect(createModeStore().read()).toBe("paragraph-hover");
  });

  it("reads the default when parse rejects the stored value", () => {
    localStorage.setItem("test-mode-key", "garbage");
    expect(createModeStore().read()).toBe("paragraph-hover");
  });

  it("reads the default when storage access throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(createModeStore().read()).toBe("paragraph-hover");
  });

  it("persists on set and notifies subscribers", () => {
    const store = createModeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("block");

    expect(localStorage.getItem("test-mode-key")).toBe("block");
    expect(store.read()).toBe("block");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still notifies subscribers when persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const store = createModeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("block");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is read-through: writes that bypass set are visible on next read", () => {
    const store = createModeStore();
    localStorage.setItem("test-mode-key", "paragraph-always");
    expect(store.read()).toBe("paragraph-always");
  });

  it("relays cross-tab storage events for its key", () => {
    const store = createModeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "test-mode-key", newValue: "block" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "unrelated-key", newValue: "x" }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("shares one window storage listener and detaches at zero subscribers", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const store = createModeStore();

    const unsubscribeA = store.subscribe(() => {});
    const unsubscribeB = store.subscribe(() => {});
    const storageAdds = addSpy.mock.calls.filter(
      (call) => call[0] === "storage",
    );
    expect(storageAdds).toHaveLength(1);

    unsubscribeA();
    expect(
      removeSpy.mock.calls.filter((call) => call[0] === "storage"),
    ).toHaveLength(0);

    unsubscribeB();
    expect(
      removeSpy.mock.calls.filter((call) => call[0] === "storage"),
    ).toHaveLength(1);
  });
});

describe("createLocalStorageBoolean", () => {
  it("reads the default only when the key is absent", () => {
    const store = createLocalStorageBoolean("test-bool-key", true);
    expect(store.read()).toBe(true);
  });

  it("reads any present non-'true' value as false, not as the default", () => {
    localStorage.setItem("test-bool-key", "garbage");
    const store = createLocalStorageBoolean("test-bool-key", true);
    expect(store.read()).toBe(false);
  });

  it("round-trips true/false through set", () => {
    const store = createLocalStorageBoolean("test-bool-key", false);
    store.set(true);
    expect(localStorage.getItem("test-bool-key")).toBe("true");
    expect(store.read()).toBe(true);
    store.set(false);
    expect(store.read()).toBe(false);
  });
});
