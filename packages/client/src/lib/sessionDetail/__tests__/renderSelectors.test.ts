import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import type { Message } from "../../../types";
import type { RenderItem } from "../../../types/renderItems";
import {
  buildSessionDetailRenderItems,
  getAllTurnSearchAnchors,
  getUserTurnNavAnchors,
  getUserTurnSearchAnchors,
  groupRenderItemsIntoTurns,
  selectSessionDetailRenderItems,
} from "../renderSelectors";
import { createInitialSessionDetailState } from "../transcriptReducer";

function displayObject(
  id: string,
  placementAfterMessageId: string,
): TranscriptDisplayObject {
  return {
    id,
    kind: "fork-summary",
    createdAt: "2026-06-23T00:00:00.000Z",
    placementAfterMessageId,
    sourceMessageId: "user-1",
    retainedThroughMessageId: "assistant-1",
    status: "generating",
  };
}

describe("session detail render selectors", () => {
  it("builds and stabilizes render items from transcript inputs", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        type: "user",
        message: { role: "user", content: "hello" },
      },
      {
        id: "assistant-1",
        type: "assistant",
        message: { role: "assistant", content: "hi" },
      },
    ];
    const transcriptDisplayObjects = [displayObject("display-1", "user-1")];

    const first = buildSessionDetailRenderItems({
      messages,
      transcriptDisplayObjects,
    });
    const second = buildSessionDetailRenderItems({
      messages,
      transcriptDisplayObjects,
      previousRenderItems: first,
    });

    expect(first.map((item) => `${item.type}:${item.id}`)).toEqual([
      "user_prompt:user-1",
      "transcript_display_object:display-1",
      "text:assistant-1",
    ]);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
  });

  it("selects render items from session detail state with markdown augments", () => {
    const messages: Message[] = [
      {
        id: "assistant-1",
        type: "assistant",
        message: { role: "assistant", content: "hi" },
      },
    ];
    const state = {
      ...createInitialSessionDetailState(),
      messages,
      markdownAugments: {
        "assistant-1": { html: "<p>hi</p>" },
      },
    };

    const items = selectSessionDetailRenderItems(state);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "text",
      id: "assistant-1",
      augmentHtml: "<p>hi</p>",
    });
  });

  it("groups render items into user, assistant, and standalone turns", () => {
    const [user, display, text] = buildSessionDetailRenderItems({
      messages: [
        {
          id: "user-1",
          type: "user",
          message: { role: "user", content: "hello" },
        },
        {
          id: "assistant-1",
          type: "assistant",
          message: { role: "assistant", content: "hi" },
        },
      ],
      transcriptDisplayObjects: [displayObject("display-1", "user-1")],
    });

    const groups = groupRenderItemsIntoTurns(
      [user, display, text].filter((item): item is NonNullable<typeof item> =>
        Boolean(item),
      ),
    );

    expect(
      groups.map((group) => ({
        isUserPrompt: group.isUserPrompt,
        isStandalone: group.isStandalone ?? false,
        ids: group.items.map((item) => item.id),
      })),
    ).toEqual([
      { isUserPrompt: true, isStandalone: false, ids: ["user-1"] },
      { isUserPrompt: false, isStandalone: true, ids: ["display-1"] },
      { isUserPrompt: false, isStandalone: false, ids: ["assistant-1"] },
    ]);
  });

  it("derives user navigation anchors from searchable user turns", () => {
    const sourceMessages: Message[] = [
      {
        id: "user-1",
        type: "user",
        timestamp: "2026-07-02T12:00:00.000Z",
        message: { role: "user", content: "Build the parser" },
      },
    ];
    const items: RenderItem[] = [
      {
        type: "user_prompt",
        id: "setup",
        content: "# AGENTS.md instructions\nRead CLAUDE.md",
        sourceMessages: [],
      },
      {
        type: "user_prompt",
        id: "user-1",
        content: "Build the parser",
        sourceMessages,
      },
      {
        type: "user_prompt",
        id: "subagent-user-1",
        content: "Subagent note",
        isSubagent: true,
        sourceMessages: [],
      },
    ];

    expect(getUserTurnNavAnchors(items)).toEqual([
      {
        id: "user-1",
        preview: "Build the parser",
        timestampMs: Date.parse("2026-07-02T12:00:00.000Z"),
      },
    ]);
  });

  it("derives user and all-turn search anchors from render items", () => {
    const userMessage: Message = {
      id: "user-1",
      type: "user",
      timestamp: "2026-07-02T12:00:00.000Z",
      message: { role: "user", content: "Find the duplicate prompt" },
    };
    const assistantMessage: Message = {
      id: "assistant-1",
      type: "assistant",
      timestamp: "2026-07-02T12:01:00.000Z",
      message: { role: "assistant", content: "The answer is stable" },
    };
    const items: RenderItem[] = [
      {
        type: "user_prompt",
        id: "user-1",
        content: "Find the duplicate prompt",
        sourceMessages: [userMessage],
      },
      {
        type: "user_prompt",
        id: "setup",
        content: "<environment_context>\ncwd",
        sourceMessages: [],
      },
      {
        type: "text",
        id: "assistant-1",
        text: "The answer is stable",
        sourceMessages: [assistantMessage],
      },
      {
        type: "system",
        id: "system-1",
        subtype: "compact_boundary",
        content: "Compacted transcript",
        details: ["retained tail"],
        sourceMessages: [],
      },
    ];

    expect(getUserTurnSearchAnchors(items)).toEqual([
      {
        id: "user-1",
        preview: "Find the duplicate prompt",
        searchText: "Find the duplicate prompt",
        timestampMs: Date.parse("2026-07-02T12:00:00.000Z"),
      },
    ]);

    expect(
      getAllTurnSearchAnchors(items).map((anchor) => ({
        id: anchor.id,
        preview: anchor.preview,
        searchText: anchor.searchText,
      })),
    ).toEqual([
      {
        id: "user-1",
        preview: "Find the duplicate prompt",
        searchText: "Find the duplicate prompt",
      },
      {
        id: "assistant-1",
        preview: "The answer is stable",
        searchText: "The answer is stable",
      },
      {
        id: "system-1",
        preview: "Compacted transcript retained tail",
        searchText: "Compacted transcript\nretained tail",
      },
    ]);
  });
});
