import { mkdtemp, writeFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readConversationFile,
  MAX_CONVERSATION_RECORD_BYTES,
  ConversationAcquisition,
} from "../src/experimental/conversation-reader.js";
import {
  MAX_PROJECTION_INPUT_BYTES,
  prepareConversation,
  selectConversation,
  serializeConversationSnapshot,
} from "../src/experimental/conversation-projection.js";
import { loadCapture, replayNative } from "./utils/captured-provider-replay.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function file(text: string) {
  const dir = await mkdtemp(join(tmpdir(), "ya-conversation-reader-"));
  dirs.push(dir);
  const path = join(dir, "session.jsonl");
  await writeFile(path, text);
  return path;
}
const options = {
  provider: "claude" as const,
  sessionId: "session",
  signal: new AbortController().signal,
};

describe("bounded native Conversation acquisition", () => {
  it.each(["claude", "codex"] as const)(
    "%s matches the existing captured native pipeline",
    async (provider) => {
      const capture = await loadCapture(`${provider}-basic-2026-09-12`);
      const path = await file(
        `${capture.native.map((row) => JSON.stringify(row)).join("\n")}\n`,
      );
      const read = await readConversationFile({
        ...options,
        path,
        provider,
        sessionId: capture.manifest.sessionId,
      });
      const existing = await replayNative(capture);
      const snapshot = (messages: typeof read.messages) =>
        serializeConversationSnapshot(
          selectConversation(
            prepareConversation({ ...read, messages }),
            {
              sessionId: read.sessionId,
              maxMessages: 20,
              anchorMessageId: null,
            },
            { subscriptionId: "test", sequence: 0 },
          ),
        );
      expect(snapshot(read.messages)).toEqual(snapshot(existing.messages));
    },
  );
  it("bounds retained tool detail in a large file, reuses warm acquisition and reads only an append", async () => {
    const reader = new ConversationAcquisition();
    const entries: Record<string, unknown>[] = [
      {
        type: "user",
        uuid: "u",
        message: { role: "user", content: "Question" },
      },
    ];
    let parent = "u";
    for (let i = 0; i < 100; i++) {
      const a = `a${i}`;
      const b = `b${i}`;
      entries.push({
        type: "assistant",
        uuid: a,
        parentUuid: parent,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: a,
              name: "Bash",
              input: { command: "echo test" },
            },
          ],
        },
      });
      entries.push({
        type: "user",
        uuid: b,
        parentUuid: a,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: a,
              content: "x".repeat(96 * 1024),
            },
          ],
        },
      });
      parent = b;
    }
    entries.push({
      type: "assistant",
      uuid: "final",
      parentUuid: parent,
      message: { role: "assistant", content: "Exact final answer" },
    });
    const path = await file(
      entries.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const metrics = {
      bytesRead: 0,
      parsedRecords: 0,
      retainedBytes: 0,
      cacheHit: false,
    };
    const first = await reader.read({ ...options, path, metrics });
    expect(metrics.bytesRead).toBeGreaterThan(MAX_PROJECTION_INPUT_BYTES);
    expect(metrics.retainedBytes).toBeLessThan(MAX_PROJECTION_INPUT_BYTES);
    expect(JSON.stringify(first.messages)).toContain("Exact final answer");
    expect(first.sourceCoverage.complete).toBe(true);
    expect(await reader.read({ ...options, path, metrics })).toEqual(first);
    expect(metrics.cacheHit).toBe(true);
    expect(metrics.bytesRead).toBe(0);
    await appendFile(
      path,
      JSON.stringify({
        type: "user",
        uuid: "follow",
        parentUuid: "final",
        message: { role: "user", content: "Follow up" },
      }) + "\n",
    );
    const next = await reader.read({ ...options, path, metrics });
    expect(metrics.bytesRead).toBeLessThan(1024);
    expect(JSON.stringify(next.messages)).toContain("Follow up");
    reader.clear();
  });
  it("rejects an oversized unfinished row and complete malformed rows", async () => {
    await expect(
      readConversationFile({
        ...options,
        path: await file("x".repeat(MAX_CONVERSATION_RECORD_BYTES + 1)),
      }),
    ).rejects.toThrow("record budget");
    await expect(
      readConversationFile({ ...options, path: await file("not-json\n") }),
    ).rejects.toThrow();
  });
  it("reports an unfinished final row without inventing a message", async () => {
    const read = await readConversationFile({
      ...options,
      path: await file(
        '{"type":"user","uuid":"u","message":{"role":"user","content":"Hello"}}\n{"type":',
      ),
    });
    expect(read.sourceCoverage.complete).toBe(false);
    expect(read.messages).toHaveLength(1);
  });
  it("rejects inherited Codex history and mismatched source identity", async () => {
    const capture = await loadCapture("codex-basic-2026-09-12");
    const meta = structuredClone(capture.native[0]) as {
      payload: Record<string, unknown>;
    };
    meta.payload.history_base = {
      thread_id: "parent",
      end_byte_offset: 12,
      end_ordinal_exclusive: 2,
    };
    const path = await file(`${JSON.stringify(meta)}\n`);
    await expect(
      readConversationFile({
        ...options,
        path,
        provider: "codex",
        sessionId: capture.manifest.sessionId,
      }),
    ).rejects.toThrow("lineage");
    delete meta.payload.history_base;
    await writeFile(path, `${JSON.stringify(meta)}\n`);
    await expect(
      readConversationFile({ ...options, path, provider: "codex" }),
    ).rejects.toThrow("lineage");
  });
  it("honors cancellation before opening a source", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readConversationFile({
        ...options,
        path: "missing",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("invalidates a rewritten prefix even when growth preserves the old boundary", async () => {
    const reader = new ConversationAcquisition();
    const original =
      [
        {
          type: "user",
          uuid: "u",
          message: { role: "user", content: "OLD_TEXT" },
        },
        {
          type: "assistant",
          uuid: "a",
          parentUuid: "u",
          message: { role: "assistant", content: "p".repeat(8192) },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n";
    const path = await file(original);
    await reader.read({ ...options, path });
    await writeFile(
      path,
      original.replace("OLD_TEXT", "NEW_TEXT") +
        JSON.stringify({
          type: "user",
          uuid: "next",
          parentUuid: "a",
          message: { role: "user", content: "Next" },
        }) +
        "\n",
    );
    const result = await reader.read({ ...options, path });
    expect(JSON.stringify(result.messages)).toContain("NEW_TEXT");
    expect(JSON.stringify(result.messages)).not.toContain("OLD_TEXT");
    reader.clear();
  });
  it("does not truncate a delivered queued Claude prompt", async () => {
    const text = `BEGIN${"q".repeat(8000)}END`;
    const path = await file(
      [
        {
          type: "user",
          uuid: "u",
          message: { role: "user", content: "Start" },
        },
        {
          type: "queue-operation",
          operation: "enqueue",
          content: text,
          timestamp: "2026-01-01T00:00:00Z",
        },
        {
          type: "queue-operation",
          operation: "remove",
          timestamp: "2026-01-01T00:00:01Z",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    const result = await readConversationFile({ ...options, path });
    expect(JSON.stringify(result.messages)).toContain(text);
    expect(result.sourceCoverage.complete).toBe(true);
  });
  it("admits five concurrent idle acquisitions without stranding the fifth", async () => {
    const paths = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        file(
          JSON.stringify({
            type: "user",
            uuid: `u${i}`,
            message: { role: "user", content: `Message ${i}` },
          }) + "\n",
        ),
      ),
    );
    const reader = new ConversationAcquisition();
    const results = await Promise.all(
      paths.map((path) => reader.read({ ...options, path })),
    );
    expect(results).toHaveLength(5);
    results.forEach((result, i) => {
      expect(JSON.stringify(result.messages)).toContain(`Message ${i}`);
    });
    reader.clear();
  });
  it.each(["", "Script completed\nWall time 1.3 seconds\nOutput:\n"])(
    "keeps failed exit status in long Codex output envelope %j",
    async (prefix) => {
      const capture = await loadCapture("codex-basic-2026-09-12");
      const call = {
        type: "response_item",
        timestamp: "2026-09-12T09:56:00Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "long-failure",
          arguments: JSON.stringify({ cmd: "exit 7" }),
        },
      };
      const output = {
        ...call,
        payload: {
          type: "function_call_output",
          call_id: "long-failure",
          output:
            prefix +
            JSON.stringify({
              chunk_id: "test",
              output: "x".repeat(8192),
              exit_code: 7,
            }),
        },
      };
      const path = await file(
        [...capture.native, call, output]
          .map((row) => JSON.stringify(row))
          .join("\n") + "\n",
      );
      const result = await readConversationFile({
        ...options,
        path,
        provider: "codex",
        sessionId: capture.manifest.sessionId,
      });
      const failure = result.messages.find(
        (message) => message.uuid === "long-failure-result",
      );
      expect(JSON.stringify(failure)).toContain('"is_error":true');
    },
  );
  it("preserves a middle interruption marker inside JSON output", async () => {
    const capture = await loadCapture("codex-basic-2026-09-12");
    const entries = [
      ...capture.native,
      {
        type: "response_item",
        timestamp: "2026-09-12T09:56:00Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "interrupt",
          arguments: JSON.stringify({ cmd: "sleep 1" }),
        },
      },
      {
        type: "response_item",
        timestamp: "2026-09-12T09:56:01Z",
        payload: {
          type: "function_call_output",
          call_id: "interrupt",
          output: JSON.stringify(
            "a".repeat(4096) + "\naborted by user\n" + "z".repeat(4096),
          ),
        },
      },
    ];
    const path = await file(
      entries.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const input = await readConversationFile({
      ...options,
      path,
      provider: "codex",
      sessionId: capture.manifest.sessionId,
    });
    expect(JSON.stringify(input.messages)).toContain("aborted by user");
  });
  it("uses frozen Codex lineage cutoffs and preserves inherited message identity", async () => {
    const capture = await loadCapture("codex-basic-2026-09-12");
    const parent = "00000000-0000-4000-8000-000000000001";
    const child = "00000000-0000-4000-8000-000000000002";
    const meta = (id: string) => ({
      ...capture.native[0],
      ordinal: 0,
      payload: {
        ...(capture.native[0] as { payload: object }).payload,
        id,
        history_mode: "paginated",
      },
    });
    const message = (ordinal: number, text: string) => ({
      type: "response_item",
      timestamp: "2026-01-01T00:00:00Z",
      ordinal,
      payload: {
        type: "message",
        id: `message-${ordinal}-${text}`,
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    });
    const prefix =
      [meta(parent), message(1, "Inherited answer")]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n";
    const parentPath = await file(
      prefix + JSON.stringify(message(2, "Parent later work")) + "\n",
    );
    const childMeta = meta(child);
    Object.assign(childMeta.payload, {
      history_base: {
        thread_id: parent,
        end_byte_offset: Buffer.byteLength(prefix),
        end_ordinal_exclusive: 2,
      },
    });
    childMeta.ordinal = 2;
    const childPath = await file(
      [childMeta, message(3, "Child answer")]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    const reader = new ConversationAcquisition();
    const result = await reader.read({
      ...options,
      path: childPath,
      provider: "codex",
      sessionId: child,
      resolveRolloutPath: async (id) => (id === parent ? parentPath : null),
    });
    expect(JSON.stringify(result.messages)).toContain("Inherited answer");
    expect(JSON.stringify(result.messages)).toContain("Child answer");
    expect(JSON.stringify(result.messages)).not.toContain("Parent later work");
    await expect(
      reader.read({
        ...options,
        path: childPath,
        provider: "codex",
        sessionId: child,
        resolveRolloutPath: async () => {
          await writeFile(
            childPath,
            JSON.stringify(meta(parent)) +
              "\n" +
              JSON.stringify(message(1, "Wrong thread")) +
              "\n",
          );
          return parentPath;
        },
      }),
    ).rejects.toThrow("lineage changed");
    reader.clear();
  });
  it("selects the active Claude branch through attachment connectors", async () => {
    const path = await file(
      [
        {
          type: "user",
          uuid: "u",
          message: { role: "user", content: "Question" },
        },
        {
          type: "assistant",
          uuid: "abandoned",
          parentUuid: "u",
          timestamp: "2026-01-01T00:00:00Z",
          message: { role: "assistant", content: "Old branch" },
        },
        {
          type: "attachment",
          uuid: "connector",
          parentUuid: "u",
          timestamp: "2026-01-02T00:00:00Z",
        },
        {
          type: "assistant",
          uuid: "active",
          parentUuid: "connector",
          timestamp: "2026-01-02T00:00:01Z",
          message: { role: "assistant", content: "Current answer" },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    const result = await readConversationFile({ ...options, path });
    expect(JSON.stringify(result.messages)).toContain("Current answer");
    expect(JSON.stringify(result.messages)).not.toContain("Old branch");
  });
});
