import { DEFAULT_RELAY_URL } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { resolveDefaultRelayUrl } from "../defaultRelayUrl";

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
