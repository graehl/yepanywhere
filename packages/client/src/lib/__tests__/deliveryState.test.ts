import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
  getUserPromptDeliveryState,
  hasUnconfirmedSelfSends,
  isUnconfirmedSelfSend,
} from "../deliveryState";

function sdkEcho(overrides: Partial<Message> = {}): Message {
  return {
    type: "user",
    uuid: "ya-queue-uuid",
    tempId: "temp-1",
    timestamp: "2026-07-03T10:00:00.000Z",
    _source: "sdk",
    message: { role: "user", content: "hello" },
    ...overrides,
  } as Message;
}

describe("deliveryState", () => {
  it("marks an sdk-source self-send echo as unconfirmed", () => {
    expect(isUnconfirmedSelfSend(sdkEcho())).toBe(true);
    expect(getUserPromptDeliveryState([sdkEcho()])).toBe("sent");
  });

  it("confirms once the durable copy merges in", () => {
    const merged = sdkEcho({ _source: "jsonl" });
    expect(isUnconfirmedSelfSend(merged)).toBe(false);
    expect(getUserPromptDeliveryState([merged])).toBe("confirmed");
  });

  it("does not mark provider stream echoes without YA identifiers", () => {
    const providerEcho = sdkEcho({ tempId: undefined });
    expect(isUnconfirmedSelfSend(providerEcho)).toBe(false);
    expect(getUserPromptDeliveryState([providerEcho])).toBe("confirmed");
  });

  it("treats messageMetadata as a self-send marker too", () => {
    const metadataEcho = sdkEcho({
      tempId: undefined,
      messageMetadata: { deliveryIntent: "steer" },
    } as Partial<Message>);
    expect(isUnconfirmedSelfSend(metadataEcho)).toBe(true);
  });

  it("hasUnconfirmedSelfSends scans the tail", () => {
    expect(hasUnconfirmedSelfSends([])).toBe(false);
    expect(hasUnconfirmedSelfSends([sdkEcho({ _source: "jsonl" })])).toBe(
      false,
    );
    expect(
      hasUnconfirmedSelfSends([sdkEcho({ _source: "jsonl" }), sdkEcho()]),
    ).toBe(true);
  });
});
