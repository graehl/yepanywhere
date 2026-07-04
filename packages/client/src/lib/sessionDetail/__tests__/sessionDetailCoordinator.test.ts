import { toUrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { asClientSummarySourceKey } from "../../clientSummaryStore";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../../sessionRouteSnapshots";
import { selectSessionDetailMessages } from "../selectors";
import { createSessionDetailStore } from "../sessionDetailStore";
import {
  createSessionDetailCoordinator,
  type SessionDetailStreamProcessors,
} from "../sessionDetailCoordinator";
import type { Message } from "../../../types";
import type { GetSessionResult, YaSourceRuntime } from "../../sourceRuntime";

function message(uuid: string): Message {
  return {
    uuid,
    type: "assistant",
    timestamp: "2026-07-04T00:00:00.000Z",
    message: { role: "assistant", content: uuid },
  };
}

function session(): GetSessionResult["session"] {
  return {
    id: "sess-1",
    projectId: toUrlProjectId("proj-1"),
    title: null,
    fullTitle: null,
    createdAt: "2026-07-04T00:00:00.000Z",
    provider: "claude",
    messageCount: 1,
    ownership: { owner: "self", processId: "pid-test" },
    updatedAt: "2026-07-04T00:00:00.000Z",
  };
}

function scrollSnapshot(scrollTop: number): SessionRouteScrollSnapshot {
  return {
    atBottom: false,
    scrollTop,
    scrollHeight: 480,
    clientHeight: 240,
    updatedAtMs: scrollTop,
  };
}

function routeSnapshot(uuid: string): SessionRouteSnapshot {
  return {
    messages: [message(uuid)],
    session: session(),
    pagination: {
      hasOlderMessages: false,
      totalMessageCount: 1,
      returnedMessageCount: 1,
      totalCompactions: 0,
    },
    agentContent: {},
    toolUseToAgentEntries: [],
    lastMessageId: uuid,
    maxPersistedTimestampMs: Date.parse("2026-07-04T00:00:00.000Z"),
    scrollSnapshot: scrollSnapshot(12),
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

  it("centralizes entry-scoped store operations", () => {
    const detail = coordinator();

    expect(detail.entryKeyString.length).toBeGreaterThan(0);
    expect(detail.readRouteSnapshot()).toBeUndefined();

    expect(detail.writeRouteSnapshot(routeSnapshot("cached"))).toBe(true);
    expect(detail.readSelected(selectSessionDetailMessages)?.[0]?.uuid).toBe(
      "cached",
    );
    expect(detail.readScrollSnapshot()?.scrollTop).toBe(12);

    detail.patchScrollSnapshot(scrollSnapshot(24));

    expect(detail.readScrollSnapshot()?.scrollTop).toBe(24);
    expect(detail.getEntryApproxBytes()).toBeGreaterThan(0);

    detail.resetEntryState();

    expect(detail.readSelected(selectSessionDetailMessages)).toEqual([]);

    expect(detail.replaceRouteSnapshot(routeSnapshot("restored"))).toBe(true);
    expect(detail.readRouteSnapshot()?.lastMessageId).toBe("restored");

    expect(detail.deleteEntry()).toBe(true);
    expect(detail.readRouteSnapshot()).toBeUndefined();
  });
});
