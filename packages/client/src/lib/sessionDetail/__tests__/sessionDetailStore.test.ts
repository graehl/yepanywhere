import { toUrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  asClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "../../clientSummaryStore";
import type { SessionRouteSnapshot } from "../../sessionRouteSnapshots";
import {
  createSessionDetailStore,
  getSessionDetailStoreKey,
  type SessionDetailStoreKeyInput,
} from "../sessionDetailStore";

const SOURCE_A = asClientSummarySourceKey("host:a");
const SOURCE_B = asClientSummarySourceKey("host:b");
const PROJECT_ID = toUrlProjectId("/repo/project-a");

function key(
  sessionId: string,
  sourceKey: ClientSummarySourceKey = SOURCE_A,
): SessionDetailStoreKeyInput {
  return {
    sourceKey,
    projectId: "project-a",
    sessionId,
  };
}

function snapshot(
  sessionId: string,
  messageIds: readonly string[],
): SessionRouteSnapshot {
  return {
    messages: messageIds.map((uuid) => ({
      uuid,
      type: "user",
      timestamp: "2026-06-30T00:00:00.000Z",
      message: { role: "user", content: uuid },
    })),
    session: {
      id: sessionId,
      projectId: PROJECT_ID,
      provider: "claude",
      title: sessionId,
      fullTitle: sessionId,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      messageCount: messageIds.length,
      ownership: { owner: "none" },
    },
    agentContent: {},
    toolUseToAgentEntries: [],
    lastMessageId: messageIds[messageIds.length - 1],
    maxPersistedTimestampMs: 0,
  };
}

describe("SessionDetailStore", () => {
  it("stores route snapshots under source-scoped keys with stats", () => {
    const store = createSessionDetailStore();
    const storeKey = key("session-a");

    expect(
      store.writeRouteSnapshot(storeKey, snapshot("session-a", ["msg-1"]), {
        nowMs: 10,
      }),
    ).toBe(true);

    expect(store.readRouteSnapshot(storeKey, { nowMs: 11 })?.lastMessageId).toBe(
      "msg-1",
    );
    expect(store.readRouteSnapshot(key("session-a", SOURCE_B))).toBeUndefined();
    expect(getSessionDetailStoreKey(storeKey)).toBe(
      "host%3Aa:project-a:session-a",
    );

    const stats = store.getStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.approxBytes).toBeGreaterThan(0);
    expect(stats.entries[0]).toMatchObject({
      key: "host%3Aa:project-a:session-a",
      sourceKey: SOURCE_A,
      projectId: "project-a",
      sessionId: "session-a",
      messageCount: 1,
      retainCount: 0,
      createdAt: 10,
      updatedAt: 10,
      lastAccessedAt: 11,
    });
  });

  it("notifies selector subscribers only when the selected value changes", () => {
    const store = createSessionDetailStore();
    const storeKey = key("session-a");
    let notifications = 0;
    const unsubscribe = store.subscribe(
      storeKey,
      (state) => state?.messages.length ?? 0,
      () => {
        notifications += 1;
      },
    );

    store.writeRouteSnapshot(storeKey, snapshot("session-a", ["msg-1"]));
    expect(notifications).toBe(1);

    store.writeRouteSnapshot(storeKey, snapshot("session-a", ["msg-2"]));
    expect(notifications).toBe(1);

    store.writeRouteSnapshot(
      storeKey,
      snapshot("session-a", ["msg-2", "msg-3"]),
    );
    expect(notifications).toBe(2);

    unsubscribe();
    store.writeRouteSnapshot(
      storeKey,
      snapshot("session-a", ["msg-2", "msg-3", "msg-4"]),
    );
    expect(notifications).toBe(2);
  });

  it("patches scroll snapshots without notifying ordinary subscribers", () => {
    const store = createSessionDetailStore();
    const storeKey = key("session-a");
    let notifications = 0;

    store.writeRouteSnapshot(storeKey, snapshot("session-a", ["msg-1"]));
    store.subscribe(
      storeKey,
      (state) => state?.scrollSnapshot?.scrollTop ?? -1,
      () => {
        notifications += 1;
      },
    );

    store.patchScrollSnapshot(storeKey, {
      atBottom: true,
      scrollTop: 42,
      scrollHeight: 400,
      clientHeight: 200,
      updatedAtMs: 10,
    });

    expect(notifications).toBe(0);
    expect(store.readRouteSnapshot(storeKey)?.scrollSnapshot?.scrollTop).toBe(
      42,
    );

    store.patchScrollSnapshot(
      storeKey,
      {
        atBottom: false,
        scrollTop: 100,
        scrollHeight: 400,
        clientHeight: 200,
        updatedAtMs: 20,
      },
      { notify: true },
    );

    expect(notifications).toBe(1);
  });

  it("retains entries through expiry until released", () => {
    const store = createSessionDetailStore();
    const storeKey = key("session-a");

    store.writeRouteSnapshot(storeKey, snapshot("session-a", ["msg-1"]), {
      ttlMs: 10,
      nowMs: 0,
    });
    store.retain(storeKey, { ttlMs: 10, nowMs: 1 });

    expect(store.evictExpired({ nowMs: 11 })).toBe(0);
    expect(store.readRouteSnapshot(storeKey, { nowMs: 11 })).toBeDefined();

    store.release(storeKey, { ttlMs: 10, nowMs: 12 });

    expect(store.evictExpired({ nowMs: 21 })).toBe(0);
    expect(store.evictExpired({ nowMs: 23 })).toBe(1);
    expect(store.readRouteSnapshot(storeKey, { nowMs: 23 })).toBeUndefined();
  });

  it("keeps retained entries out of LRU eviction candidates", () => {
    const store = createSessionDetailStore();

    store.writeRouteSnapshot(key("one"), snapshot("one", ["one"]), {
      maxEntries: 2,
      nowMs: 0,
    });
    store.retain(key("one"), { nowMs: 1 });
    store.writeRouteSnapshot(key("two"), snapshot("two", ["two"]), {
      maxEntries: 2,
      nowMs: 2,
    });
    store.writeRouteSnapshot(key("three"), snapshot("three", ["three"]), {
      maxEntries: 2,
      nowMs: 3,
    });

    expect(store.readRouteSnapshot(key("one"), { nowMs: 4 })).toBeDefined();
    expect(store.readRouteSnapshot(key("two"), { nowMs: 4 })).toBeUndefined();
    expect(store.readRouteSnapshot(key("three"), { nowMs: 4 })).toBeDefined();
  });
});
