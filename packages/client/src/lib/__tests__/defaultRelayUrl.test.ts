import { DEFAULT_RELAY_URL } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  resolveDefaultRelayUrl,
  resolveLoginRelayUrl,
} from "../defaultRelayUrl";

describe("resolveDefaultRelayUrl", () => {
  it("uses the shared public relay when no build override is set", () => {
    expect(resolveDefaultRelayUrl(undefined)).toBe(DEFAULT_RELAY_URL);
    expect(resolveDefaultRelayUrl("")).toBe(DEFAULT_RELAY_URL);
  });

  it("normalizes a build-time hosted relay override", () => {
    expect(resolveDefaultRelayUrl("relay.graehl.org")).toBe(
      "wss://relay.graehl.org/ws",
    );
  });
});

describe("resolveLoginRelayUrl", () => {
  it("uses an explicit input over the saved relay", () => {
    expect(
      resolveLoginRelayUrl("wss://relay.custom.org/ws", "wss://saved.org/ws"),
    ).toBe("wss://relay.custom.org/ws");
  });

  it("normalizes a bare-host input", () => {
    expect(resolveLoginRelayUrl("relay.custom.org", undefined)).toBe(
      "wss://relay.custom.org/ws",
    );
  });

  it("keeps the saved relay when the input is blank", () => {
    expect(resolveLoginRelayUrl("", "wss://saved.org/ws")).toBe(
      "wss://saved.org/ws",
    );
    expect(resolveLoginRelayUrl("   ", "wss://saved.org/ws")).toBe(
      "wss://saved.org/ws",
    );
  });

  it("falls back to the deployment default when nothing else is set", () => {
    expect(resolveLoginRelayUrl("", undefined)).toBe(DEFAULT_RELAY_URL);
  });

  it("rejects an invalid explicit input", () => {
    expect(() =>
      resolveLoginRelayUrl("ftp://relay.custom.org", undefined),
    ).toThrow();
  });
});
