import type { DurableLocalCommandMessage } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { mergeLocalCommandMessages } from "../../src/sessions/recap-overlays.js";
import type { Message } from "../../src/supervisor/types.js";

function goal(
  id: string,
  second: number,
  anchor?: string,
): DurableLocalCommandMessage {
  return {
    id,
    uuid: id,
    type: "system",
    subtype: "local_command",
    content: "/goal",
    details: ["Finish the work", "Goal set"],
    session_id: "session-1",
    isSynthetic: true,
    timestamp: `2026-09-05T00:00:${String(second).padStart(2, "0")}.000Z`,
    ...(anchor ? { placementAfterMessageId: anchor } : {}),
  };
}
function provider(id: string, second: number): Message {
  return {
    id,
    uuid: id,
    type: "assistant",
    timestamp: goal(id, second).timestamp,
    message: { role: "assistant", content: "Work" },
  };
}
const ids = (messages: Message[]) => messages.map((message) => message.id);

describe("durable goal receipts", () => {
  it("keeps an in-turn receipt after the assistant even when its final timestamp is later", () => {
    const commands = [
      goal("set", 10, "assistant"),
      goal("clear", 11, "assistant"),
    ];
    const result = mergeLocalCommandMessages(
      [provider("assistant", 20), provider("next", 30)],
      commands,
    );
    expect(ids(result)).toEqual(["assistant", "set", "clear", "next"]);
    expect(mergeLocalCommandMessages(result, commands)).toEqual(result);
  });
  it("keeps old receipts out of a tail or incremental window", () => {
    const result = mergeLocalCommandMessages(
      [provider("tail", 20)],
      [goal("old", 10), goal("new", 21)],
      { hasOlderMessages: true },
    );
    expect(ids(result)).toEqual(["tail", "new"]);
  });
  it("includes receipts in older pages without leaking newer receipts", () => {
    const result = mergeLocalCommandMessages(
      [provider("first", 10), provider("last", 20)],
      [goal("old", 5), goal("inside", 15), goal("new", 25)],
      { hasOlderMessages: true, hasNewerMessages: true },
    );
    expect(ids(result)).toEqual(["first", "inside", "last"]);
  });
  it("shows a receipt with no provider history, but does not widen an empty bounded window", () => {
    expect(ids(mergeLocalCommandMessages([], [goal("set", 1)]))).toEqual([
      "set",
    ]);
    expect(
      mergeLocalCommandMessages([], [goal("set", 1)], {
        hasOlderMessages: true,
      }),
    ).toEqual([]);
  });
});
