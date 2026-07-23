import { describe, expect, it } from "vitest";
import { PiProvider } from "../../../src/sdk/providers/pi.js";

describe("PiProvider event mapping", () => {
  it("waits for agent_settled before completing a YA turn", () => {
    const provider = new PiProvider();
    const stream = {
      currentAssistantId: null,
      text: "",
      thinking: "",
      lastUsage: null,
      lastCostUsd: null,
      toolStates: new Map(),
    };
    const mapEvent = (event: { type: string; [key: string]: unknown }) =>
      provider["mapEvent"](event, "pi-session", stream);

    expect(
      mapEvent({
        type: "turn_end",
        message: {
          usage: {
            input: 11,
            output: 7,
            cacheRead: 5,
            cacheWrite: 3,
            cost: { total: 0.012 },
          },
        },
      }),
    ).toEqual([]);

    expect(
      mapEvent({
        type: "agent_end",
        messages: [],
        willRetry: false,
      }),
    ).toEqual([]);

    expect(mapEvent({ type: "agent_settled" })).toEqual([
      {
        type: "result",
        session_id: "pi-session",
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 3,
        },
        total_cost_usd: 0.012,
      },
    ]);
  });
});
