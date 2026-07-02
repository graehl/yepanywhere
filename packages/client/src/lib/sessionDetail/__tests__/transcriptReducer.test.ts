import { describe, expect, it } from "vitest";
import type { PaginationInfo } from "../../../api/client";
import type { Message, SessionMetadata } from "../../../types";
import type { SessionRouteSnapshot } from "../../sessionRouteSnapshots";
import {
  createInitialSessionDetailState,
  reduceSessionDetailActions,
  reduceSessionDetailState,
} from "../transcriptReducer";

function sessionMetadata(provider = "claude"): SessionMetadata {
  return {
    id: "session-1",
    projectId: "project-1",
    provider,
    title: "Session 1",
    updatedAt: "2026-07-01T12:00:00.000Z",
    createdAt: "2026-07-01T12:00:00.000Z",
    messageCount: 0,
    ownership: { owner: "none" },
  } as SessionMetadata;
}

function pagination(overrides: Partial<PaginationInfo> = {}): PaginationInfo {
  return {
    hasOlderMessages: false,
    totalMessageCount: 2,
    returnedMessageCount: 2,
    totalCompactions: 0,
    ...overrides,
  };
}

function userMessage(
  uuid: string,
  content: string,
  timestamp: string,
): Message {
  return {
    type: "user",
    uuid,
    timestamp,
    message: { role: "user", content },
  };
}

function assistantMessage(
  uuid: string,
  content: string,
  timestamp: string,
): Message {
  return {
    type: "assistant",
    uuid,
    timestamp,
    message: { role: "assistant", content },
  };
}

function durableRecapMessage(uuid: string, timestamp: string): Message {
  return {
    type: "assistant",
    uuid,
    timestamp,
    yaRecapSource: "provider",
    message: {
      role: "assistant",
      content: "Session recap",
    },
  };
}

function comparableMessages(messages: readonly Message[]) {
  return messages.map((message) => ({
    uuid: message.uuid,
    type: message.type,
    content: message.message?.content,
  }));
}

