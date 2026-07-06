import { describe, expect, it } from "vitest";
import { parseCodexConfigAck } from "../sessionCodexConfigAck";

describe("parseCodexConfigAck", () => {
  it("extracts model and thinking effort from Codex config acks", () => {
    expect(
      parseCodexConfigAck({
        type: "system",
        subtype: "config_ack",
        configModel: " gpt-5.4 ",
        configThinking: " effort high ",
      }),
    ).toEqual({
      model: "gpt-5.4",
      thinking: { type: "enabled" },
      effort: "high",
    });
  });

  it("maps effort none to disabled thinking", () => {
    expect(
      parseCodexConfigAck({
        type: "system",
        subtype: "config_ack",
        configThinking: "effort none",
      }),
    ).toEqual({
      thinking: { type: "disabled" },
      effort: "none",
    });
  });

  it("ignores non-ack and empty ack messages", () => {
    expect(parseCodexConfigAck({ type: "assistant" })).toBeNull();
    expect(
      parseCodexConfigAck({
        type: "system",
        subtype: "config_ack",
        configModel: "   ",
      }),
    ).toBeNull();
  });
});
