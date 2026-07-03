import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
  hasEquivalentJsonlMessage,
  reconcileClaudeQueueOperationEchoes,
  reconcileLinearMessages,
} from "../linearMessageDedup";

describe("hasEquivalentJsonlMessage", () => {
  it("requires matching content and close timestamps", () => {
    const existing: Message[] = [
      {
        uuid: "jsonl-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.900Z",
        _source: "jsonl",
        message: { role: "assistant", content: "Done." },
      },
    ];

    expect(
      hasEquivalentJsonlMessage(existing, {
        uuid: "sdk-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:01.200Z",
        _source: "sdk",
        message: { role: "assistant", content: "Done." },
      }),
    ).toBe(true);

    expect(
      hasEquivalentJsonlMessage(existing, {
        uuid: "sdk-2",
        type: "assistant",
        timestamp: "2026-03-09T10:00:10.200Z",
        _source: "sdk",
        message: { role: "assistant", content: "Done." },
      }),
    ).toBe(false);
  });

  it("uses the same tightened window for replay (no wide reconnect window)", () => {
    const existing: Message[] = [
      {
        uuid: "jsonl-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "jsonl",
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      },
    ];

    // Within the tight window: a replay copy still matches its persisted row.
    expect(
      hasEquivalentJsonlMessage(existing, {
        uuid: "sdk-replay-near",
        type: "assistant",
        timestamp: "2026-03-09T10:00:01.500Z",
        _source: "sdk",
        isReplay: true,
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      }),
    ).toBe(true);

    // Beyond it: no longer matched on content alone. The old 90s window risked
    // false-merging two genuinely distinct identical messages; deterministic id
    // matching now covers wide reconnect gaps instead.
    expect(
      hasEquivalentJsonlMessage(existing, {
        uuid: "sdk-replay-far",
        type: "assistant",
        timestamp: "2026-03-09T10:00:45.000Z",
        _source: "sdk",
        isReplay: true,
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      }),
    ).toBe(false);
  });

  it("allows the opening user turn to cross the startup persistence gap", () => {
    const existing: Message[] = [
      {
        uuid: "codex-2-2026-06-30T02:01:12.931Z",
        type: "user",
        timestamp: "2026-06-30T02:01:12.931Z",
        _source: "jsonl",
        message: {
          role: "user",
          content:
            "source control seems sticky to the last created session's project?",
        },
      },
    ];

    expect(
      hasEquivalentJsonlMessage(existing, {
        uuid: "optimistic-opening-turn",
        type: "user",
        timestamp: "2026-06-30T02:01:07.884Z",
        _source: "sdk",
        message: {
          role: "user",
          content:
            "source control seems sticky to the last created session's project?",
        },
      }),
    ).toBe(true);
  });

  it("keeps the tight window for repeated user turns after the opener", () => {
    const existing: Message[] = [
      {
        uuid: "first-user",
        type: "user",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "jsonl",
        message: { role: "user", content: "Start." },
      },
      {
        uuid: "second-user-jsonl",
        type: "user",
        timestamp: "2026-03-09T10:00:16.000Z",
        _source: "jsonl",
        message: { role: "user", content: "Again." },
      },
    ];

    expect(
      hasEquivalentJsonlMessage(existing, {
        uuid: "second-user-sdk",
        type: "user",
        timestamp: "2026-03-09T10:00:10.000Z",
        _source: "sdk",
        message: { role: "user", content: "Again." },
      }),
    ).toBe(false);
  });
});

