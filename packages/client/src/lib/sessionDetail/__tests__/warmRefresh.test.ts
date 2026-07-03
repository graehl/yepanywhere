import { describe, expect, it } from "vitest";
import type { PaginationInfo } from "../../../api/client";
import type { Message, SessionMetadata } from "../../../types";
import type { SessionRouteSnapshot } from "../../sessionRouteSnapshots";
import {
  prepareWarmRefreshAfterHydration,
  prepareWarmRefreshBeforeHydration,
} from "../warmRefresh";

function message(uuid: string): Message {
  return {
    uuid,
    type: "user",
    timestamp: "2026-07-03T00:00:00.000Z",
    message: { role: "user", content: uuid },
  };
}

function session(id = "session-a"): SessionMetadata {
  return {
    id,
    projectId: "project-a" as SessionMetadata["projectId"],
    title: id,
    fullTitle: id,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    messageCount: 1,
    ownership: { owner: "self", processId: "pid-a" },
    provider: "claude",
  };
}

function pagination(
  returnedMessageCount: number,
  options: Partial<PaginationInfo> = {},
): PaginationInfo {
  return {
    hasOlderMessages: false,
    totalMessageCount: returnedMessageCount,
    returnedMessageCount,
    totalCompactions: 0,
    ...options,
  };
}

function snapshot({
  messages,
  lastMessageId,
  pagination: snapshotPagination,
}: {
  messages: Message[];
  lastMessageId?: string;
  pagination?: PaginationInfo;
}): SessionRouteSnapshot {
  return {
    messages,
    session: session(),
    pagination: snapshotPagination,
    agentContent: {},
    toolUseToAgentEntries: [],
    lastMessageId,
    maxPersistedTimestampMs: 0,
  };
}

describe("warm refresh preparation", () => {
  it("merges a pre-hydration delta onto a cursor-backed warm snapshot", () => {
    const prepared = prepareWarmRefreshBeforeHydration({
      warmLoad: snapshot({
        messages: [message("warm-1")],
        lastMessageId: "warm-1",
        pagination: pagination(1),
      }),
      refreshMessages: [message("delta-1")],
      refreshSession: session(),
    });

    expect(prepared.taggedMessages.map((item) => item._source)).toEqual([
      "jsonl",
    ]);
    expect(prepared.mergedMessages.map((item) => item.uuid)).toEqual([
      "warm-1",
      "delta-1",
    ]);
  });

  it("uses the refresh window before hydration when the warm snapshot has no cursor", () => {
    const prepared = prepareWarmRefreshBeforeHydration({
      warmLoad: snapshot({
        messages: [message("stale-warm")],
        pagination: pagination(1),
      }),
      refreshMessages: [message("fresh-1")],
      refreshSession: session(),
    });

    expect(prepared.mergedMessages.map((item) => item.uuid)).toEqual([
      "fresh-1",
    ]);
  });

  it("uses the latest hydrated store snapshot as the after-hydration merge base", () => {
    const prepared = prepareWarmRefreshAfterHydration({
      warmLoad: snapshot({
        messages: [message("warm-1")],
        lastMessageId: "warm-1",
        pagination: pagination(1),
      }),
      latestSnapshot: {
        messages: [message("warm-1"), message("live-1")],
      },
      refreshMessages: [message("delta-1")],
      refreshSession: session(),
    });

    expect(prepared.mergedMessages.map((item) => item.uuid)).toEqual([
      "warm-1",
      "live-1",
      "delta-1",
    ]);
  });
});
