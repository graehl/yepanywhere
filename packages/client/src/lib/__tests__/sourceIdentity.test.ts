import { describe, expect, it } from "vitest";
import type { SavedHost } from "../hostStorage";
import {
  resolveSourceKeyForDirectUrl,
  resolveSourceKeyForSavedHost,
} from "../sourceIdentity";

const CREATED_AT = "2026-07-03T00:00:00.000Z";

function host(overrides: Partial<SavedHost> & { id: string }): SavedHost {
  return {
    displayName: overrides.id,
    mode: "relay",
    relayUrl: "wss://relay.example/ws",
    relayUsername: overrides.id,
    srpUsername: overrides.id,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("resolveSourceKeyForSavedHost", () => {
  it("uses the route-scoped saved host id without a server instance id", () => {
    expect(resolveSourceKeyForSavedHost(host({ id: "host-a" }))).toBe(
      "host:host-a",
    );
  });

  it("prefers the server instance id when present", () => {
    expect(
      resolveSourceKeyForSavedHost(
        host({ id: "host-a", serverInstanceId: "srv-1" }),
      ),
    ).toBe("server:srv-1");
  });

  it("gives direct and relay records for one server the same identity", () => {
    const relay = host({ id: "host-relay", serverInstanceId: "srv-1" });
    const direct = host({
      id: "host-direct",
      mode: "direct",
      wsUrl: "ws://127.0.0.1:3400/api/ws",
      serverInstanceId: "srv-1",
    });
    expect(resolveSourceKeyForSavedHost(relay)).toBe(
      resolveSourceKeyForSavedHost(direct),
    );
  });
});

describe("resolveSourceKeyForDirectUrl", () => {
  it("normalizes the URL and strips fragments", () => {
    expect(
      resolveSourceKeyForDirectUrl(" ws://127.0.0.1:3400/api/ws#frag "),
    ).toBe("direct:ws://127.0.0.1:3400/api/ws");
  });

  it("falls back to the trimmed string for unparseable input", () => {
    expect(resolveSourceKeyForDirectUrl(" not-a-url ")).toBe(
      "direct:not-a-url",
    );
  });
});
