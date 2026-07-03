import { describe, expect, it } from "vitest";
import type { Message } from "../../../types";
import {
  bufferSessionDetailStreamMessage,
  bufferSessionDetailStreamSubagentMessage,
  createSessionDetailStreamBuffer,
  drainSessionDetailStreamBuffer,
  resetSessionDetailStreamBuffer,
} from "../streamBuffer";

function message(uuid: string): Message {
  return {
    uuid,
    type: "assistant",
    timestamp: "2026-07-03T00:00:00.000Z",
    message: { role: "assistant", content: uuid },
  };
}

describe("session detail stream buffer", () => {
  it("buffers main and subagent events in insertion order", () => {
    const buffer = createSessionDetailStreamBuffer();

    bufferSessionDetailStreamMessage(buffer, message("main-1"));
    bufferSessionDetailStreamSubagentMessage(
      buffer,
      message("subagent-1"),
      "agent-1",
    );

    expect(drainSessionDetailStreamBuffer(buffer)).toEqual([
      { type: "message", message: message("main-1") },
      { type: "subagent", message: message("subagent-1"), agentId: "agent-1" },
    ]);
  });

  it("clears the buffer after draining", () => {
    const buffer = createSessionDetailStreamBuffer();

    bufferSessionDetailStreamMessage(buffer, message("main-1"));
    const drained = drainSessionDetailStreamBuffer(buffer);
    bufferSessionDetailStreamMessage(buffer, message("main-2"));

    expect(drained).toEqual([{ type: "message", message: message("main-1") }]);
    expect(drainSessionDetailStreamBuffer(buffer)).toEqual([
      { type: "message", message: message("main-2") },
    ]);
  });

  it("resets queued events without draining them", () => {
    const buffer = createSessionDetailStreamBuffer();

    bufferSessionDetailStreamSubagentMessage(
      buffer,
      message("subagent-1"),
      "agent-1",
    );
    resetSessionDetailStreamBuffer(buffer);

    expect(drainSessionDetailStreamBuffer(buffer)).toEqual([]);
  });
});
