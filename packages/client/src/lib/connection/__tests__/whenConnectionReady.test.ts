import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_READY_TIMEOUT_MS,
  type Connection,
  isRemoteMode,
  setGlobalConnection,
  whenConnectionReady,
} from "../index";

const fakeConnection = (id = "conn"): Connection =>
  ({ id }) as unknown as Connection;

afterEach(() => {
  vi.useRealTimers();
  // Reset the module singleton between tests. No waiters should be left
  // pending by a well-behaved test, so this is just a clean slate.
  setGlobalConnection(null);
});

describe("whenConnectionReady", () => {
  it("exposes a positive default timeout", () => {
    expect(CONNECTION_READY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("resolves immediately when a connection is already set", async () => {
    const conn = fakeConnection("ready");
    setGlobalConnection(conn);

    expect(isRemoteMode()).toBe(true);
    await expect(whenConnectionReady()).resolves.toBe(conn);
  });

  it("resolves pending waiters once a connection becomes available", async () => {
    const pending = whenConnectionReady();
    const conn = fakeConnection("late");
    setGlobalConnection(conn);

    await expect(pending).resolves.toBe(conn);
  });

  it("rejects pending waiters when the connection is torn down", async () => {
    const pending = whenConnectionReady();
    setGlobalConnection(null);

    await expect(pending).rejects.toThrow(/closed before it became ready/);
  });

  it("rejects after the timeout when no connection arrives", async () => {
    vi.useFakeTimers();
    const pending = whenConnectionReady(1000);
    const assertion = expect(pending).rejects.toThrow(/Timed out after 1000ms/);

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("clears the timeout once a waiter resolves (no late rejection)", async () => {
    vi.useFakeTimers();
    const pending = whenConnectionReady(1000);
    const conn = fakeConnection("quick");
    setGlobalConnection(conn);

    await expect(pending).resolves.toBe(conn);
    // Advancing past the timeout must not produce a late rejection.
    await vi.advanceTimersByTimeAsync(2000);
  });

  it("supports waiting again after a teardown (reconnect)", async () => {
    const first = whenConnectionReady();
    setGlobalConnection(null);
    await expect(first).rejects.toThrow();

    const second = whenConnectionReady();
    const conn = fakeConnection("reconnected");
    setGlobalConnection(conn);
    await expect(second).resolves.toBe(conn);
  });
});
