import { act, cleanup, renderHook } from "@testing-library/react";
import type {
  ProjectQueueItemSummary,
  UrlProjectId,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSessionItem } from "../../api/client";

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
  getClientSummarySnapshot,
  reportGlobalSessionsCollectionSnapshot,
  reportSessionCollectionCreated,
  reportSessionCollectionMetadataChanged,
  resetClientSummaryStoreForTests,
  useDraftSessionIds,
  useProjectQueuedSessionIds,
  useRecentSessionRecords,
  useSessionCollectionRecord,
  useStarredSessionRecords,
} from "../clientSummaryStore";

const PROJECT_ID = "project-1" as UrlProjectId;
const RECENT = "2026-06-27T11:00:00.000Z";

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
    expect(mockActivityBus.on).toHaveBeenCalledTimes(7);
    expect(mockActivityBus.listenerCount()).toBe(7);

    const second = renderHook(() => useSessionCollectionRecord("session-1"));
    expect(mockActivityBus.on).toHaveBeenCalledTimes(7);
    expect(mockActivityBus.listenerCount()).toBe(7);

    first.unmount();
    expect(mockActivityBus.listenerCount()).toBe(7);

    second.unmount();
    expect(mockActivityBus.listenerCount()).toBe(0);
  });

  it("reports snapshots and applies metadata events to projections", () => {
    const starred = renderHook(() => useStarredSessionRecords());
    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
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

  it("reports local metadata changes to derived projections", () => {
    const starred = renderHook(() => useStarredSessionRecords());
    const recent = renderHook(() =>
      useRecentSessionRecords(Date.parse("2026-06-27T12:00:00.000Z")),
    );

    act(() => {
      reportGlobalSessionsCollectionSnapshot(
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
        {
          query: { scope: "global-sessions", limit: 50 },
          sessions: [globalSession("session-a"), globalSession("session-b")],
          hasMore: false,
        },
        100,
      );
    });

    const before = getClientSummarySnapshot().entities.get("session-a");
    expect(before).toBeDefined();

    act(() => {
      reportSessionCollectionMetadataChanged(
        {
          type: "session-metadata-changed",
          sessionId: "session-b",
          starred: true,
          timestamp: "2026-06-27T12:00:01.000Z",
        },
        200,
      );
    });

    expect(getClientSummarySnapshot().entities.get("session-a")).toBe(
      before,
    );
  });

  it("does not rerender selected record hooks for unrelated record updates", () => {
    act(() => {
      reportGlobalSessionsCollectionSnapshot(
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

    expect([
      ...getClientSummarySnapshot().localDecorations.draftSessionIds,
    ]).toEqual(["session-a", "session-b"]);
  });
});
