import { describe, expect, it } from "vitest";
import type { Message } from "../../../types";
import {
  codexAttachmentOpeningTurnFixture,
  codexRepeatedToolCallsFixture,
  codexReplayCatchupDuplicatePromptFixture,
} from "../__fixtures__/codexFixtures";
import {
  createInitialSessionDetailState,
  reduceSessionDetailActions,
  reduceSessionDetailState,
} from "../transcriptReducer";
import type { SessionDetailAction } from "../types";

function streamMessageActions(
  messages: readonly Message[],
  options: { fromBufferedReplay?: boolean } = {},
): SessionDetailAction[] {
  return messages.map((message) => ({
    type: "applyStreamMessage",
    message,
    ...options,
  }));
}

function compactContent(message: Message): unknown {
  const content = message.message?.content ?? message.content;
  if (!Array.isArray(content)) {
    return content;
  }
  return content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const typedBlock = block as Record<string, unknown>;
    switch (typedBlock.type) {
      case "text":
      case "input_text":
      case "output_text":
        return {
          type: "text",
          text: typedBlock.text,
        };
      case "tool_use":
        return {
          type: "tool_use",
          id: typedBlock.id,
          name: typedBlock.name,
          input: typedBlock.input,
        };
      case "tool_result":
        return {
          type: "tool_result",
          toolUseId: typedBlock.tool_use_id,
          content: typedBlock.content,
        };
      default:
        return typedBlock;
    }
  });
}

function compactTranscript(messages: readonly Message[]) {
  return messages.map((message) => ({
    uuid: message.uuid,
    source: message._source,
    type: message.type,
    role: message.message?.role,
    content: compactContent(message),
  }));
}

describe("transcriptReducer provider fixtures", () => {
  it("converges a Codex stream plus persisted catch-up duplicate prompt fixture", () => {
    const fixture = codexReplayCatchupDuplicatePromptFixture;
    const persistedState = reduceSessionDetailState(
      createInitialSessionDetailState(),
      { type: "loadPersistedTranscript", ...fixture.persisted },
    );
    const streamThenCatchupState = reduceSessionDetailActions(
      [
        ...streamMessageActions(fixture.streamMessages),
        { type: "applyCatchupMessages", ...fixture.persisted },
      ],
      { ...createInitialSessionDetailState(), session: fixture.session },
    );

    expect(compactTranscript(streamThenCatchupState.messages)).toEqual(
      compactTranscript(persistedState.messages),
    );
    expect(
      streamThenCatchupState.messages.every(
        (message) => message._source === "jsonl",
      ),
    ).toBe(true);
  });

  it("suppresses Codex buffered replay after the persisted fixture is loaded", () => {
    const fixture = codexReplayCatchupDuplicatePromptFixture;
    const state = reduceSessionDetailActions([
      { type: "loadPersistedTranscript", ...fixture.persisted },
      ...streamMessageActions(fixture.replayMessages ?? [], {
        fromBufferedReplay: true,
      }),
    ]);

    expect(compactTranscript(state.messages)).toEqual(
      compactTranscript(
        reduceSessionDetailState(createInitialSessionDetailState(), {
          type: "loadPersistedTranscript",
          ...fixture.persisted,
        }).messages,
      ),
    );
  });

  it("merges a Codex attachment opening turn with its durable transcript row", () => {
    const fixture = codexAttachmentOpeningTurnFixture;
    const state = reduceSessionDetailActions(
      [
        ...streamMessageActions(fixture.streamMessages),
        { type: "applyCatchupMessages", ...fixture.persisted },
      ],
      { ...createInitialSessionDetailState(), session: fixture.session },
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?._source).toBe("jsonl");
    expect(state.messages[0]?.uuid).toBe(fixture.persisted.messages[0]?.uuid);
  });

  it("keeps repeated Codex tool calls distinct when their call ids differ", () => {
    const fixture = codexRepeatedToolCallsFixture;
    const state = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      ...fixture.persisted,
    });

    expect(state.messages).toHaveLength(2);
    expect(compactTranscript(state.messages)).toEqual([
      {
        uuid: "response_item_call_019b8510_0001",
        source: "jsonl",
        type: "assistant",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_019b8510_a",
            name: "Bash",
            input: { cmd: "git status --short" },
          },
        ],
      },
      {
        uuid: "response_item_call_019b8510_0002",
        source: "jsonl",
        type: "assistant",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_019b8510_b",
            name: "Bash",
            input: { cmd: "git status --short" },
          },
        ],
      },
    ]);
  });
});
