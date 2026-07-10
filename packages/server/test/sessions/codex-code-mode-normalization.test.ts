import type { CodexSessionEntry } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { normalizeSession } from "../../src/sessions/normalization.js";
import type { LoadedSession } from "../../src/sessions/types.js";

function buildLoadedSession(entries: CodexSessionEntry[]): LoadedSession {
  return {
    summary: {
      id: "code-mode-test",
      projectId: "test-project",
      title: "Code mode",
      fullTitle: "Code mode",
      createdAt: "2026-07-10T00:00:00Z",
      updatedAt: "2026-07-10T00:00:02Z",
      messageCount: entries.length,
      status: "chat",
      provider: "codex",
      // biome-ignore lint/suspicious/noExplicitAny: minimal normalization fixture
    } as any,
    data: {
      provider: "codex",
      events: [],
      session: { entries },
      // biome-ignore lint/suspicious/noExplicitAny: minimal normalization fixture
    } as any,
  };
}

function contentBlock(
  message: ReturnType<typeof normalizeSession>["messages"][number],
) {
  const content = message.message?.content;
  return Array.isArray(content) ? content[0] : content;
}

describe("Codex code-mode persisted normalization", () => {
  it("maps a literal exec_command read and unwraps text output blocks", () => {
    const entries: CodexSessionEntry[] = [
      {
        type: "response_item",
        timestamp: "2026-07-10T00:00:01Z",
        payload: {
          type: "custom_tool_call",
          call_id: "call-read",
          name: "exec",
          input:
            'const r = await tools.exec_command({"cmd":"sed -n \'1,20p\' CLAUDE.md","workdir":"/repo"}); text(r.output);',
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-10T00:00:02Z",
        payload: {
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
    ];

    const result = normalizeSession(buildLoadedSession(entries));
    expect(contentBlock(result.messages[0])).toMatchObject({
      type: "tool_use",
      name: "Read",
      input: { file_path: "CLAUDE.md" },
    });
    expect(contentBlock(result.messages[1])).toMatchObject({
      type: "tool_result",
      content: "# Yep Anywhere\n",
    });
    expect(result.messages[1]?.toolUseResult).toMatchObject({
      file: { content: "# Yep Anywhere\n" },
    });
  });

  it("maps apply_patch and attaches its adjacent structured change event", () => {
    const patch =
      "*** Begin Patch\n*** Update File: /repo/demo.txt\n@@\n-old\n+new\n*** End Patch";
    const entries: CodexSessionEntry[] = [
      {
        type: "response_item",
        timestamp: "2026-07-10T00:00:01Z",
        payload: {
          type: "custom_tool_call",
          call_id: "outer-call",
          name: "exec",
          input: `const patch = ${JSON.stringify(patch)}; text(await tools.apply_patch(patch));`,
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-10T00:00:01.500Z",
        payload: {
          type: "patch_apply_end",
          call_id: "exec-provider-call",
          turn_id: "turn-1",
          stdout: "Done!",
          stderr: "",
          success: true,
          status: "completed",
          changes: {
            "/repo/demo.txt": {
              type: "update",
              unified_diff: "@@ -1 +1 @@\n-old\n+new",
            },
          },
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-10T00:00:02Z",
        payload: {
          type: "custom_tool_call_output",
          call_id: "outer-call",
          output: [
            { type: "input_text", text: "Script completed\nOutput:\n{}" },
          ],
        },
      },
    ];

    const result = normalizeSession(buildLoadedSession(entries));
    expect(contentBlock(result.messages[0])).toMatchObject({
      type: "tool_use",
      name: "Edit",
      input: {
        _rawPatch: patch,
        changes: [
          {
            path: "/repo/demo.txt",
            type: "update",
            unified_diff: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
    });
    expect(contentBlock(result.messages[1])).toMatchObject({
      type: "tool_result",
      content: "Done!",
    });
  });

  it("keeps multiple nested calls as an explicit group", () => {
    const entries: CodexSessionEntry[] = [
      {
        type: "response_item",
        timestamp: "2026-07-10T00:00:01Z",
        payload: {
          type: "custom_tool_call",
          call_id: "call-group",
          name: "exec",
          input:
            'const r = await Promise.all([tools.exec_command({"cmd":"pnpm lint"}), tools.exec_command({"cmd":"pnpm typecheck"})]); text(r.length);',
        },
      },
    ];

    const result = normalizeSession(buildLoadedSession(entries));
    expect(contentBlock(result.messages[0])).toMatchObject({
      type: "tool_use",
      name: "Exec",
      input: {
        calls: [
          { toolName: "exec_command", input: { cmd: "pnpm lint" } },
          { toolName: "exec_command", input: { cmd: "pnpm typecheck" } },
        ],
      },
    });
  });
});
