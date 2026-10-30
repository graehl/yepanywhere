import { describe, expect, it, vi } from "vitest";
import { toUrlProjectId } from "@yep-anywhere/shared";
import {
  createConversationSource,
  type ConversationSourceDependencies,
} from "../src/experimental/conversation-source.js";
import type { ProcessEvent, ProcessState } from "../src/supervisor/types.js";
import type { ConversationInput } from "../src/experimental/conversation-projection.js";
import type { SessionCatalogRow } from "../src/sessions/catalog-types.js";

const row: SessionCatalogRow = {
  sessionId: "s",
  catalogFamily: "claude",
  storeKey: "test",
  projectId: toUrlProjectId("/test"),
  projectPath: "/test",
  projectIdentityKey: "/test",
  updatedAt: "2026-09-12T00:00:00.000Z",
  fidelity: "tail",
  sourceVersion: "1",
  location: { kind: "file", path: "/test/native.jsonl" },
};
function harness() {
  let state: ProcessState = { type: "in-turn" };
  let listener: (event: ProcessEvent) => void = () => {};
  let durable: ConversationInput = {
    sessionId: "s",
    messages: [{ type: "user", uuid: "u", content: "Hello" }],
    activity: "unknown",
    pendingRequests: [],
    sourceCoverage: { complete: true, earlierOutsideScope: "no" },
  };
  const unsubscribe = vi.fn();
  const releaseViewer = vi.fn();
  const stopWatch = vi.fn();
  const invalidate = vi.fn();
  const readFile = vi.fn(async () => durable);
  const process: NonNullable<
    ReturnType<ConversationSourceDependencies["getProcess"]>
  > = {
    get state() {
      return state;
    },
    subscribe: (next) => {
      listener = next;
      return unsubscribe;
    },
    registerViewer: () => releaseViewer,
    getMessageHistory: () => [],
  };
  let changeFile = () => {};
  const abort = new AbortController();
  const open = createConversationSource({
    resolve: async () => row,
    getProcess: () => process,
    readFile,
    watch: (_row, notify) => {
      changeFile = notify;
      return stopWatch;
    },
  });
  return {
    open,
    changeFile: () => changeFile(),
    abort,
    readFile,
    unsubscribe,
    releaseViewer,
    stopWatch,
    invalidate,
    event(event: ProcessEvent) {
      if (event.type === "state-change") state = event.state;
      listener(event);
    },
    setDurable(next: ConversationInput) {
      durable = next;
    },
  };
}

