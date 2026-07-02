import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import type { Message } from "../../../types";
import type { RenderItem } from "../../../types/renderItems";
import {
  buildAssistantRenderSegments,
  buildSessionDetailRenderItems,
  buildVisibleTimelineEntries,
  getAllTurnSearchAnchors,
  getFullSessionSearchAnchors,
  getNextProgressiveEntryCount,
  getProgressiveTimelineEntryWeight,
  getSearchMatchProjection,
  getSearchSelectionProjection,
  getSearchVisibleTurnGroups,
  getTailEntryCountForRenderItemTarget,
  getUserTurnNavAnchors,
  getUserTurnSearchAnchors,
  groupRenderItemsIntoTurns,
  selectSessionDetailRenderItems,
  selectLatestCorrectablePrompt,
  type ProgressiveTimelineEntry,
  type RenderTurnGroup,
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

function sourceMessage(id: string, timestamp: string): Message {
  return {
    type: "assistant",
    uuid: id,
    timestamp,
    message: { role: "assistant", content: "" },
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

  it("derives full-session anchors for explored assistant segments", () => {
    const read: RenderItem = {
      type: "tool_call",
      id: "read-1",
      toolName: "Read",
      toolInput: { file_path: "README.md" },
      status: "pending",
      sourceMessages: [
        sourceMessage("read-msg", "2026-07-02T12:01:00.000Z"),
      ],
    };
    const grep: RenderItem = {
      type: "tool_call",
      id: "grep-1",
      toolName: "Grep",
      toolInput: { pattern: "needle", path: "src" },
      status: "pending",
      sourceMessages: [
        sourceMessage("grep-msg", "2026-07-02T12:02:00.000Z"),
      ],
    };
    const thinking: RenderItem = {
      type: "thinking",
      id: "thinking-1",
      thinking: "Checking the answer",
      status: "complete",
      sourceMessages: [
        sourceMessage("thinking-msg", "2026-07-02T12:03:00.000Z"),
      ],
    };
    const assistantItems = [read, grep, thinking];

    expect(
      buildAssistantRenderSegments(assistantItems).map((segment) =>
        segment.kind === "explored"
          ? { kind: segment.kind, id: segment.id }
          : { kind: segment.kind, id: segment.item.id },
      ),
    ).toEqual([
      { kind: "explored", id: "explored-read-1-grep-1" },
      { kind: "item", id: "thinking-1" },
    ]);

    const anchors = getFullSessionSearchAnchors([
      {
        isUserPrompt: true,
        items: [
          {
            type: "user_prompt",
            id: "user-1",
            content: "Find usage",
            sourceMessages: [
              sourceMessage("user-msg", "2026-07-02T12:00:00.000Z"),
            ],
          },
        ],
      },
      { isUserPrompt: false, items: assistantItems },
    ]);

    expect(
      anchors.map((anchor) => ({
        id: anchor.id,
        preview: anchor.preview,
        targetId: anchor.targetId,
      })),
    ).toEqual([
      { id: "user-1", preview: "Find usage", targetId: undefined },
      {
        id: "explored-read-1-grep-1",
        preview: "Explored: 2 items",
        targetId: undefined,
      },
      {
        id: "explored-read-1-grep-1:read-1",
        preview: "Explored / Read: README.md",
        targetId: "explored-read-1-grep-1",
      },
      {
        id: "explored-read-1-grep-1:grep-1",
        preview: "Explored / Grep: needle in src",
        targetId: "explored-read-1-grep-1",
      },
      {
        id: "thinking-1",
        preview: "Thinking: Checking the answer",
        targetId: undefined,
      },
    ]);
    expect(
      anchors.find((anchor) => anchor.id === "explored-read-1-grep-1")
        ?.timestampMs,
    ).toBe(Date.parse("2026-07-02T12:02:00.000Z"));
  });

  it("filters visible turn groups for search matches", () => {
    const user1: RenderItem = {
      type: "user_prompt",
      id: "user-1",
      content: "First prompt",
      sourceMessages: [sourceMessage("user-msg-1", "2026-07-02T12:00:00Z")],
    };
    const assistant1: RenderItem = {
      type: "text",
      id: "assistant-1",
      text: "First answer",
      sourceMessages: [
        sourceMessage("assistant-msg-1", "2026-07-02T12:01:00Z"),
      ],
    };
    const user2: RenderItem = {
      type: "user_prompt",
      id: "user-2",
      content: "Second prompt",
      sourceMessages: [sourceMessage("user-msg-2", "2026-07-02T12:02:00Z")],
    };
    const read: RenderItem = {
      type: "tool_call",
      id: "read-1",
      toolName: "Read",
      toolInput: { file_path: "README.md" },
      status: "pending",
      sourceMessages: [sourceMessage("read-msg", "2026-07-02T12:03:00Z")],
    };
    const grep: RenderItem = {
      type: "tool_call",
      id: "grep-1",
      toolName: "Grep",
      toolInput: { pattern: "needle" },
      status: "pending",
      sourceMessages: [sourceMessage("grep-msg", "2026-07-02T12:04:00Z")],
    };
    const groups: RenderTurnGroup[] = [
      { isUserPrompt: true, items: [user1] },
      { isUserPrompt: false, items: [assistant1] },
      { isUserPrompt: true, items: [user2] },
      { isUserPrompt: false, items: [read, grep] },
    ];
    const groupIds = (visibleGroups: readonly RenderTurnGroup[]) =>
      visibleGroups.map((group) => group.items[0]?.id);

    expect(
      getSearchVisibleTurnGroups({
        matchIds: new Set(),
        scope: "user",
        searchReady: true,
        turnGroups: groups,
      }),
    ).toBe(groups);

    expect(
      groupIds(
        getSearchVisibleTurnGroups({
          matchIds: new Set(["user-1"]),
          scope: "user",
          searchReady: true,
          turnGroups: groups,
        }),
      ),
    ).toEqual(["user-1", "assistant-1"]);

    expect(
      groupIds(
        getSearchVisibleTurnGroups({
          matchIds: new Set(["assistant-1"]),
          scope: "all",
          searchReady: true,
          turnGroups: groups,
        }),
      ),
    ).toEqual(["assistant-1"]);

    expect(
      groupIds(
        getSearchVisibleTurnGroups({
          matchIds: new Set(["explored-read-1-grep-1:read-1"]),
          matchTargetIds: new Set(["explored-read-1-grep-1"]),
          scope: "full",
          searchReady: true,
          turnGroups: groups,
        }),
      ),
    ).toEqual(["read-1"]);
  });

  it("builds visible timeline entries from turns and btw asides", () => {
    const user: RenderItem = {
      type: "user_prompt",
      id: "user-1",
      content: "Prompt",
      sourceMessages: [sourceMessage("user-msg", "2026-07-02T12:01:00Z")],
    };
    const assistantWithoutTimestamp: RenderItem = {
      type: "text",
      id: "assistant-1",
      text: "No timestamp yet",
      sourceMessages: [],
    };
    const groups: RenderTurnGroup[] = [
      { isUserPrompt: true, items: [user] },
      { isUserPrompt: false, items: [assistantWithoutTimestamp] },
    ];
    const asides = [
      {
        id: "aside-early",
        updatedAt: "2026-07-02T12:00:00Z",
      },
      {
        id: "aside-history",
        historyAt: "2026-07-02T12:02:00Z",
        updatedAt: "2026-07-02T13:00:00Z",
      },
    ];

    const entries = buildVisibleTimelineEntries({
      asides,
      turnGroups: groups,
    });

    expect(
      entries.map((entry) =>
        entry.kind === "turn"
          ? {
              kind: entry.kind,
              key: entry.key,
              ordinal: entry.ordinal,
              timestampMs: entry.timestampMs,
              firstItemId: entry.group.items[0]?.id,
            }
          : {
              kind: entry.kind,
              key: entry.key,
              ordinal: entry.ordinal,
              timestampMs: entry.timestampMs,
              asideId: entry.aside.id,
            },
      ),
    ).toEqual([
      {
        kind: "btw",
        key: "btw-aside-early",
        ordinal: 2,
        timestampMs: Date.parse("2026-07-02T12:00:00Z"),
        asideId: "aside-early",
      },
      {
        kind: "turn",
        key: "turn-user-1",
        ordinal: 0,
        timestampMs: Date.parse("2026-07-02T12:01:00Z"),
        firstItemId: "user-1",
      },
      {
        kind: "btw",
        key: "btw-aside-history",
        ordinal: 3,
        timestampMs: Date.parse("2026-07-02T12:02:00Z"),
        asideId: "aside-history",
      },
      {
        kind: "turn",
        key: "turn-assistant-1",
        ordinal: 1,
        timestampMs: null,
        firstItemId: "assistant-1",
      },
    ]);
  });

  it("derives progressive timeline entry weights and tail counts", () => {
    const entries: ProgressiveTimelineEntry[] = [
      {
        kind: "turn" as const,
        group: { items: Array.from({ length: 30 }) },
      },
      {
        kind: "turn" as const,
        group: { items: Array.from({ length: 45 }) },
      },
      {
        kind: "turn" as const,
        group: { items: [] },
      },
      { kind: "btw" as const },
      {
        kind: "turn" as const,
        group: { items: Array.from({ length: 80 }) },
      },
      { kind: "btw" as const },
    ];

    expect(getProgressiveTimelineEntryWeight(entries[0]!)).toBe(30);
    expect(getProgressiveTimelineEntryWeight(entries[2]!)).toBe(1);
    expect(getProgressiveTimelineEntryWeight(entries[3]!)).toBe(1);
    expect(getTailEntryCountForRenderItemTarget([], 120)).toBe(0);
    expect(getTailEntryCountForRenderItemTarget(entries, 1)).toBe(1);
    expect(getTailEntryCountForRenderItemTarget(entries, 90)).toBe(5);
  });

  it("derives the next progressive timeline entry count", () => {
    const entries: ProgressiveTimelineEntry[] = [
      {
        kind: "turn" as const,
        group: { items: Array.from({ length: 30 }) },
      },
      {
        kind: "turn" as const,
        group: { items: Array.from({ length: 40 }) },
      },
      {
        kind: "turn" as const,
        group: { items: Array.from({ length: 50 }) },
      },
      { kind: "btw" as const },
    ];

    expect(getNextProgressiveEntryCount([], 1, 90)).toBe(0);
    expect(getNextProgressiveEntryCount(entries, 1, 60)).toBe(3);
    expect(getNextProgressiveEntryCount(entries, entries.length, 60)).toBe(
      entries.length,
    );
    expect(getNextProgressiveEntryCount(entries, -1, 0)).toBe(1);
  });

  it("projects search matches, ids, selected anchor, and previews", () => {
    const anchors = [
      {
        id: "anchor-1",
        preview: "Alpha prompt",
        searchText: "Alpha prompt with repeated alpha term",
      },
      {
        id: "anchor-2",
        preview: "Explored / Read: README.md",
        searchText: "Read README.md",
        targetId: "explored-read-1-grep-1",
      },
      {
        id: "anchor-3",
        preview: "Beta prompt",
        searchText: "Beta only",
      },
    ];

    const projection = getSearchMatchProjection({
      anchors,
      query: "readme",
      searchReady: true,
    });
    const selection = getSearchSelectionProjection({
      anchors,
      previewsById: projection.previewsById,
      searchReady: true,
      selectedId: "anchor-2",
    });

    expect(projection.matches.map((anchor) => anchor.id)).toEqual([
      "anchor-2",
    ]);
    expect(Array.from(projection.matchIds)).toEqual(["anchor-2"]);
    expect(Array.from(projection.matchTargetIds)).toEqual([
      "explored-read-1-grep-1",
    ]);
    expect(selection.selectedAnchor?.id).toBe("anchor-2");
    expect(selection.selectedTargetId).toBe("explored-read-1-grep-1");
    expect(selection.selectedPreview).toBe("Read README.md");
    expect(projection.previewsById.get("anchor-2")).toBe("Read README.md");
  });

  it("preserves selected active anchors even when they are not matches", () => {
    const anchors = [
      {
        id: "anchor-1",
        preview: "Alpha prompt",
        searchText: "Alpha prompt",
      },
      {
        id: "anchor-2",
        preview: "Beta prompt",
        searchText: "Beta prompt",
      },
    ];

    const projection = getSearchMatchProjection({
      anchors,
      caseSensitive: true,
      query: "alpha",
      searchReady: true,
    });
    const selection = getSearchSelectionProjection({
      anchors,
      previewsById: projection.previewsById,
      searchReady: true,
      selectedId: "anchor-2",
    });

    expect(projection.matches).toEqual([]);
    expect(selection.selectedAnchor?.id).toBe("anchor-2");
    expect(selection.selectedTargetId).toBe("anchor-2");
    expect(selection.selectedPreview).toBeNull();
    expect(projection.previewsById.size).toBe(0);
  });

  it("returns empty search projection when search is not ready", () => {
    const anchors = [
      {
        id: "anchor-1",
        preview: "Alpha prompt",
        searchText: "Alpha prompt",
      },
    ];

    const projection = getSearchMatchProjection({
      anchors,
      query: "alpha",
      searchReady: false,
    });
    const selection = getSearchSelectionProjection({
      anchors,
      previewsById: projection.previewsById,
      searchReady: false,
      selectedId: "anchor-1",
    });

    expect(projection.matches).toEqual([]);
    expect(projection.matchIds.size).toBe(0);
    expect(projection.matchTargetIds.size).toBe(0);
    expect(projection.previewsById.size).toBe(0);
    expect(selection.selectedAnchor).toBeNull();
    expect(selection.selectedTargetId).toBeNull();
    expect(selection.selectedPreview).toBeNull();
  });

  it("selects latest correctable user prompt", () => {
    const items: RenderItem[] = [
      {
        type: "user_prompt",
        id: "user-1",
        content: "Original prompt",
        sourceMessages: [],
      },
      {
        type: "text",
        id: "assistant-1",
        text: "answer",
        sourceMessages: [],
      },
      {
        type: "user_prompt",
        id: "subagent-user-1",
        content: "Subagent prompt",
        isSubagent: true,
        sourceMessages: [],
      },
      {
        type: "user_prompt",
        id: "setup",
        content: "# AGENTS.md instructions\nRead CLAUDE.md",
        sourceMessages: [],
      },
      {
        type: "user_prompt",
        id: "user-2",
        content: [
          { type: "text", text: "Correct this prompt" },
          { type: "thinking", thinking: "not user text" },
        ],
        sourceMessages: [],
      },
    ];

    expect(selectLatestCorrectablePrompt(items)).toEqual({
      id: "user-2",
      content: "Correct this prompt",
    });
  });

  it("returns null when no prompt can be corrected", () => {
    expect(
      selectLatestCorrectablePrompt([
        {
          type: "user_prompt",
          id: "setup",
          content: "<environment_context>\n cwd",
          sourceMessages: [],
        },
        {
          type: "user_prompt",
          id: "subagent-user-1",
          content: "Subagent prompt",
          isSubagent: true,
          sourceMessages: [],
        },
      ]),
    ).toBeNull();
  });
});
