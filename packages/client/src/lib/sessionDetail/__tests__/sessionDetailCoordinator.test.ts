import {
  toUrlProjectId,
  type ProviderRuntimeStatus,
} from "@yep-anywhere/shared";
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

const RUNTIME_STATUS: Exclude<ProviderRuntimeStatus, null> = {
  kind: "retrying",
  provider: "claude",
  reason: "rate_limit",
  httpStatus: 429,
  startedAt: "2026-07-04T00:00:00.000Z",
  lastSeenAt: "2026-07-04T00:00:01.000Z",
  retryAt: "2026-07-04T00:01:00.000Z",
  retryDelayMs: 60_000,
  eventCount: 1,
  source: "claude.system.api_retry",
};

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

  it("applies explicit initial route snapshot cache policy", () => {
    const detail = coordinator();

    expect(detail.readInitialRouteSnapshot({ enabled: false })).toBeUndefined();
    expect(
      detail.writeInitialRouteSnapshot(routeSnapshot("disabled"), {
        enabled: false,
        retainScrollSnapshot: true,
      }),
    ).toBe(false);
    expect(detail.readRouteSnapshot()).toBeUndefined();

    expect(
      detail.writeInitialRouteSnapshot(routeSnapshot("without-scroll"), {
        enabled: true,
        retainScrollSnapshot: false,
      }),
    ).toBe(true);
    expect(detail.readInitialRouteSnapshot({ enabled: false })).toBeUndefined();
    expect(
      detail.readInitialRouteSnapshot({ enabled: true })?.lastMessageId,
    ).toBe("without-scroll");
    expect(
      detail.readInitialRouteSnapshot({ enabled: true })?.scrollSnapshot,
    ).toBeUndefined();

    expect(
      detail.writeInitialRouteSnapshot(routeSnapshot("with-scroll"), {
        enabled: true,
        retainScrollSnapshot: true,
      }),
    ).toBe(true);
    expect(
      detail.readInitialRouteSnapshot({ enabled: true })?.lastMessageId,
    ).toBe("with-scroll");
    expect(
      detail.readInitialRouteSnapshot({ enabled: true })?.scrollSnapshot
        ?.scrollTop,
    ).toBe(12);
  });

  it("persists current route snapshots through explicit cache policy", () => {
    const detail = coordinator();

    expect(
      detail.writeCurrentRouteSnapshot({
        enabled: true,
        retainScrollSnapshot: true,
        scrollSnapshot: scrollSnapshot(36),
      }),
    ).toBe(false);

    expect(detail.replaceRouteSnapshot(routeSnapshot("current"))).toBe(true);

    expect(
      detail.writeCurrentRouteSnapshot({
        enabled: false,
        retainScrollSnapshot: true,
        scrollSnapshot: scrollSnapshot(36),
      }),
    ).toBe(false);
    expect(detail.readRouteSnapshot()?.scrollSnapshot?.scrollTop).toBe(12);

    expect(
      detail.writeCurrentRouteSnapshot({
        enabled: true,
        retainScrollSnapshot: true,
        scrollSnapshot: scrollSnapshot(36),
      }),
    ).toBe(true);
    expect(detail.readRouteSnapshot()?.lastMessageId).toBe("current");
    expect(detail.readRouteSnapshot()?.scrollSnapshot?.scrollTop).toBe(36);

    expect(
      detail.writeCurrentRouteSnapshot({
        enabled: true,
        retainScrollSnapshot: false,
        scrollSnapshot: scrollSnapshot(48),
      }),
    ).toBe(true);
    expect(detail.readRouteSnapshot()?.scrollSnapshot).toBeUndefined();
  });

  it("cleans route snapshots by persisting or deleting the entry", () => {
    const detail = coordinator();

    expect(
      detail.cleanupCurrentRouteSnapshot({
        enabled: true,
        retainScrollSnapshot: true,
        scrollSnapshot: scrollSnapshot(24),
      }),
    ).toBe(false);
    expect(detail.readRouteSnapshot()).toBeUndefined();

    expect(detail.replaceRouteSnapshot(routeSnapshot("persisted"))).toBe(true);
    expect(
      detail.cleanupCurrentRouteSnapshot({
        enabled: true,
        retainScrollSnapshot: true,
        scrollSnapshot: scrollSnapshot(36),
      }),
    ).toBe(true);
    expect(detail.readRouteSnapshot()?.lastMessageId).toBe("persisted");
    expect(detail.readRouteSnapshot()?.scrollSnapshot?.scrollTop).toBe(36);

    expect(detail.replaceRouteSnapshot(routeSnapshot("deleted"))).toBe(true);
    expect(
      detail.cleanupCurrentRouteSnapshot({
        enabled: false,
        retainScrollSnapshot: true,
        scrollSnapshot: scrollSnapshot(48),
      }),
    ).toBe(false);
    expect(detail.readRouteSnapshot()).toBeUndefined();
  });

  it("loads a cold persisted transcript for initial load", () => {
    const detail = coordinator();
    const responsePagination = pagination(2);
    const applied = detail.applyInitialLoad(
      sessionResponse(
        [message("cold-a"), message("cold-b")],
        responsePagination,
      ),
    );

    expect(applied).toEqual({
      messageCount: 2,
      pagination: responsePagination,
      sourceMessageCount: 2,
    });
    expect(
      detail.readSelected(selectSessionDetailMessages)?.map(({ uuid }) => uuid),
    ).toEqual(["cold-a", "cold-b"]);
  });

  it("builds initial load progress values without owning timing", () => {
    const detail = coordinator();
    const responsePagination = pagination(2);
    const response = sessionResponse(
      [message("progress-a"), message("progress-b")],
      responsePagination,
    );
    const applied = {
      messageCount: 3,
      pagination: responsePagination,
      sourceMessageCount: 2,
    };

    expect(detail.buildLoadProgress("fetching", { nowMs: 10 })).toEqual({
      stage: "fetching",
      updatedAtMs: 10,
    });
    expect(
      detail.buildDataLoadProgress("rendering", response, { nowMs: 11 }),
    ).toEqual({
      stage: "rendering",
      messageCount: 2,
      totalMessageCount: 2,
      hasOlderMessages: false,
      updatedAtMs: 11,
    });
    expect(
      detail.buildAppliedLoadProgress("rendering", applied, { nowMs: 12 }),
    ).toEqual({
      stage: "rendering",
      messageCount: 3,
      totalMessageCount: 2,
      hasOlderMessages: false,
      updatedAtMs: 12,
    });
    expect(
      detail.buildRouteSnapshotLoadProgress("complete", routeSnapshot("snap"), {
        messageCount: 1,
        nowMs: 13,
      }),
    ).toEqual({
      stage: "complete",
      messageCount: 1,
      totalMessageCount: 1,
      hasOlderMessages: false,
      updatedAtMs: 13,
    });
  });

  it("builds initial load perf details without marking phases", () => {
    const detail = coordinator();
    const responsePagination = pagination(2);
    const response = sessionResponse(
      [message("perf-a"), message("perf-b")],
      responsePagination,
    );
    const snapshot = routeSnapshot("perf-snapshot");

    expect(
      detail.buildInitialLoadStartPerfDetail({
        projectId: "proj-1",
        sessionId: "sess-1",
        tailCompactions: 2,
        tailTurns: 8,
        tailFrom: "turn-1",
        restoredFromSnapshot: true,
      }),
    ).toEqual({
      projectId: "proj-1",
      sessionId: "sess-1",
      tailCompactions: 2,
      tailTurns: 8,
      tailFrom: "turn-1",
      restoredFromSnapshot: true,
    });
    expect(
      detail.buildInitialLoadDataReadyPerfDetail(response, {
        restoredFromSnapshot: true,
        appliedAfterSnapshotHydration: true,
      }),
    ).toEqual({
      messages: 2,
      provider: "claude",
      totalMessages: 2,
      hasOlderMessages: false,
      restoredFromSnapshot: true,
      appliedAfterSnapshotHydration: true,
    });
    expect(
      detail.buildInitialMessagesQueuedPerfDetail({
        snapshot,
        sourceMessageCount: 2,
        provider: "claude",
        restoredFromSnapshot: true,
      }),
    ).toEqual({
      messages: 2,
      totalMessages: 1,
      provider: "claude",
      restoredFromSnapshot: true,
    });
    expect(
      detail.buildInitialLoadCompletePerfDetail(2, {
        restoredFromSnapshot: true,
      }),
    ).toEqual({
      messages: 2,
      restoredFromSnapshot: true,
    });
    expect(
      detail.buildInitialLoadErrorPerfDetail(new Error("boom")),
    ).toEqual({
      message: "boom",
    });
  });

  it("builds initial reveal completion bundles", () => {
    const detail = coordinator();
    const snapshot = routeSnapshot("completion");

    expect(
      detail.buildInitialRevealCompletion({
        snapshot,
        sourceMessageCount: 2,
        provider: "claude",
        restoredFromSnapshot: true,
        nowMs: 14,
      }),
    ).toEqual({
      snapshot,
      messagesQueuedPerfDetail: {
        messages: 2,
        totalMessages: 1,
        provider: "claude",
        restoredFromSnapshot: true,
      },
      loadCompleteProgress: {
        stage: "complete",
        messageCount: 1,
        totalMessageCount: 1,
        hasOlderMessages: false,
        updatedAtMs: 14,
      },
      loadCompletePerfDetail: {
        messages: 2,
        restoredFromSnapshot: true,
      },
    });
  });

  it("builds warm hydration reveal inputs from hook-supplied cursors", () => {
    const detail = coordinator();
    const responsePagination = pagination(2);
    const retainedScroll = scrollSnapshot(72);

    expect(
      detail.buildWarmHydrationRevealInput({
        loadedSession: session(),
        loadedPagination: responsePagination,
        lastMessageId: "last-warm",
        scrollSnapshot: retainedScroll,
      }),
    ).toEqual({
      session: session(),
      pagination: responsePagination,
      lastMessageId: "last-warm",
      scrollSnapshot: retainedScroll,
    });
  });

  it("builds reveal inputs from hook-supplied cursors", () => {
    const detail = coordinator();
    const responsePagination = pagination(2);
    const retainedScroll = scrollSnapshot(80);

    expect(
      detail.buildRevealInput({
        session: session(),
        pagination: responsePagination,
        lastMessageId: "last-load",
        scrollSnapshot: retainedScroll,
      }),
    ).toEqual({
      session: session(),
      pagination: responsePagination,
      lastMessageId: "last-load",
      scrollSnapshot: retainedScroll,
    });
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
    expect(detail.getCacheableRevealSnapshot(reveal)).toBe(reveal.snapshot);
  });

  it("writes cacheable reveal snapshots through explicit cache policy", () => {
    const detail = coordinator();

    detail.replaceRouteSnapshot(routeSnapshot("stored"));

    const reveal = detail.buildRevealSnapshot({
      session: session(),
      pagination: pagination(1),
      lastMessageId: "fallback",
      scrollSnapshot: scrollSnapshot(96),
    });

    expect(
      detail.writeCacheableRevealSnapshot(reveal, {
        enabled: false,
        retainScrollSnapshot: true,
      }),
    ).toBe(false);
    expect(detail.readRouteSnapshot()?.scrollSnapshot?.scrollTop).toBe(12);

    expect(
      detail.writeCacheableRevealSnapshot(reveal, {
        enabled: true,
        retainScrollSnapshot: false,
      }),
    ).toBe(true);
    expect(detail.readRouteSnapshot()?.lastMessageId).toBe("stored");
    expect(detail.readRouteSnapshot()?.scrollSnapshot).toBeUndefined();
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
    expect(detail.getCacheableRevealSnapshot(reveal)).toBeUndefined();
    expect(
      detail.writeCacheableRevealSnapshot(reveal, {
        enabled: true,
        retainScrollSnapshot: true,
      }),
    ).toBe(false);
    expect(detail.readRouteSnapshot()).toBeUndefined();
  });

  it("builds load-complete callback payloads from session results", () => {
    const detail = coordinator();
    const response = sessionResponse([message("loaded")], pagination(1));

    expect(detail.buildLoadCompleteResult(response)).toEqual({
      session: response.session,
      status: response.ownership,
      pendingInputRequest: response.pendingInputRequest,
      slashCommands: response.slashCommands,
      deferredMessages: response.deferredMessages,
    });
  });

  it("builds provider runtime status snapshot payloads", () => {
    const detail = coordinator();

    expect(
      detail.buildProviderRuntimeStatusSnapshot({
        providerRuntimeStatus: RUNTIME_STATUS,
      }),
    ).toEqual({
      sessionId: "sess-1",
      projectId: "proj-1",
      providerRuntimeStatus: RUNTIME_STATUS,
    });

    expect(detail.buildProviderRuntimeStatusSnapshot({})).toEqual({
      sessionId: "sess-1",
      projectId: "proj-1",
      providerRuntimeStatus: null,
    });
  });
});