describe("reconcileLinearMessages", () => {
  it("merges sdk/jsonl duplicates and prefers jsonl", () => {
    const messages: Message[] = [
      {
        uuid: "sdk-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.500Z",
        _source: "sdk",
        message: { role: "assistant", content: "Committed." },
      },
      {
        uuid: "jsonl-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.800Z",
        _source: "jsonl",
        message: { role: "assistant", content: "Committed." },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?._source).toBe("jsonl");
    expect(result[0]?.uuid).toBe("jsonl-1");
    expect(result[0]?.timestamp).toBe("2026-03-09T10:00:00.800Z");
  });

  it("merges a first user turn across new-session startup delay", () => {
    const messages: Message[] = [
      {
        uuid: "optimistic-opening-turn",
        type: "user",
        timestamp: "2026-06-30T02:01:07.884Z",
        _source: "sdk",
        message: {
          role: "user",
          content:
            "source control seems sticky to the last created session's project?",
        },
      },
      {
        uuid: "codex-2-2026-06-30T02:01:12.931Z",
        type: "user",
        timestamp: "2026-06-30T02:01:12.931Z",
        _source: "jsonl",
        message: {
          role: "user",
          content:
            "source control seems sticky to the last created session's project?",
        },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?._source).toBe("jsonl");
    expect(result[0]?.uuid).toBe("codex-2-2026-06-30T02:01:12.931Z");
  });

  it("merges an attached opening turn by visible text and attachment identity", () => {
    const prompt = "Please inspect this screenshot.";
    const attachmentLine =
      "- [image.png](</project/.attachments/session-a/image.png>) (42 kb, image/png, 321x460)";
    const messages: Message[] = [
      {
        uuid: "live-opening",
        type: "user",
        timestamp: "2026-06-30T03:15:06.807Z",
        _source: "sdk",
        message: { role: "user", content: prompt },
        attachments: [
          {
            id: "file-1",
            originalName: "image.png",
            path: "/project/.attachments/session-a/image.png",
            size: 42_000,
            mimeType: "image/png",
          },
        ],
      },
      {
        uuid: "codex-2-2026-06-30T03:15:16.034Z",
        type: "user",
        timestamp: "2026-06-30T03:15:16.034Z",
        _source: "jsonl",
        message: {
          role: "user",
          content: `${prompt}\n\nUser uploaded files in .attachments:\n${attachmentLine}`,
        },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?._source).toBe("jsonl");
    expect(result[0]?.uuid).toBe("codex-2-2026-06-30T03:15:16.034Z");
  });

  it("merges same-source live duplicates of the visible opening turn", () => {
    const prompt = "Please inspect this screenshot.";
    const expanded = `${prompt}\n\nUser uploaded files in .attachments:\n- [image.png](</project/.attachments/session-a/image.png>) (42 kb, image/png, 321x460)`;
    const messages: Message[] = [
      {
        uuid: "ya-live-opening",
        type: "user",
        timestamp: "2026-06-30T03:15:06.807Z",
        _source: "sdk",
        message: { role: "user", content: expanded },
      },
      {
        uuid: "codex-live-opening",
        type: "user",
        timestamp: "2026-06-30T03:15:16.034Z",
        _source: "sdk",
        message: { role: "user", content: expanded },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?.uuid).toBe("codex-live-opening");
    expect(result[0]?._source).toBe("sdk");
  });

  it("does not use the startup window for later repeated user turns", () => {
    const messages: Message[] = [
      {
        uuid: "first-user",
        type: "user",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "jsonl",
        message: { role: "user", content: "Start." },
      },
      {
        uuid: "second-user-sdk",
        type: "user",
        timestamp: "2026-03-09T10:00:10.000Z",
        _source: "sdk",
        message: { role: "user", content: "Again." },
      },
      {
        uuid: "second-user-jsonl",
        type: "user",
        timestamp: "2026-03-09T10:00:16.000Z",
        _source: "jsonl",
        message: { role: "user", content: "Again." },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result.map((message) => message.uuid)).toEqual([
      "first-user",
      "second-user-sdk",
      "second-user-jsonl",
    ]);
  });

  it("keeps later repeated attached user turns separate", () => {
    const prompt = "Please inspect this screenshot.";
    const expanded = `${prompt}\n\nUser uploaded files in .attachments:\n- [image.png](</project/.attachments/session-a/image.png>) (42 kb, image/png, 321x460)`;
    const messages: Message[] = [
      {
        uuid: "first-user",
        type: "user",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "jsonl",
        message: { role: "user", content: "Start." },
      },
      {
        uuid: "assistant",
        type: "assistant",
        timestamp: "2026-03-09T10:00:02.000Z",
        _source: "jsonl",
        message: { role: "assistant", content: "Ready." },
      },
      {
        uuid: "later-user-sdk",
        type: "user",
        timestamp: "2026-03-09T10:00:10.000Z",
        _source: "sdk",
        message: { role: "user", content: expanded },
      },
      {
        uuid: "later-user-jsonl",
        type: "user",
        timestamp: "2026-03-09T10:00:16.000Z",
        _source: "jsonl",
        message: { role: "user", content: expanded },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result.map((message) => message.uuid)).toEqual([
      "first-user",
      "assistant",
      "later-user-sdk",
      "later-user-jsonl",
    ]);
  });

  it("excludes tool messages from the backstop when excludeTools is set", () => {
    const toolPair = (source: "sdk" | "jsonl", uuid: string, ms: string) => ({
      uuid,
      type: "assistant" as const,
      timestamp: `2026-03-09T10:00:0${ms}Z`,
      _source: source,
      message: {
        role: "assistant" as const,
        content: [
          {
            type: "tool_use",
            id: "call-x",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
    });
    const messages: Message[] = [
      toolPair("sdk", "sdk-tool", "0.000"),
      toolPair("jsonl", "jsonl-tool", "0.300"),
      {
        uuid: "sdk-text",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        message: { role: "assistant", content: "Done." },
      },
      {
        uuid: "jsonl-text",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.300Z",
        _source: "jsonl",
        message: { role: "assistant", content: "Done." },
      },
    ];

    // Default: backstop merges both the tool and text duplicates.
    expect(reconcileLinearMessages(messages)).toHaveLength(2);

    // excludeTools: tool duplicates are kept (they dedup by id upstream),
    // text duplicates still merge.
    const excluded = reconcileLinearMessages(messages, { excludeTools: true });
    const toolUses = excluded.filter((m) =>
      Array.isArray((m.message as { content?: unknown })?.content),
    );
    const texts = excluded.filter(
      (m) => typeof (m.message as { content?: unknown })?.content === "string",
    );
    expect(toolUses).toHaveLength(2);
    expect(texts).toHaveLength(1);
  });

  it("orders messages by timestamp for Codex's linear history", () => {
    const messages: Message[] = [
      {
        uuid: "late",
        type: "assistant",
        timestamp: "2026-03-09T10:00:03.000Z",
        _source: "sdk",
        message: { role: "assistant", content: "Third" },
      },
      {
        uuid: "early",
        type: "user",
        timestamp: "2026-03-09T10:00:01.000Z",
        _source: "jsonl",
        message: { role: "user", content: "First" },
      },
      {
        uuid: "middle",
        type: "assistant",
        timestamp: "2026-03-09T10:00:02.000Z",
        _source: "jsonl",
        message: { role: "assistant", content: "Second" },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result.map((message) => message.uuid)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  it("keeps repeated same-text messages when they are far apart", () => {
    const messages: Message[] = [
      {
        uuid: "sdk-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        message: { role: "assistant", content: "Done." },
      },
      {
        uuid: "jsonl-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:09.000Z",
        _source: "jsonl",
        message: { role: "assistant", content: "Done." },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(2);
  });

  it("dedupes exact same-source repeats from live stream replay", () => {
    const messages: Message[] = [
      {
        uuid: "sdk-1",
        type: "user",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        message: { role: "user", content: "Test this." },
      },
      {
        uuid: "sdk-2",
        type: "user",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        message: { role: "user", content: "Test this." },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?.uuid).toBe("sdk-2");
  });

  it("keeps same-source repeated text with distinct timestamps", () => {
    const messages: Message[] = [
      {
        uuid: "sdk-1",
        type: "user",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        message: { role: "user", content: "now" },
      },
      {
        uuid: "sdk-2",
        type: "user",
        timestamp: "2026-03-09T10:00:01.000Z",
        _source: "sdk",
        message: { role: "user", content: "now" },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(2);
  });

  it("merges replay/jsonl duplicates within the tightened window", () => {
    const messages: Message[] = [
      {
        uuid: "sdk-replay-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        isReplay: true,
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      },
      {
        uuid: "jsonl-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:01.000Z",
        _source: "jsonl",
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?._source).toBe("jsonl");
    expect(result[0]?.uuid).toBe("jsonl-1");
  });

  it("does not merge content-identical messages beyond the tightened window", () => {
    const messages: Message[] = [
      {
        uuid: "sdk-replay-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:00.000Z",
        _source: "sdk",
        isReplay: true,
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      },
      {
        uuid: "jsonl-1",
        type: "assistant",
        timestamp: "2026-03-09T10:00:45.000Z",
        _source: "jsonl",
        message: {
          role: "assistant",
          content:
            "There's one small TypeScript widening issue in the new helper.",
        },
      },
    ];

    const result = reconcileLinearMessages(messages);

    expect(result).toHaveLength(2);
  });
});

describe("reconcileClaudeQueueOperationEchoes", () => {
  const STEER_TEXT =
    "update task indicating the advisories you just mentioned all should be fixed, too";

  function optimisticEcho(
    overrides: Partial<Message> & { timestamp: string },
  ): Message {
    return {
      uuid: "ya-queue-uuid-1",
      type: "user",
      tempId: "temp-1",
      _source: "sdk",
      message: { role: "user", content: STEER_TEXT },
      ...overrides,
    } as Message;
  }

  function queueOperationRow(
    overrides: Partial<Message> & { timestamp: string },
  ): Message {
    return {
      id: "queue-operation-217-2026-07-03T20:30:24.635Z",
      type: "user",
      role: "user",
      content: STEER_TEXT,
      deferred: true,
      deferredSource: "queue-operation",
      _source: "jsonl",
      message: { role: "user", content: STEER_TEXT },
      ...overrides,
    } as Message;
  }

  it("merges the optimistic echo with the durable queue-operation row", () => {
    const echo = optimisticEcho({ timestamp: "2026-07-03T20:30:24.500Z" });
    const row = queueOperationRow({ timestamp: "2026-07-03T20:30:24.635Z" });

    const result = reconcileClaudeQueueOperationEchoes([echo, row]);
    expect(result).toHaveLength(1);
    expect(result[0]?._source).toBe("jsonl");
    expect(result[0]?.deferredSource).toBe("queue-operation");
  });

  it("keeps the durable row when the echo replays after a reload", () => {
    const row = queueOperationRow({ timestamp: "2026-07-03T20:30:24.635Z" });
    const echo = optimisticEcho({ timestamp: "2026-07-03T20:30:24.500Z" });

    const result = reconcileClaudeQueueOperationEchoes([row, echo]);
    expect(result).toHaveLength(1);
    expect(result[0]?._source).toBe("jsonl");
    expect(result[0]?.id).toBe("queue-operation-217-2026-07-03T20:30:24.635Z");
  });

  it("pairs two identical steers one-to-one", () => {
    const echo1 = optimisticEcho({
      uuid: "ya-queue-uuid-1",
      timestamp: "2026-07-03T20:30:24.500Z",
    });
    const echo2 = optimisticEcho({
      uuid: "ya-queue-uuid-2",
      timestamp: "2026-07-03T20:30:30.000Z",
    });
    const row1 = queueOperationRow({
      id: "queue-operation-217-a",
      timestamp: "2026-07-03T20:30:24.635Z",
    });
    const row2 = queueOperationRow({
      id: "queue-operation-218-b",
      timestamp: "2026-07-03T20:30:30.100Z",
    });

    const result = reconcileClaudeQueueOperationEchoes([
      echo1,
      echo2,
      row1,
      row2,
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m._source === "jsonl")).toBe(true);
  });

  it("does not pair outside the window or across different text", () => {
    const staleEcho = optimisticEcho({ timestamp: "2026-07-03T20:00:00.000Z" });
    const otherTextEcho = optimisticEcho({
      uuid: "ya-queue-uuid-3",
      timestamp: "2026-07-03T20:30:24.600Z",
      message: { role: "user", content: "different message" },
    });
    const row = queueOperationRow({ timestamp: "2026-07-03T20:30:24.635Z" });

    const result = reconcileClaudeQueueOperationEchoes([
      staleEcho,
      otherTextEcho,
      row,
    ]);
    expect(result).toHaveLength(3);
  });

  it("prefers the nearest echo so direct sends keep their own copy", () => {
    // An earlier direct send with identical text (dedups by uuid elsewhere).
    const directEcho = optimisticEcho({
      uuid: "direct-send-uuid",
      timestamp: "2026-07-03T20:30:00.000Z",
    });
    const steerEcho = optimisticEcho({
      uuid: "ya-queue-uuid-4",
      timestamp: "2026-07-03T20:30:24.500Z",
    });
    const row = queueOperationRow({ timestamp: "2026-07-03T20:30:24.635Z" });

    const result = reconcileClaudeQueueOperationEchoes([
      directEcho,
      steerEcho,
      row,
    ]);
    expect(result).toHaveLength(2);
    const remainingUuids = result.map((m) => m.uuid);
    expect(remainingUuids).toContain("direct-send-uuid");
    expect(remainingUuids).not.toContain("ya-queue-uuid-4");
  });

  it("is a no-op without queue-operation rows", () => {
    const echo = optimisticEcho({ timestamp: "2026-07-03T20:30:24.500Z" });
    const plain: Message = {
      uuid: "assistant-1",
      type: "assistant",
      timestamp: "2026-07-03T20:30:25.000Z",
      _source: "jsonl",
      message: { role: "assistant", content: "ok" },
    };
    const input = [echo, plain];
    expect(reconcileClaudeQueueOperationEchoes(input)).toBe(input);
  });
});