describe("observed Conversation source", () => {
  it("does not clear a file invalidation observed during acquisition", async () => {
    const h = harness();
    const source = await h.open("s", h.invalidate, h.abort.signal);
    h.event({
      type: "state-change",
      state: { type: "idle", since: new Date() },
    });
    h.readFile.mockImplementationOnce(async () => {
      h.changeFile();
      return {
        sessionId: "s",
        messages: [],
        activity: "idle",
        pendingRequests: [],
        sourceCoverage: { complete: true, earlierOutsideScope: "no" },
      };
    });
    await source.read(h.abort.signal);
    await source.read(h.abort.signal);
    expect(h.readFile).toHaveBeenCalledTimes(2);
    source.close();
  });

  it("replaces a known durable ID in place when a later finalized event arrives", async () => {
    const h = harness();
    const source = await h.open("s", h.invalidate, h.abort.signal);
    await source.read(h.abort.signal);
    h.event({
      type: "message",
      message: {
        type: "user",
        uuid: "u",
        message: { role: "user", content: "Updated content" },
      },
    });
    const updated = await source.read(h.abort.signal);
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]?.message?.content).toBe("Updated content");
    expect(h.readFile).toHaveBeenCalledTimes(1);
    source.close();
    await expect(source.read(h.abort.signal)).rejects.toThrow("closed");
  });

  it("retains YA user identity, coalesces finalized messages in memory, and reconciles idle without duplicates", async () => {
    const h = harness();
    const source = await h.open("s", h.invalidate, h.abort.signal);
    await source.read(h.abort.signal);
    h.event({
      type: "message",
      message: {
        type: "user",
        uuid: "next-user",
        message: { role: "user", content: "Next" },
      },
    });
    h.event({
      type: "message",
      message: {
        type: "assistant",
        uuid: "answer",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Answer" }],
        },
      },
    });
    const live = await source.read(h.abort.signal);
    expect(live.messages.map((m) => m.uuid)).toEqual([
      "u",
      "next-user",
      "answer",
    ]);
    expect(live.activity).toBe("working");
    expect(h.readFile).toHaveBeenCalledTimes(1);
    h.setDurable({
      ...live,
      sourceCoverage: { complete: true, earlierOutsideScope: "no" },
    });
    h.event({
      type: "state-change",
      state: { type: "idle", since: new Date() },
    });
    const idle = await source.read(h.abort.signal);
    expect(idle.messages).toHaveLength(3);
    expect(idle.activity).toBe("idle");
    expect(h.readFile).toHaveBeenCalledTimes(2);
    h.abort.abort();
    source.close();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.releaseViewer).toHaveBeenCalledTimes(1);
    expect(h.stopWatch).toHaveBeenCalledTimes(1);
  });
  it("keeps raw token frames out and preserves subagent marking", async () => {
    const h = harness();
    const source = await h.open("s", h.invalidate, h.abort.signal);
    await source.read(h.abort.signal);
    h.invalidate.mockClear();
    h.event({
      type: "message",
      message: { type: "stream_event", event: { type: "content_block_delta" } },
    });
    expect(h.invalidate).not.toHaveBeenCalled();
    h.event({
      type: "message",
      message: {
        type: "assistant",
        uuid: "child",
        parent_tool_use_id: "tool",
        message: { role: "assistant", content: "Child" },
      },
    });
    expect(
      (await source.read(h.abort.signal)).messages.at(-1)?.isSubagent,
    ).toBe(true);
    source.close();
  });
  it("recovers from an unusable live record once the durable file holds it", async () => {
    const h = harness();
    const source = await h.open("s", h.invalidate, h.abort.signal);
    await source.read(h.abort.signal);
    h.event({
      type: "message",
      message: {
        type: "assistant",
        message: { role: "assistant", content: "No identity" },
      },
    });
    await expect(source.read(h.abort.signal)).rejects.toThrow(
      "Unreconciled live conversation",
    );
    h.setDurable({
      sessionId: "s",
      messages: [
        { type: "user", uuid: "u", content: "Hello" },
        {
          type: "assistant",
          uuid: "persisted",
          message: { role: "assistant", content: "No identity" },
        },
      ],
      activity: "unknown",
      pendingRequests: [],
      sourceCoverage: { complete: true, earlierOutsideScope: "no" },
    });
    h.event({
      type: "state-change",
      state: { type: "idle", since: new Date() },
    });
    const reconciled = await source.read(h.abort.signal);
    expect(reconciled.messages.map((m) => m.uuid)).toEqual(["u", "persisted"]);
    h.event({
      type: "message",
      message: {
        type: "user",
        uuid: "after",
        message: { role: "user", content: "Later" },
      },
    });
    expect(
      (await source.read(h.abort.signal)).messages.map((m) => m.uuid),
    ).toEqual(["u", "persisted", "after"]);
    source.close();
  });

  it("keeps refusing when an unusable live record arrives during the durable read", async () => {
    const h = harness();
    h.event({
      type: "state-change",
      state: { type: "idle", since: new Date() },
    });
    const source = await h.open("s", h.invalidate, h.abort.signal);
    h.readFile.mockImplementationOnce(async () => {
      h.event({
        type: "message",
        message: {
          type: "assistant",
          message: { role: "assistant", content: "No identity" },
        },
      });
      return {
        sessionId: "s",
        messages: [{ type: "user", uuid: "u", content: "Hello" }],
        activity: "unknown",
        pendingRequests: [],
        sourceCoverage: { complete: true, earlierOutsideScope: "no" },
      };
    });
    await expect(source.read(h.abort.signal)).rejects.toThrow(
      "Unreconciled live conversation",
    );
    h.setDurable({
      sessionId: "s",
      messages: [
        { type: "user", uuid: "u", content: "Hello" },
        {
          type: "assistant",
          uuid: "persisted",
          message: { role: "assistant", content: "No identity" },
        },
      ],
      activity: "unknown",
      pendingRequests: [],
      sourceCoverage: { complete: true, earlierOutsideScope: "no" },
    });
    expect(
      (await source.read(h.abort.signal)).messages.map((m) => m.uuid),
    ).toEqual(["u", "persisted"]);
    source.close();
  });

  it("does not lose a record that arrives while an earlier drop is being reconciled", async () => {
    const h = harness();
    h.event({
      type: "state-change",
      state: { type: "idle", since: new Date() },
    });
    const source = await h.open("s", h.invalidate, h.abort.signal);
    await source.read(h.abort.signal);
    h.event({
      type: "message",
      message: {
        type: "assistant",
        message: { role: "assistant", content: "No identity" },
      },
    });
    h.readFile.mockImplementationOnce(async () => {
      h.event({
        type: "message",
        message: {
          type: "user",
          uuid: "later",
          message: { role: "user", content: "Later" },
        },
      });
      return {
        sessionId: "s",
        messages: [{ type: "user", uuid: "u", content: "Hello" }],
        activity: "unknown",
        pendingRequests: [],
        sourceCoverage: { complete: true, earlierOutsideScope: "no" },
      };
    });
    await expect(source.read(h.abort.signal)).rejects.toThrow(
      "Unreconciled live conversation",
    );
    h.setDurable({
      sessionId: "s",
      messages: [
        { type: "user", uuid: "u", content: "Hello" },
        { type: "user", uuid: "later", content: "Later" },
      ],
      activity: "unknown",
      pendingRequests: [],
      sourceCoverage: { complete: true, earlierOutsideScope: "no" },
    });
    expect(
      (await source.read(h.abort.signal)).messages.map((m) => m.uuid),
    ).toEqual(["u", "later"]);
    source.close();
  });

  it("does not treat a read while the turn awaits input as covering a dropped record", async () => {
    const h = harness();
    const source = await h.open("s", h.invalidate, h.abort.signal);
    await source.read(h.abort.signal);
    h.event({
      type: "message",
      message: {
        type: "assistant",
        message: { role: "assistant", content: "No identity" },
      },
    });
    h.event({
      type: "state-change",
      state: {
        type: "waiting-input",
        request: {
          id: "r",
          sessionId: "s",
          type: "tool-approval",
          prompt: "Allow?",
          timestamp: "2026-09-27T00:00:00.000Z",
        },
      },
    });
    await expect(source.read(h.abort.signal)).rejects.toThrow(
      "Unreconciled live conversation",
    );
    h.setDurable({
      sessionId: "s",
      messages: [
        { type: "user", uuid: "u", content: "Hello" },
        {
          type: "assistant",
          uuid: "persisted",
          message: { role: "assistant", content: "No identity" },
        },
      ],
      activity: "unknown",
      pendingRequests: [],
      sourceCoverage: { complete: true, earlierOutsideScope: "no" },
    });
    h.event({
      type: "state-change",
      state: { type: "idle", since: new Date() },
    });
    expect(
      (await source.read(h.abort.signal)).messages.map((m) => m.uuid),
    ).toEqual(["u", "persisted"]);
    source.close();
  });

  it("does not acquire a file after cancellation during catalog resolution", async () => {
    const abort = new AbortController();
    const readFile = vi.fn();
    const open = createConversationSource({
      getProcess: () => undefined,
      resolve: async () => {
        abort.abort();
        return row;
      },
      readFile,
    });
    const source = await open("s", () => {}, abort.signal);
    await expect(source.read(abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(readFile).not.toHaveBeenCalled();
    source.close();
  });
});

