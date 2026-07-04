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

function message(
  uuid: string,
  timestamp = "2026-07-04T00:00:00.000Z",
): Message {
  return {
    uuid,
    type: "assistant",
    timestamp,
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

function pagination(returnedMessageCount: number) {
  return {
    hasOlderMessages: false,
    totalMessageCount: returnedMessageCount,
    returnedMessageCount,
    totalCompactions: 0,
  };
}

function sessionResponse(
  messages: Message[],
  responsePagination?: GetSessionResult["pagination"],
): GetSessionResult {
  const metadata = {
    ...session(),
    messageCount: messages.length,
  };
  return {
    session: metadata,
    messages,
    ownership: metadata.ownership,
    pendingInputRequest: null,
    slashCommands: null,
    ...(responsePagination && { pagination: responsePagination }),
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
    const initialLoad = detail.beginInitialLoad();
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

    expect(initialLoad.completeReveal(processors)).toBe(true);

    expect(processed).toEqual(["main-1:true", "agent-1:sub-1"]);

    detail.handleStreamMessage(message("main-2"), processors.processMessage);

    expect(processed).toEqual([
      "main-1:true",
      "agent-1:sub-1",
      "main-2:false",
    ]);
  });

  it("beginInitialLoad clears buffered messages and closes the stream gate", () => {
    const detail = coordinator();
    let initialLoad = detail.beginInitialLoad();
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
    initialLoad = detail.beginInitialLoad();
    expect(initialLoad.completeReveal(processors)).toBe(true);

    expect(processed).toEqual([]);

    detail.handleStreamMessage(message("live"), processors.processMessage);
    initialLoad = detail.beginInitialLoad();
    detail.handleStreamMessage(message("buffered"), processors.processMessage);

    expect(processed).toEqual(["live:false"]);

    expect(initialLoad.completeReveal(processors)).toBe(true);

    expect(processed).toEqual(["live:false", "buffered:true"]);
  });

  it("ignores stale initial-load reveal completions", () => {
    const detail = coordinator();
    const firstLoad = detail.beginInitialLoad();
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
    const secondLoad = detail.beginInitialLoad();
    detail.handleStreamMessage(message("kept"), processors.processMessage);

    expect(firstLoad.completeReveal(processors)).toBe(false);
    detail.handleStreamMessage(
      message("still-buffered"),
      processors.processMessage,
    );

    expect(processed).toEqual([]);

    expect(secondLoad.completeReveal(processors)).toBe(true);

    expect(processed).toEqual(["kept:true", "still-buffered:true"]);
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

  it("loads a full persisted transcript when warm refresh has no cursor", () => {
    const detail = coordinator();
    const responsePagination = pagination(1);
    const applied = detail.applyWarmRefresh(
      sessionResponse([message("full")], responsePagination),
      {
        warmSnapshot: routeSnapshot("warm"),
      },
    );

    expect(applied).toEqual({
      messageCount: 1,
      pagination: responsePagination,
      sourceMessageCount: 1,
    });
    expect(
      detail.readSelected(selectSessionDetailMessages)?.map(({ uuid }) => uuid),
    ).toEqual(["full"]);
  });

  it("replaces the tail window when warm refresh returns pagination", () => {
    const detail = coordinator();
    const responsePagination = pagination(1);

    detail.replaceRouteSnapshot(routeSnapshot("warm"));

    const applied = detail.applyWarmRefresh(
      sessionResponse([message("tail")], responsePagination),
      {
        warmSnapshot: routeSnapshot("warm"),
        initialAfterMessageId: "warm",
      },
    );

    expect(applied).toEqual({
      messageCount: 1,
      pagination: responsePagination,
      sourceMessageCount: 1,
    });
    expect(
      detail.readSelected(selectSessionDetailMessages)?.map(({ uuid }) => uuid),
    ).toEqual(["tail"]);
  });

  it("merges catch-up messages when warm refresh has no pagination", () => {
    const detail = coordinator();

    detail.replaceRouteSnapshot(routeSnapshot("warm"));

    const applied = detail.applyWarmRefresh(
      sessionResponse([
        message("catchup", "2026-07-04T00:00:01.000Z"),
      ]),
      {
        warmSnapshot: routeSnapshot("warm"),
        initialAfterMessageId: "warm",
      },
    );

    expect(applied).toEqual({
      messageCount: 2,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 2,
        returnedMessageCount: 2,
        totalCompactions: 0,
      },
      sourceMessageCount: 1,
    });
    expect(
      detail.readSelected(selectSessionDetailMessages)?.map(({ uuid }) => uuid),
    ).toEqual(["warm", "catchup"]);
  });

  it("builds reveal snapshots from store-backed runtime state", () => {
    const detail = coordinator();

    detail.replaceRouteSnapshot(routeSnapshot("stored"));

    const reveal = detail.buildRevealSnapshot({
      session: session(),
      pagination: pagination(1),
      lastMessageId: "fallback",
      scrollSnapshot: scrollSnapshot(96),
    });

    expect(reveal.storeBacked).toBe(true);
    expect(reveal.snapshot.messages.map(({ uuid }) => uuid)).toEqual([
      "stored",
    ]);
    expect(reveal.snapshot.lastMessageId).toBe("stored");
    expect(reveal.snapshot.scrollSnapshot?.scrollTop).toBe(12);
  });

  it("builds fallback reveal snapshots when store state is missing", () => {
    const detail = coordinator();
    const fallbackScroll = scrollSnapshot(48);

    const reveal = detail.buildRevealSnapshot({
      session: session(),
      pagination: pagination(1),
      lastMessageId: "fallback",
      scrollSnapshot: fallbackScroll,
    });

    expect(reveal.storeBacked).toBe(false);
    expect(reveal.snapshot.messages).toEqual([]);
    expect(reveal.snapshot.session).toEqual(session());
    expect(reveal.snapshot.lastMessageId).toBe("fallback");
    expect(reveal.snapshot.maxPersistedTimestampMs).toBe(
      Number.NEGATIVE_INFINITY,
    );
    expect(reveal.snapshot.scrollSnapshot).toBe(fallbackScroll);
  });
});
