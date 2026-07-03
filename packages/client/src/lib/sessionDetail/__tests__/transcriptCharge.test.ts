import { describe, expect, it } from "vitest";
import type { Message } from "../../../types";
import {
  chargeOfObject,
  estimateSessionDetailStateBytes,
  FALLBACK_MESSAGE_CHARGE_BYTES,
} from "../transcriptCharge";
import { createInitialSessionDetailState } from "../transcriptReducer";
import type { SessionDetailState } from "../types";

function message(uuid: string, text: string): Message {
  return {
    uuid,
    type: "assistant",
    timestamp: "2026-07-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  } as Message;
}

function stateWith(messages: Message[]): SessionDetailState {
  return {
    ...createInitialSessionDetailState(),
    messages,
  };
}

describe("transcriptCharge", () => {
  it("charges proportionally to content size", () => {
    const small = chargeOfObject(message("a", "hi"));
    const large = chargeOfObject(message("b", "x".repeat(20_000)));
    expect(large).toBeGreaterThan(small * 10);
  });

  it("memoizes charges by object identity", () => {
    const row = message("a", "hello world");
    expect(chargeOfObject(row)).toBe(chargeOfObject(row));
    // A structurally equal but distinct object is measured independently.
    expect(chargeOfObject(message("a", "hello world"))).toBe(
      chargeOfObject(row),
    );
  });

  it("returns the flat fallback for unmeasured rows when not measuring", () => {
    const row = message("fresh", "y".repeat(50_000));
    expect(chargeOfObject(row, false)).toBe(FALLBACK_MESSAGE_CHARGE_BYTES);
    // Once measured, the cached real charge is returned even when
    // measurement is disabled.
    const measured = chargeOfObject(row);
    expect(chargeOfObject(row, false)).toBe(measured);
  });

  it("charges rows shared across entries once under a seen set", () => {
    const shared = message("shared", "z".repeat(5_000));
    const own = message("own", "w".repeat(5_000));
    const full = stateWith([shared, own]);
    const tail = stateWith([shared]);

    const independent =
      estimateSessionDetailStateBytes(full) +
      estimateSessionDetailStateBytes(tail);

    const seen = new Set<object>();
    const deduped =
      estimateSessionDetailStateBytes(full, { seen }) +
      estimateSessionDetailStateBytes(tail, { seen });

    expect(deduped).toBeLessThan(independent);
    expect(deduped).toBe(estimateSessionDetailStateBytes(full));
  });

  it("counts subagent messages and tool-use mappings", () => {
    const base = stateWith([]);
    const withAgents: SessionDetailState = {
      ...base,
      agentContent: {
        "agent-1": {
          messages: [message("sub-1", "v".repeat(10_000))],
          status: "completed",
        },
      },
      toolUseToAgentEntries: [["tool-1", "agent-1"]],
    };
    expect(estimateSessionDetailStateBytes(withAgents)).toBeGreaterThan(
      estimateSessionDetailStateBytes(base) + 10_000,
    );
  });
});