it("serves only a supported exact live owner before catalog materialization and reconciles durable history", async () => {
  let retained: SessionCatalogRow | undefined;
  const releaseViewer = vi.fn(),
    off = vi.fn(),
    unwatch = vi.fn();
  const process = {
    sessionId: "s",
    provider: "codex",
    state: { type: "idle" as const, since: new Date() },
    registerViewer: () => releaseViewer,
    subscribe: () => off,
    getMessageHistory: () => [
      {
        type: "assistant" as const,
        uuid: "answer",
        message: { role: "assistant" as const, content: "Available now" },
      },
    ],
  };
  const readFile = vi.fn(async () => ({
    sessionId: "s",
    messages: [
      { type: "assistant" as const, uuid: "answer", content: "Available now" },
    ],
    activity: "unknown" as const,
    pendingRequests: [],
    sourceCoverage: { complete: true, earlierOutsideScope: "no" as const },
  }));
  const open = createConversationSource({
    resolve: async () => retained,
    getProcess: () => process,
    readFile,
    watch: () => unwatch,
  });
  const abort = new AbortController();
  const source = await open("s", () => {}, abort.signal);
  try {
    const early = await source.read(abort.signal);
    expect(early.messages.map((m) => m.uuid)).toEqual(["answer"]);
    expect(early.sourceCoverage).toEqual({
      complete: false,
      earlierOutsideScope: "unknown",
    });
    expect(readFile).not.toHaveBeenCalled();
    retained = { ...row, catalogFamily: "codex" };
    const durable = await source.read(abort.signal);
    expect(durable.messages).toHaveLength(1);
    expect(durable.sourceCoverage.complete).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(1);
  } finally {
    source.close();
  }
  expect(off).toHaveBeenCalledTimes(1);
  expect(releaseViewer).toHaveBeenCalledTimes(1);
  expect(unwatch).toHaveBeenCalledTimes(1);
  retained = undefined;
  for (const wrong of [
    { ...process, provider: "pi" },
    { ...process, sessionId: "other" },
  ]) {
    const source = await createConversationSource({
      resolve: async () => undefined,
      getProcess: () => wrong,
    })("s", () => {}, abort.signal);
    try {
      await expect(source.read(abort.signal)).rejects.toThrow("not found");
    } finally {
      source.close();
    }
  }
});
