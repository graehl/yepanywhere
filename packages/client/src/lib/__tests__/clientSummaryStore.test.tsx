import { act, cleanup, renderHook } from "@testing-library/react";
import type {
  ProviderRuntimeStatus,
  ProjectQueueItemSummary,
  UrlProjectId,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSessionItem, InboxItem } from "../../api/client";

type MockActivityCallback = (event: unknown) => void;

const mockActivityBus = vi.hoisted(() => {
  const listeners = new Map<string, Set<MockActivityCallback>>();
  const on = vi.fn((eventType: string, callback: MockActivityCallback) => {
    let set = listeners.get(eventType);
    if (!set) {
      set = new Set();
      listeners.set(eventType, set);
    }
    set.add(callback);
    return () => {
      set?.delete(callback);
    };
  });

  return {
    listeners,
    on,
    emit(eventType: string, event: unknown) {
      for (const callback of listeners.get(eventType) ?? []) {
        callback(event);
      }
    },
    listenerCount() {
      let count = 0;
      for (const set of listeners.values()) {
        count += set.size;
      }
      return count;
    },
  };
});

vi.mock("../activityBus", () => ({
  activityBus: {
    on: mockActivityBus.on,
  },
}));

import {
  createClientSummaryHostSourceKey,
  getClientSummarySnapshotForSource,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  reportGlobalSessionsCollectionSnapshot,
  reportInboxCollectionSnapshot,
  reportProviderRuntimeStatusSnapshot,
  reportSessionCollectionCreated,
  reportSessionCollectionMetadataChanged,
  resetClientSummaryStoreForTests,
  setCurrentClientSummarySourceKey,
  useActiveAgentCount,
  useActiveProjectSessionIds,
  useDraftSessionIds,
  useHasActiveAgents,
  useInboxCounts,
  useInboxCountsByProject,
  useInboxResponseSnapshot,
  useProjectQueuedSessionIds,
  useProviderRuntimeStatusForSession,
  useRecentSessionRecords,
  useSessionCollectionRecord,
  useStarredSessionRecords,
} from "../clientSummaryStore";
import { saveSessionDraft } from "../sessionDraftStorage";

const PROJECT_ID = "project-1" as UrlProjectId;
const RECENT = "2026-06-27T11:00:00.000Z";
const SOURCE_KEY = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
const RUNTIME_STATUS: Exclude<ProviderRuntimeStatus, null> = {
  kind: "retrying",
  provider: "claude",
  reason: "rate_limit",
  httpStatus: 429,
  startedAt: RECENT,
  lastSeenAt: RECENT,
  retryAt: "2026-06-27T12:00:00.000Z",
  retryDelayMs: 3_600_000,
  eventCount: 1,
  source: "claude.system.api_retry",
};

function globalSession(
  id: string,
  overrides: Partial<GlobalSessionItem> = {},
): GlobalSessionItem {
  return {
    id,
    title: `Session ${id}`,
    fullTitle: `Session ${id}`,
    createdAt: RECENT,
    updatedAt: RECENT,
    messageCount: 1,
    provider: "claude",
    projectId: PROJECT_ID,
    projectName: "Project",
    ownership: { owner: "none" },
    isArchived: false,
    isStarred: false,
    ...overrides,
  };
}

function inboxItem(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    sessionId: id,
    projectId: PROJECT_ID,
    projectName: "Project",
    sessionTitle: `Session ${id}`,
    updatedAt: RECENT,
    hasUnread: false,
    ...overrides,
  };
}

function queueItem(
  id: string,
  overrides: Partial<ProjectQueueItemSummary> = {},
): ProjectQueueItemSummary {
  return {
    id,
    projectId: PROJECT_ID,
    target: { type: "existing-session", sessionId: `session-${id}` },
    messagePreview: `Message ${id}`,
    message: { text: `Message ${id}` },
    createdAt: RECENT,
    updatedAt: RECENT,
    status: "queued",
    attachmentCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetClientSummaryStoreForTests();
  mockActivityBus.listeners.clear();
  mockActivityBus.on.mockClear();
});

afterEach(() => {
  cleanup();
  resetClientSummaryStoreForTests();
  mockActivityBus.listeners.clear();
  localStorage.clear();
  vi.useRealTimers();
});