describe("transcriptReducer", () => {
  it("restores retained route snapshots without retagging message provenance", () => {
    const snapshot: SessionRouteSnapshot = {
      messages: [
        {
          ...userMessage("sdk-user-1", "cached", "2026-07-01T12:00:00.000Z"),
          _source: "sdk",
        },
        {
          ...assistantMessage(
            "jsonl-assistant-1",
            "persisted",
            "2026-07-01T12:00:01.000Z",
          ),
          _source: "jsonl",
        },
      ],
      session: sessionMetadata(),
      agentContent: {},
      toolUseToAgentEntries: [],
      lastMessageId: "jsonl-assistant-1",
      maxPersistedTimestampMs: Date.parse("2026-07-01T12:00:01.000Z"),
    };
    const state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "restoreRouteSnapshot",
      snapshot,
    });

    expect(state.messages.map((message) => message._source)).toEqual([
      "sdk",
      "jsonl",
    ]);
    expect(state.lastMessageId).toBe("jsonl-assistant-1");
    expect(state.maxPersistedTimestampMs).toBe(
      Date.parse("2026-07-01T12:00:01.000Z"),
    );
  });

  it("loads persisted transcript messages as canonical JSONL rows", () => {
    const messages = [
      userMessage("user-1", "hello", "2026-07-01T12:00:00.000Z"),
      assistantMessage("assistant-1", "hi", "2026-07-01T12:00:01.000Z"),
    ];
    const state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session: sessionMetadata(),
      messages,
      pagination: pagination(),
    });

    expect(state.messages.map((message) => message._source)).toEqual([
      "jsonl",
      "jsonl",
    ]);
    expect(state.lastMessageId).toBe("assistant-1");
    expect(state.maxPersistedTimestampMs).toBe(
      Date.parse("2026-07-01T12:00:01.000Z"),
    );
    expect(state.pagination?.totalMessageCount).toBe(2);
  });

  it("gives equivalent message shape for persisted and streamed basic turns", () => {
    const messages = [
      userMessage("user-1", "hello", "2026-07-01T12:00:00.000Z"),
      assistantMessage("assistant-1", "hi", "2026-07-01T12:00:01.000Z"),
    ];
    const persistedState = reduceSessionDetailState(
      createInitialSessionDetailState(),
      {
        type: "loadPersistedTranscript",
        session: sessionMetadata(),
        messages,
      },
    );
    const streamedState = reduceSessionDetailActions(
      messages.map((message) => ({
        type: "applyStreamMessage" as const,
        message,
      })),
      {
        ...createInitialSessionDetailState(),
        session: sessionMetadata(),
      },
    );

    expect(comparableMessages(streamedState.messages)).toEqual(
      comparableMessages(persistedState.messages),
    );
  });

  it("merges catch-up persisted rows over streamed rows with the same ids", () => {
    const streamedMessages = [
      userMessage("user-1", "hello", "2026-07-01T12:00:00.000Z"),
      assistantMessage("assistant-1", "hi", "2026-07-01T12:00:01.000Z"),
    ];
    const state = reduceSessionDetailActions(
      [
        ...streamedMessages.map((message) => ({
          type: "applyStreamMessage" as const,
          message,
        })),
        {
          type: "applyCatchupMessages" as const,
          messages: streamedMessages,
          pagination: pagination(),
        },
      ],
      {
        ...createInitialSessionDetailState(),
        session: sessionMetadata(),
      },
    );

    expect(state.messages).toHaveLength(2);
    expect(state.messages.map((message) => message._source)).toEqual([
      "jsonl",
      "jsonl",
    ]);
    expect(state.lastMessageId).toBe("assistant-1");
  });

  it("dedupes replayed duplicate user prompts from persisted catch-up", () => {
    const state = reduceSessionDetailActions(
      [
        {
          type: "applyStreamMessage",
          message: userMessage(
            "sdk-user-1",
            "start the task",
            "2026-07-01T12:00:00.000Z",
          ),
        },
        {
          type: "applyCatchupMessages",
          messages: [
            userMessage(
              "jsonl-user-1",
              "start the task",
              "2026-07-01T12:00:01.000Z",
            ),
          ],
        },
      ],
      {
        ...createInitialSessionDetailState(),
        session: sessionMetadata("codex"),
      },
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?._source).toBe("jsonl");
    expect(state.messages[0]?.uuid).toBe("jsonl-user-1");
  });

  it("replaces duplicate assistant stream rows with durable rows", () => {
    const state = reduceSessionDetailActions(
      [
        {
          type: "applyStreamMessage",
          message: assistantMessage(
            "sdk-assistant-1",
            "The task is complete.",
            "2026-07-01T12:00:00.000Z",
          ),
        },
        {
          type: "applyCatchupMessages",
          messages: [
            assistantMessage(
              "jsonl-assistant-1",
              "The task is complete.",
              "2026-07-01T12:00:00.900Z",
            ),
          ],
        },
      ],
      {
        ...createInitialSessionDetailState(),
        session: sessionMetadata("codex"),
      },
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?._source).toBe("jsonl");
    expect(state.messages[0]?.uuid).toBe("jsonl-assistant-1");
  });

  it("drops transient streaming placeholders when streaming is disabled", () => {
    const streamingMessage: Message = {
      ...assistantMessage(
        "assistant-streaming",
        "partial",
        "2026-07-01T12:00:00.000Z",
      ),
      _isStreaming: true,
    };
    const state = reduceSessionDetailActions(
      [
        {
          type: "applyStreamMessage",
          message: streamingMessage,
        },
        {
          type: "applyStreamMessage",
          message: streamingMessage,
          streamingEnabled: false,
        },
      ],
      {
        ...createInitialSessionDetailState(),
        session: sessionMetadata(),
      },
    );

    expect(state.messages).toEqual([]);
  });

  it("keeps distinct same-text user turns", () => {
    const state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session: sessionMetadata("codex"),
      messages: [
        userMessage("user-1", "again", "2026-07-01T12:00:00.000Z"),
        assistantMessage("assistant-1", "ok", "2026-07-01T12:00:01.000Z"),
        userMessage("user-2", "again", "2026-07-01T12:00:10.000Z"),
      ],
    });

    expect(
      state.messages.filter((message) => message.type === "user"),
    ).toHaveLength(2);
  });

  it("suppresses replay events already covered by persisted rows", () => {
    const persisted = userMessage(
      "jsonl-user-1",
      "already loaded",
      "2026-07-01T12:00:00.000Z",
    );
    const state = reduceSessionDetailActions([
      {
        type: "loadPersistedTranscript",
        session: sessionMetadata("codex"),
        messages: [persisted],
      },
      {
        type: "applyStreamMessage",
        message: {
          ...userMessage(
            "sdk-user-1",
            "already loaded",
            "2026-07-01T12:00:00.000Z",
          ),
          isReplay: true,
        },
      },
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.uuid).toBe("jsonl-user-1");
  });

  it("skips durable recap overlays when computing persisted cursors", () => {
    const state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session: sessionMetadata(),
      messages: [
        userMessage("user-1", "before recap", "2026-07-01T12:00:00.000Z"),
        assistantMessage(
          "assistant-1",
          "before recap reply",
          "2026-07-01T12:00:01.000Z",
        ),
        durableRecapMessage("recap-1", "2026-07-01T12:05:00.000Z"),
      ],
    });

    expect(state.lastMessageId).toBe("assistant-1");
    expect(state.maxPersistedTimestampMs).toBe(
      Date.parse("2026-07-01T12:00:01.000Z"),
    );
  });

  it("prepends older persisted messages and updates pagination", () => {
    const initial = reduceSessionDetailState(
      createInitialSessionDetailState(),
      {
        type: "loadPersistedTranscript",
        session: sessionMetadata(),
        messages: [
          userMessage("user-2", "current", "2026-07-01T12:10:00.000Z"),
          assistantMessage(
            "assistant-2",
            "current reply",
            "2026-07-01T12:10:01.000Z",
          ),
        ],
        pagination: pagination({
          hasOlderMessages: true,
          truncatedBeforeMessageId: "user-2",
          totalMessageCount: 4,
        }),
      },
    );
    const state = reduceSessionDetailState(initial, {
      type: "prependOlderMessages",
      messages: [
        userMessage("user-1", "older", "2026-07-01T12:00:00.000Z"),
        assistantMessage(
          "assistant-1",
          "older reply",
          "2026-07-01T12:00:01.000Z",
        ),
      ],
      pagination: pagination({
        hasOlderMessages: false,
        totalMessageCount: 4,
        returnedMessageCount: 4,
      }),
    });

    expect(state.messages.map((message) => message.uuid)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2",
    ]);
    expect(state.messages.every((message) => message._source === "jsonl")).toBe(
      true,
    );
    expect(state.pagination?.hasOlderMessages).toBe(false);
    expect(state.lastMessageId).toBe("assistant-2");
  });

  it("preserves subagent content as broad provenance shape", () => {
    const agentMessage = assistantMessage(
      "agent-assistant-1",
      "Subagent summary",
      "2026-07-01T12:00:02.000Z",
    );
    const state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session: sessionMetadata(),
      messages: [
        userMessage("user-1", "delegate", "2026-07-01T12:00:00.000Z"),
      ],
      agentContent: {
        "agent-a": {
          messages: [agentMessage],
          status: "completed",
          contextUsage: {
            inputTokens: 1234,
            percentage: 12,
          },
        },
      },
      toolUseToAgentEntries: [["toolu_1", "agent-a"]],
    });

    expect(state.agentContent["agent-a"]).toEqual({
      messages: [agentMessage],
      status: "completed",
      contextUsage: {
        inputTokens: 1234,
        percentage: 12,
      },
    });
    expect(state.toolUseToAgentEntries).toEqual([["toolu_1", "agent-a"]]);
  });

  it("applies subagent stream messages and tool mappings as thin state", () => {
    const first = assistantMessage(
      "agent-assistant-1",
      "running",
      "2026-07-01T12:00:02.000Z",
    );
    const duplicate = assistantMessage(
      "agent-assistant-1",
      "running duplicate",
      "2026-07-01T12:00:03.000Z",
    );
    const state = reduceSessionDetailActions([
      {
        type: "registerToolUseAgent",
        toolUseId: "toolu_1",
        agentId: "agent-a",
      },
      {
        type: "registerToolUseAgent",
        toolUseId: "toolu_1",
        agentId: "agent-b",
      },
      {
        type: "applyStreamSubagentMessage",
        agentId: "agent-a",
        message: first,
      },
      {
        type: "applyStreamSubagentMessage",
        agentId: "agent-a",
        message: duplicate,
      },
    ]);

    expect(state.toolUseToAgentEntries).toEqual([["toolu_1", "agent-a"]]);
    expect(state.agentContent["agent-a"]?.messages).toEqual([first]);
    expect(state.agentContent["agent-a"]?.status).toBe("running");
  });

  it("merges loaded agent content without duplicating live messages", () => {
    const liveMessage = assistantMessage(
      "agent-assistant-1",
      "live",
      "2026-07-01T12:00:02.000Z",
    );
    const loadedMessage = assistantMessage(
      "agent-assistant-2",
      "loaded",
      "2026-07-01T12:00:03.000Z",
    );
    const state = reduceSessionDetailActions([
      {
        type: "applyStreamSubagentMessage",
        agentId: "agent-a",
        message: liveMessage,
      },
      {
        type: "mergeLoadedAgentContent",
        agentId: "agent-a",
        content: {
          messages: [liveMessage, loadedMessage],
          status: "completed",
        },
      },
    ]);

    expect(state.agentContent["agent-a"]?.messages).toEqual([
      liveMessage,
      loadedMessage,
    ]);
    expect(state.agentContent["agent-a"]?.status).toBe("completed");
  });

  it("drops transient subagent streaming placeholders when streaming is disabled", () => {
    const streamingMessage: Message = {
      ...assistantMessage(
        "agent-streaming",
        "partial",
        "2026-07-01T12:00:02.000Z",
      ),
      _isStreaming: true,
    };
    const state = reduceSessionDetailActions([
      {
        type: "applyStreamSubagentMessage",
        agentId: "agent-a",
        message: streamingMessage,
      },
      {
        type: "applyStreamSubagentMessage",
        agentId: "agent-a",
        message: streamingMessage,
        streamingEnabled: false,
      },
    ]);

    expect(state.agentContent).toEqual({});
  });

  it("keeps retained scroll snapshots patchable outside message changes", () => {
    const initialSnapshot = {
      atBottom: false,
      scrollTop: 240,
      scrollHeight: 1000,
      clientHeight: 600,
      anchor: {
        id: "assistant-1",
        topOffset: 42,
      },
      updatedAtMs: 1782910000000,
    };
    const patchedSnapshot = {
      ...initialSnapshot,
      atBottom: true,
      scrollTop: 400,
      updatedAtMs: 1782910001000,
    };
    const loaded = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session: sessionMetadata(),
      messages: [
        assistantMessage(
          "assistant-1",
          "loaded",
          "2026-07-01T12:00:00.000Z",
        ),
      ],
      scrollSnapshot: initialSnapshot,
    });
    const patched = reduceSessionDetailState(loaded, {
      type: "patchScrollSnapshot",
      scrollSnapshot: patchedSnapshot,
    });

    expect(patched.messages).toBe(loaded.messages);
    expect(patched.scrollSnapshot).toEqual(patchedSnapshot);
  });
});
