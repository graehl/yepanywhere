import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import type { RenderItem } from "../../types/renderItems";
import { stabilizeRenderItems } from "../stableRenderItems";

describe("stabilizeRenderItems", () => {
  it("reuses unchanged render item objects when preprocessing rebuilds arrays", () => {
    const firstMessage: Message = {
      id: "msg-1",
      type: "assistant",
      message: { role: "assistant", content: "first" },
    };
    const secondMessage: Message = {
      id: "msg-2",
      type: "assistant",
      message: { role: "assistant", content: "second" },
    };

    const previousFirst: RenderItem = {
      type: "text",
      id: "msg-1",
      text: "first",
      sourceMessages: [firstMessage],
    };
    const previousSecond: RenderItem = {
      type: "text",
      id: "msg-2",
      text: "second",
      sourceMessages: [secondMessage],
    };
    const rebuiltFirst: RenderItem = {
      type: "text",
      id: "msg-1",
      text: "first",
      sourceMessages: [firstMessage],
    };
    const updatedSecond: RenderItem = {
      type: "text",
      id: "msg-2",
      text: "second update",
      sourceMessages: [{ ...secondMessage }],
    };

    const stable = stabilizeRenderItems(
      [previousFirst, previousSecond],
      [rebuiltFirst, updatedSecond],
    );

    expect(stable[0]).toBe(previousFirst);
    expect(stable[1]).toBe(updatedSecond);
  });

  it("reuses an unchanged transcript display object", () => {
    const object = {
      id: "display-1",
      kind: "fork-summary" as const,
      createdAt: "2026-06-23T00:00:00.000Z",
      placementAfterMessageId: "assistant-1",
      sourceMessageId: "user-1",
      retainedThroughMessageId: "assistant-1",
      status: "generating" as const,
    };
    const previous: RenderItem = {
      type: "transcript_display_object",
      id: object.id,
      object,
      sourceMessages: [],
    };
    const next: RenderItem = { ...previous };

    expect(stabilizeRenderItems([previous], [next])[0]).toBe(previous);
  });
});
