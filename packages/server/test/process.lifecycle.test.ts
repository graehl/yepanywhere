import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  MessageQueue,
  Process,
  createControllableIterator,
  createMockIterator,
} from "./process.test-support.js";
import type {
  SDKMessage,
  UrlProjectId,
} from "./process.test-support.js";

describe("Process", () => {
  describe("getInfo", () => {
    it("returns process info", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test/path",
        projectId: "proj-123" as UrlProjectId,
        sessionId: "sess-456",
        provider: "claude",
        idleTimeoutMs: 100,
        promptSuggestionMode: "native",
      });

      const info = process.getInfo();

      expect(info.id).toBe(process.id);
      expect(info.sessionId).toBe("sess-456");
      expect(info.projectId).toBe("proj-123");
      expect(info.projectPath).toBe("/test/path");
      expect(info.startedAt).toBeDefined();
      expect(info.promptSuggestionMode).toBe("native");
    });
  });

  describe("abort", () => {
    it("emits complete event on abort", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
      });

      let completed = false;
      process.subscribe((event) => {
        if (event.type === "complete") {
          completed = true;
        }
      });

      await process.abort();

      expect(completed).toBe(true);
    });

    it("clears listeners after abort", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
      });

      let completeCount = 0;
      process.subscribe((event) => {
        if (event.type === "complete") {
          completeCount++;
        }
      });

      await process.abort();

      // Listener should have been called once for complete event
      expect(completeCount).toBe(1);
    });
  });

  describe("interrupt", () => {
    it("propagates provider soft-interrupt failure", async () => {
      const controller = createControllableIterator();
      const interruptFn = vi.fn(async () => false);
      const process = new Process(controller.iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
        interruptFn,
      });

      await expect(process.interrupt()).resolves.toBe(false);
      expect(interruptFn).toHaveBeenCalledTimes(1);

      controller.finish();
      await process.abort();
    });

    it("drains all queued messages into a single packet after successful interrupt", async () => {
      const controller = createControllableIterator();
      const queue = new MessageQueue();
      const interruptFn = vi.fn(async () => true);

      const process = new Process(controller.iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
        queue,
        interruptFn,
      });

      // Queue two messages while agent is "working"
      queue.push({ text: "first" });
      queue.push({ text: "second" });

      expect(process.queueDepth).toBe(2);

      // Interrupt should drain both into one combined message
      const result = await process.interrupt();
      expect(result).toBe(true);

      // The two messages should have been drained and re-queued as a single packet
      // The depth should be 1 (the combined message), not 2
      expect(process.queueDepth).toBe(1);

      controller.finish();
      await process.abort();
    });

    it("drains deferred messages into interrupt packet alongside direct queue", async () => {
      const controller = createControllableIterator();
      const queue = new MessageQueue();
      const interruptFn = vi.fn(async () => true);

      const process = new Process(controller.iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
        queue,
        interruptFn,
      });

      // One direct queued message and one deferred
      queue.push({ text: "direct" });
      process.deferMessage({ text: "deferred", tempId: "temp-d" });

      expect(process.queueDepth).toBe(1);
      expect(process.getDeferredQueueSummary()).toHaveLength(1);

      await process.interrupt();

      // Deferred queue should be empty (drained into the interrupt packet)
      expect(process.getDeferredQueueSummary()).toHaveLength(0);
      // Direct queue should have exactly one combined message
      expect(process.queueDepth).toBe(1);

      controller.finish();
      await process.abort();
    });

    it("does not re-queue when interrupt drains an empty queue", async () => {
      const controller = createControllableIterator();
      const queue = new MessageQueue();
      const interruptFn = vi.fn(async () => true);

      const process = new Process(controller.iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
        queue,
        interruptFn,
      });

      // No messages queued
      expect(process.queueDepth).toBe(0);
      await process.interrupt();

      // Still empty — no phantom empty message was enqueued
      expect(process.queueDepth).toBe(0);

      controller.finish();
      await process.abort();
    });
  });

  describe("input request handling", () => {
    it("transitions to waiting-input on input_request message", async () => {
      const messages: SDKMessage[] = [
        { type: "system", subtype: "init", session_id: "sess-1" },
        {
          type: "system",
          subtype: "input_request",
          input_request: {
            id: "req-123",
            type: "tool-approval",
            prompt: "Allow file write?",
          },
        },
      ];

      const iterator = createMockIterator(messages);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1" as UrlProjectId,
        sessionId: "sess-1",
        provider: "claude",
        idleTimeoutMs: 100,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(process.state.type).toBe("waiting-input");
      if (process.state.type === "waiting-input") {
        expect(process.state.request.id).toBe("req-123");
        expect(process.state.request.type).toBe("tool-approval");
        expect(process.state.request.prompt).toBe("Allow file write?");
      }
    });
  });
});
