import { describe, expect, it, vi } from "vitest";

vi.mock("../uuid", () => ({
  generateUUID: vi.fn(() => "uuid-1"),
}));

import {
  createClientSpeechTurnId,
  createSpeechTargetId,
} from "../speechTargets";

describe("speech targets", () => {
  it("creates client speech turn and target ids", () => {
    expect(createClientSpeechTurnId()).toBe("uuid-1");
    expect(createSpeechTargetId()).toBe("speech-target-uuid-1");
  });
});
