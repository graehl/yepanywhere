import { describe, expect, it, vi } from "vitest";
import { asClientSummarySourceKey } from "../../clientSummaryStore";
import { createSessionDetailStore } from "../sessionDetailStore";
import {
  createSessionDetailCoordinator,
  type SessionDetailStreamProcessors,
} from "../sessionDetailCoordinator";
import type { Message } from "../../../types";
import type { YaSourceRuntime } from "../../sourceRuntime";

function message(uuid: string): Message {
  return {
    uuid,
    type: "assistant",
    timestamp: "2026-07-04T00:00:00.000Z",
    message: { role: "assistant", content: uuid },
  };
}

function runtime(): YaSourceRuntime {
  return {
    sourceKey: asClientSummarySourceKey("host:test"),
    api: {
      getSession: vi.fn(),
      getSessionMetadata: vi.fn(),
    },
    sessionDetails: {
      cache: createSessionDetailStore(),
    },
  };
}

function coordinator() {
  const sourceRuntime = runtime();
  return createSessionDetailCoordinator({
    runtime: sourceRuntime,
    entryKey: {
      sourceKey: sourceRuntime.sourceKey,
      projectId: "proj-1",
      sessionId: "sess-1",
    },
  });
}

describe("SessionDetailCoordinator", () => {
  it("buffers stream messages until initial load completes", () => {
    const detail = coordinator();
    const processed: string[] = [];
    const processors: SessionDetailStreamProcessors = {
      processMessage: (incoming, fromBufferedReplay = false) => {
        processed.push(`${incoming.uuid}:${fromBufferedReplay}`);
      },
      processSubagentMessage: (incoming, agentId) => {
        processed.push(`${agentId}:${incoming.uuid}`);
      },
    };

    detail.handleStreamMessage(message("main-1"), processors.processMessage);
    detail.handleStreamSubagentMessage(
      message("sub-1"),
      "agent-1",
      processors.processSubagentMessage,
    );

    expect(processed).toEqual([]);

    detail.completeInitialLoad(processors);

    expect(processed).toEqual(["main-1:true", "agent-1:sub-1"]);

    detail.handleStreamMessage(message("main-2"), processors.processMessage);

    expect(processed).toEqual([
      "main-1:true",
      "agent-1:sub-1",
      "main-2:false",
    ]);
  });

  it("resetForInitialLoad clears buffered messages and closes the stream gate", () => {
    const detail = coordinator();
    const processed: string[] = [];
    const processors: SessionDetailStreamProcessors = {
      processMessage: (incoming, fromBufferedReplay = false) => {
        processed.push(`${incoming.uuid}:${fromBufferedReplay}`);
      },
      processSubagentMessage: (incoming, agentId) => {
        processed.push(`${agentId}:${incoming.uuid}`);
      },
    };

    detail.handleStreamMessage(message("discarded"), processors.processMessage);
    detail.resetForInitialLoad();
    detail.completeInitialLoad(processors);

    expect(processed).toEqual([]);

    detail.handleStreamMessage(message("live"), processors.processMessage);
    detail.resetForInitialLoad();
    detail.handleStreamMessage(message("buffered"), processors.processMessage);

    expect(processed).toEqual(["live:false"]);

    detail.completeInitialLoad(processors);

    expect(processed).toEqual(["live:false", "buffered:true"]);
  });

  it("coalesces incremental refresh work until the request settles", async () => {
    const detail = coordinator();
    let resolveFirst!: () => void;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const first = detail.runExclusiveFetchNewMessages(task);
    const second = detail.runExclusiveFetchNewMessages(task);

    expect(second).toBe(first);
    expect(task).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;

    const third = detail.runExclusiveFetchNewMessages(async () => {});

    expect(third).not.toBe(first);
    await third;
  });
});
