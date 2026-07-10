import { describe, expect, it } from "vitest";
import { CodexProvider } from "../../../src/sdk/providers/codex.js";

function createLiveEventState() {
  return {
    streamingTextByItemKey: new Map<string, string>(),
    streamingReasoningSummaryByItemKey: new Map<string, string[]>(),
    streamingToolOutputByItemKey: new Map<string, string>(),
    toolCallContexts: new Map<string, unknown>(),
    resultBackedToolItemsByTurnId: new Map<string, Set<string>>(),
  };
}

describe("CodexProvider live code-mode normalization", () => {
  it("matches persisted Read normalization for an exec wrapper", () => {
    const provider = new CodexProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
        liveEventState: ReturnType<typeof createLiveEventState>,
      ) => Array<Record<string, unknown>>;
    };
    const state = createLiveEventState();

    const toolUse = provider.convertNotificationToSDKMessages(
      {
        method: "rawResponseItem/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "custom_tool_call",
            name: "exec",
            call_id: "call-read",
            input:
              'const r = await tools.exec_command({"cmd":"sed -n \'1,20p\' CLAUDE.md","workdir":"/repo"}); text(r.output);',
          },
        },
      },
      "session-1",
      new Map(),
      state,
    );
    const toolResult = provider.convertNotificationToSDKMessages(
      {
        method: "rawResponseItem/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "custom_tool_call_output",
            call_id: "call-read",
            output: [
              {
                type: "input_text",
                text: "Script completed\nWall time 1 second\nOutput:\n",
              },
              { type: "input_text", text: "# Yep Anywhere\n" },
            ],
          },
        },
      },
      "session-1",
      new Map(),
      state,
    );

    expect(toolUse[0]).toMatchObject({
      message: {
        content: [
          {
            type: "tool_use",
            id: "call-read",
            name: "Read",
            input: { file_path: "CLAUDE.md" },
          },
        ],
      },
    });
    expect(toolResult[0]).toMatchObject({
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-read",
            content: "# Yep Anywhere\n",
          },
        ],
      },
      toolUseResult: { file: { content: "# Yep Anywhere\n" } },
    });
  });
});