describe("clientSummaryStore", () => {
  it("subscribes to activityBus once while hooks are mounted", () => {
    const first = renderHook(() => useRecentSessionRecords());
    expect(mockActivityBus.on).toHaveBeenCalledTimes(8);
    expect(mockActivityBus.listenerCount()).toBe(8);

    const second = renderHook(() => useSessionCollectionRecord("session-1"));
    expect(mockActivityBus.on).toHaveBeenCalledTimes(8);
    expect(mockActivityBus.listenerCount()).toBe(8);

    first.unmount();
    expect(mockActivityBus.listenerCount()).toBe(8);

    second.unmount();
    expect(mockActivityBus.listenerCount()).toBe(0);
  });

  it("stores provider runtime snapshots and clears from activity events", () => {
    const status = renderHook(() =>
      useProviderRuntimeStatusForSession("session-1"),
    );

    expect(status.result.current).toBe(null);

    act(() => {
      reportProviderRuntimeStatusSnapshot(SOURCE_KEY, {
        sessionId: "session-1",
        projectId: PROJECT_ID,
        providerRuntimeStatus: RUNTIME_STATUS,
      });
    });

    expect(status.result.current).toEqual(RUNTIME_STATUS);

    act(() => {
      mockActivityBus.emit("provider-runtime-status-changed", {
        type: "provider-runtime-status-changed",
        sessionId: "session-1",
        projectId: PROJECT_ID,
        providerRuntimeStatus: null,
        timestamp: "2026-06-27T12:00:00.000Z",
      });
    });

    expect(status.result.current).toBe(null);
  });

  it("reports snapshots and applies metadata events to projections", () => {
    const starred = renderHook(() => useStarredSessionRecords());
    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        SOURCE_KEY,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("session-1")],
          hasMore: false,
        },
        100,
      );
    });

    expect(recent.result.current.map((s) => s.id)).toEqual(["session-1"]);
    expect(starred.result.current).toEqual([]);

    act(() => {
      mockActivityBus.emit("session-metadata-changed", {
        type: "session-metadata-changed",
        sessionId: "session-1",
        starred: true,
        timestamp: "2026-06-27T12:00:01.000Z",
      });
    });

    expect(recent.result.current).toEqual([]);
    expect(starred.result.current.map((s) => s.id)).toEqual(["session-1"]);
  });

  it("isolates current-source session data across host switches", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        macbook,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("mac-session")],
          hasMore: false,
        },
        100,
      );
    });

    expect(recent.result.current.map((s) => s.id)).toEqual(["mac-session"]);

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    expect(recent.result.current).toEqual([]);

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    expect(recent.result.current.map((s) => s.id)).toEqual(["mac-session"]);
  });

  it("keeps late source-keyed snapshots out of the visible current source", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        macbook,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("late-mac-session")],
          hasMore: false,
        },
        100,
      );
    });

    expect(recent.result.current).toEqual([]);

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        winnative,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("win-session")],
          hasMore: false,
        },
        110,
      );
    });

    expect(recent.result.current.map((s) => s.id)).toEqual(["win-session"]);

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    expect(recent.result.current.map((s) => s.id)).toEqual([
      "late-mac-session",
    ]);
  });

  it("rerenders current-source hooks when the source changes", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
      reportGlobalSessionsCollectionSnapshot(
        macbook,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [
            globalSession("session-a", {
              projectName: "Mac Project",
            }),
          ],
          hasMore: false,
        },
        100,
      );
    });

    let renders = 0;
    const selected = renderHook(() => {
      renders += 1;
      return useSessionCollectionRecord("session-a")?.projectName ?? null;
    });

    expect(selected.result.current).toBe("Mac Project");
    const initialRenders = renders;

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    expect(selected.result.current).toBeNull();
    expect(renders).toBeGreaterThan(initialRenders);
    const afterWinnativeRenders = renders;

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    expect(selected.result.current).toBe("Mac Project");
    expect(renders).toBeGreaterThan(afterWinnativeRenders);
  });

  it("reduces stale activity callbacks into their retained source", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    const selected = renderHook(() =>
      useSessionCollectionRecord("stale-event-session"),
    );
    const staleCreatedCallbacks = [
      ...(mockActivityBus.listeners.get("session-created") ?? []),
    ];
    expect(staleCreatedCallbacks).toHaveLength(1);

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    act(() => {
      for (const callback of staleCreatedCallbacks) {
        callback({
          type: "session-created",
          session: {
            id: "stale-event-session",
            projectId: PROJECT_ID,
            title: "Stale event",
            fullTitle: "Stale event",
            createdAt: RECENT,
            updatedAt: RECENT,
            messageCount: 1,
            ownership: { owner: "none" },
            provider: "claude",
          },
          timestamp: RECENT,
        });
      }
    });

    expect(selected.result.current).toBeUndefined();

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    expect(selected.result.current?.id).toBe("stale-event-session");
  });

  it("reports inbox snapshots to React selectors", () => {
    const inbox = renderHook(() => useInboxResponseSnapshot());

    act(() => {
      reportInboxCollectionSnapshot(
        SOURCE_KEY,
        {
          needsAttention: [
            inboxItem("needs", { pendingInputType: "user-question" }),
          ],
          active: [inboxItem("active")],
          recentActivity: [],
          unread8h: [],
          unread24h: [],
        },
        100,
      );
    });

    expect(inbox.result.current.needsAttention).toMatchObject([
      {
        sessionId: "needs",
        pendingInputType: "user-question",
        activity: "waiting-input",
      },
    ]);
    expect(inbox.result.current.active).toMatchObject([
      {
        sessionId: "active",
        activity: "in-turn",
      },
    ]);
  });

  it("reports inbox snapshots to targeted count selectors", () => {
    const counts = renderHook(() => useInboxCounts());
    const byProject = renderHook(() => useInboxCountsByProject());
    const activeIds = renderHook(() => useActiveProjectSessionIds(PROJECT_ID));
    const activeCount = renderHook(() => useActiveAgentCount());
    const hasActive = renderHook(() => useHasActiveAgents());

    act(() => {
      reportInboxCollectionSnapshot(
        SOURCE_KEY,
        {
          needsAttention: [
            inboxItem("needs", { pendingInputType: "tool-approval" }),
          ],
          active: [inboxItem("active")],
          recentActivity: [inboxItem("recent")],
          unread8h: [],
          unread24h: [],
        },
        100,
      );
    });

    expect(counts.result.current).toEqual({
      needsAttention: 1,
      active: 1,
      total: 3,
    });
    expect(byProject.result.current.get(PROJECT_ID)).toEqual({
      needsAttention: 1,
      active: 1,
      total: 3,
    });
    expect(activeIds.result.current).toEqual(["needs", "active"]);
    expect(activeCount.result.current).toBe(1);
    expect(hasActive.result.current).toBe(true);
  });

  it("reports local metadata changes to derived projections", () => {
    const starred = renderHook(() => useStarredSessionRecords());
    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        SOURCE_KEY,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("session-1")],
          hasMore: false,
        },
        100,
      );
    });

    act(() => {
      reportSessionCollectionMetadataChanged(
        SOURCE_KEY,
        {
          type: "session-metadata-changed",
          sessionId: "session-1",
          starred: true,
          timestamp: "2026-06-27T12:00:01.000Z",
        },
        200,
      );
    });

    expect(recent.result.current).toEqual([]);
    expect(starred.result.current.map((s) => s.id)).toEqual(["session-1"]);
  });

  it("keeps locally created sessions through older empty snapshots", () => {
    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportSessionCollectionCreated(
        SOURCE_KEY,
        {
          type: "session-created",
          session: {
            id: "new-session",
            projectId: PROJECT_ID,
            title: null,
            fullTitle: null,
            createdAt: RECENT,
            updatedAt: RECENT,
            messageCount: 0,
            ownership: { owner: "self", processId: "process-1" },
            provider: "claude",
            activity: "in-turn",
          },
          timestamp: RECENT,
        },
        200,
      );
    });

    expect(recent.result.current.map((s) => s.id)).toEqual(["new-session"]);

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        SOURCE_KEY,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [],
          hasMore: false,
          mode: "replace",
        },
        100,
      );
    });

    expect(recent.result.current.map((s) => s.id)).toEqual(["new-session"]);
  });

  it("preserves unchanged record objects after unrelated updates", () => {
    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        SOURCE_KEY,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("session-a"), globalSession("session-b")],
          hasMore: false,
        },
        100,
      );
    });

    const before = getClientSummarySnapshotForSource(
      SOURCE_KEY,
    ).sessions.entities.get("session-a");
    expect(before).toBeDefined();

    act(() => {
      reportSessionCollectionMetadataChanged(
        SOURCE_KEY,
        {
          type: "session-metadata-changed",
          sessionId: "session-b",
          starred: true,
          timestamp: "2026-06-27T12:00:01.000Z",
        },
        200,
      );
    });

    const after = getClientSummarySnapshotForSource(SOURCE_KEY);
    expect(after.sessions.entities.get("session-a")).toBe(before);
  });

  it("does not rerender selected record hooks for unrelated record updates", () => {
    act(() => {
      reportGlobalSessionsCollectionSnapshot(
        SOURCE_KEY,
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("session-a"), globalSession("session-b")],
          hasMore: false,
        },
        100,
      );
    });

    let renders = 0;
    const selected = renderHook(() => {
      renders += 1;
      return useSessionCollectionRecord("session-a");
    });
    const before = selected.result.current;

    act(() => {
      reportSessionCollectionMetadataChanged(
        SOURCE_KEY,
        {
          type: "session-metadata-changed",
          sessionId: "session-b",
          starred: true,
          timestamp: "2026-06-27T12:00:01.000Z",
        },
        200,
      );
    });

    expect(selected.result.current).toBe(before);
    expect(renders).toBe(1);
  });

  it("applies project queue events to targeted session selectors", () => {
    const selected = renderHook(() => useProjectQueuedSessionIds([PROJECT_ID]));
    expect([...selected.result.current]).toEqual([]);

    act(() => {
      mockActivityBus.emit("project-queue-changed", {
        type: "project-queue-changed",
        projectId: PROJECT_ID,
        items: [
          queueItem("queue-1", {
            target: { type: "existing-session", sessionId: "session-a" },
          }),
        ],
        reason: "created",
        timestamp: "2026-06-27T12:00:01.000Z",
      });
    });

    expect([...selected.result.current]).toEqual(["session-a"]);
  });

  it("polls local draft ids only while draft decorations are mounted", () => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("draft-message-session-a", "draft text");

    const selected = renderHook(() => useDraftSessionIds());

    expect([...selected.result.current]).toEqual(["session-a"]);

    act(() => {
      localStorage.setItem("draft-message-session-b", "more draft text");
      vi.advanceTimersByTime(1000);
    });

    expect([...selected.result.current]).toEqual(["session-a", "session-b"]);

    selected.unmount();

    act(() => {
      localStorage.setItem("draft-message-session-c", "stale after unmount");
      vi.advanceTimersByTime(1000);
    });

    const snapshot = getClientSummarySnapshotForSource(SOURCE_KEY);
    expect([...snapshot.localDecorations.draftSessionIds]).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("keeps legacy local draft ids out of remote sources", () => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("draft-message-session-a", "draft text");
    const macbook = createClientSummaryHostSourceKey("macbook");

    let renders = 0;
    const selected = renderHook(() => {
      renders += 1;
      return useDraftSessionIds();
    });

    expect([...selected.result.current]).toEqual(["session-a"]);
    const initialRenders = renders;

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    expect([...selected.result.current]).toEqual([]);
    expect(renders).toBeGreaterThan(initialRenders);
    const afterMacbookRenders = renders;

    act(() => {
      localStorage.setItem("draft-message-session-b", "remote should ignore");
      vi.advanceTimersByTime(1000);
    });

    expect([...selected.result.current]).toEqual([]);

    act(() => {
      setCurrentClientSummarySourceKey(LOCAL_CLIENT_SUMMARY_SOURCE_KEY);
    });

    expect([...selected.result.current]).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(renders).toBeGreaterThan(afterMacbookRenders);
  });

  it("preserves indexed source-keyed remote draft storage", () => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("draft-message-local-session", "local draft");
    const macbook = createClientSummaryHostSourceKey("macbook");

    act(() => {
      saveSessionDraft(
        { sourceKey: macbook, sessionId: "remote-session" },
        "remote draft",
      );
      setCurrentClientSummarySourceKey(macbook);
    });

    const selected = renderHook(() => useDraftSessionIds());

    expect([...selected.result.current]).toEqual(["remote-session"]);

    act(() => {
      localStorage.setItem("draft-message-other-session", "local only");
      vi.advanceTimersByTime(1000);
    });

    expect([...selected.result.current]).toEqual(["remote-session"]);
  });

  it("loads indexed remote draft ids for the current source", () => {
    vi.useFakeTimers();
    localStorage.clear();
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    saveSessionDraft(
      { sourceKey: macbook, sessionId: "mac-draft-session" },
      "mac draft",
    );
    saveSessionDraft(
      { sourceKey: winnative, sessionId: "win-draft-session" },
      "win draft",
    );

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    const selected = renderHook(() => useDraftSessionIds());

    expect([...selected.result.current]).toEqual(["mac-draft-session"]);

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    expect([...selected.result.current]).toEqual(["win-draft-session"]);
  });
});
