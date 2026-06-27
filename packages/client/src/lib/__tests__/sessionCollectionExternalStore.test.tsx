import { act, cleanup, renderHook } from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
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
  reportGlobalSessionsCollectionSnapshot,
  reportSessionCollectionCreated,
  reportSessionCollectionMetadataChanged,
  resetSessionCollectionStoreForTests,
  useRecentSessionRecords,
  useSessionCollectionRecord,
  useStarredSessionRecords,
} from "../sessionCollectionExternalStore";

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

beforeEach(() => {
  resetSessionCollectionStoreForTests();
  mockActivityBus.listeners.clear();
  mockActivityBus.on.mockClear();
});

afterEach(() => {
  cleanup();
  resetSessionCollectionStoreForTests();
  mockActivityBus.listeners.clear();
});

describe("sessionCollectionExternalStore", () => {
  it("subscribes to activityBus once while hooks are mounted", () => {
    const first = renderHook(() => useRecentSessionRecords());
    expect(mockActivityBus.on).toHaveBeenCalledTimes(6);
    expect(mockActivityBus.listenerCount()).toBe(6);

    const second = renderHook(() => useSessionCollectionRecord("session-1"));
    expect(mockActivityBus.on).toHaveBeenCalledTimes(6);
    expect(mockActivityBus.listenerCount()).toBe(6);

    first.unmount();
    expect(mockActivityBus.listenerCount()).toBe(6);

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
});
