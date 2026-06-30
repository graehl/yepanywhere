// @vitest-environment jsdom

import type {
  ProjectQueueItemSummary,
  ProjectQueueRecoveredSessionQueueSummary,
} from "@yep-anywhere/shared";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const busMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => handlers.get(event)?.delete(handler);
    }),
    emit(event: string, payload?: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    reset() {
      handlers.clear();
    },
  };
});

const apiMock = vi.hoisted(() => ({
  getProjectQueue: vi.fn(),
  getProjectQueueItems: vi.fn(),
  updateProjectQueueItem: vi.fn(),
  deleteProjectQueueItem: vi.fn(),
  retryProjectQueueItem: vi.fn(),
  moveProjectQueueItemToTop: vi.fn(),
  pauseProjectQueueDispatch: vi.fn(),
  resumeProjectQueueDispatch: vi.fn(),
}));
const versionMock = vi.hoisted(() => ({
  version: { capabilities: ["projectQueue"] as string[] },
}));
const connectionMock = vi.hoisted(() => ({
  isRemoteClient: vi.fn(() => false),
  remoteState: {
    connection: null as { connection: object | null } | null,
  },
}));

vi.mock("../../api/client", () => ({
  api: apiMock,
}));

vi.mock("../../lib/activityBus", () => ({
  activityBus: { on: busMock.on },
}));

vi.mock("../../lib/connection", () => ({
  isRemoteClient: connectionMock.isRemoteClient,
}));

vi.mock("../../contexts/RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => connectionMock.remoteState.connection,
}));

vi.mock("../useVersion", () => ({
  useVersion: () => ({ version: versionMock.version }),
}));

import { resetClientQueryControllerForTests } from "../../lib/clientQueryController";
import { resetClientSummaryStoreForTests } from "../../lib/clientSummaryStore";
import { useProjectQueues } from "../useProjectQueues";

const PROJECT_ID = "project-1" as ProjectQueueItemSummary["projectId"];
const PROJECT_ID_2 = "project-2" as ProjectQueueItemSummary["projectId"];

function makeItem(
  id: string,
  projectId: ProjectQueueItemSummary["projectId"] = PROJECT_ID,
  status: ProjectQueueItemSummary["status"] = "queued",
): ProjectQueueItemSummary {
  return {
    id,
    projectId,
    target: { type: "existing-session", sessionId: "session-1" },
    messagePreview: `Message ${id}`,
    message: { text: `Message ${id}` },
    createdAt: `2026-06-27T00:00:0${id}.000Z`,
    updatedAt: `2026-06-27T00:00:0${id}.000Z`,
    status,
    attachmentCount: 0,
  };
}

function makeRecoveredSessionQueue(
  id: string,
  projectId: ProjectQueueRecoveredSessionQueueSummary["projectId"] = PROJECT_ID,
): ProjectQueueRecoveredSessionQueueSummary {
  return {
    id,
    tempId: `temp-${id}`,
    sessionId: `session-${id}`,
    projectId,
    content: `Recovered ${id}`,
    timestamp: `2026-06-30T00:00:0${id}.000Z`,
    queuedAt: `2026-06-30T00:00:0${id}.000Z`,
    createdAt: `2026-06-30T00:00:0${id}.000Z`,
    updatedAt: `2026-06-30T00:00:0${id}.000Z`,
    kind: "patient",
    status: "paused-after-restart",
  };
}

beforeEach(() => {
  resetClientSummaryStoreForTests();
  resetClientQueryControllerForTests();
  versionMock.version = { capabilities: ["projectQueue"] };
  busMock.reset();
  busMock.on.mockClear();
  apiMock.getProjectQueue.mockReset();
  apiMock.getProjectQueueItems.mockReset();
  apiMock.updateProjectQueueItem.mockReset();
  apiMock.deleteProjectQueueItem.mockReset();
  apiMock.retryProjectQueueItem.mockReset();
  apiMock.moveProjectQueueItemToTop.mockReset();
  apiMock.pauseProjectQueueDispatch.mockReset();
  apiMock.resumeProjectQueueDispatch.mockReset();
  connectionMock.isRemoteClient.mockReset();
  connectionMock.isRemoteClient.mockReturnValue(false);
  connectionMock.remoteState.connection = null;
});

afterEach(() => {
  cleanup();
  resetClientQueryControllerForTests();
  resetClientSummaryStoreForTests();
});

describe("useProjectQueues", () => {
  it("stays idle without the project queue server capability", async () => {
    versionMock.version = { capabilities: [] };

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(apiMock.getProjectQueue).not.toHaveBeenCalled();
    expect(apiMock.getProjectQueueItems).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it("fetches all queue items once for the supplied projects", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [
        makeItem("1", PROJECT_ID),
        makeItem("2", PROJECT_ID_2),
      ],
    });

    const { result } = renderHook(() =>
      useProjectQueues(["project-1", "project-2"]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(apiMock.getProjectQueueItems).toHaveBeenCalledTimes(1);
    expect(apiMock.getProjectQueue).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("exposes recovered session queues for the supplied projects", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [],
      recoveredSessionQueues: [
        makeRecoveredSessionQueue("1", PROJECT_ID),
        makeRecoveredSessionQueue("2", PROJECT_ID_2),
      ],
    });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recoveredSessionQueues).toMatchObject([
      {
        id: "1",
        projectId: PROJECT_ID,
        content: "Recovered 1",
        status: "paused-after-restart",
      },
    ]);
  });

  it("refetches recovered session queues after persistence changes", async () => {
    apiMock.getProjectQueueItems
      .mockResolvedValueOnce({
        items: [],
        recoveredSessionQueues: [makeRecoveredSessionQueue("1", PROJECT_ID)],
      })
      .mockResolvedValueOnce({
        items: [],
        recoveredSessionQueues: [makeRecoveredSessionQueue("3", PROJECT_ID)],
      });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() =>
      expect(
        result.current.recoveredSessionQueues.map((item) => item.id),
      ).toEqual(["1"]),
    );

    act(() => {
      busMock.emit("session-queue-persistence-changed", {
        type: "session-queue-persistence-changed",
        timestamp: "2026-06-30T00:00:10.000Z",
      });
    });

    await waitFor(
      () => expect(apiMock.getProjectQueueItems).toHaveBeenCalledTimes(2),
      { timeout: 1500 },
    );
    await waitFor(() =>
      expect(
        result.current.recoveredSessionQueues.map((item) => item.id),
      ).toEqual(["3"]),
    );
  });

  it("shares manual refetches across mounted consumers", async () => {
    apiMock.getProjectQueueItems
      .mockResolvedValueOnce({
        items: [makeItem("1", PROJECT_ID)],
      })
      .mockResolvedValueOnce({
        items: [makeItem("2", PROJECT_ID)],
      });

    const first = renderHook(() => useProjectQueues(["project-1"]));
    const second = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(apiMock.getProjectQueueItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.all([
        first.result.current.refetch(),
        second.result.current.refetch(),
      ]);
    });

    expect(apiMock.getProjectQueueItems).toHaveBeenCalledTimes(2);
    expect(first.result.current.items.map((item) => item.id)).toEqual(["2"]);
    expect(second.result.current.items.map((item) => item.id)).toEqual(["2"]);
  });

  it("updates a project queue from activity events", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [makeItem("1")],
    });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      busMock.emit("project-queue-changed", {
        type: "project-queue-changed",
        projectId: PROJECT_ID,
        items: [makeItem("2", PROJECT_ID, "failed")],
        reason: "failed",
        timestamp: "2026-06-27T00:00:10.000Z",
      });
    });

    await waitFor(() =>
      expect(result.current.items).toMatchObject([
        { id: "2", status: "failed" },
      ]),
    );
  });

  it("replaces state from delete and retry responses", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [makeItem("1")],
    });
    apiMock.deleteProjectQueueItem.mockResolvedValue({
      deleted: true,
      queue: { projectId: PROJECT_ID, items: [] },
    });
    apiMock.retryProjectQueueItem.mockResolvedValue({
      item: makeItem("2", PROJECT_ID),
      queue: { projectId: PROJECT_ID, items: [makeItem("2", PROJECT_ID)] },
    });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.deleteItem("project-1", "1");
    });

    expect(apiMock.deleteProjectQueueItem).toHaveBeenCalledWith(
      "project-1",
      "1",
    );
    await waitFor(() => expect(result.current.items).toEqual([]));

    await act(async () => {
      await result.current.retryItem("project-1", "2");
    });

    expect(apiMock.retryProjectQueueItem).toHaveBeenCalledWith(
      "project-1",
      "2",
    );
    expect(result.current.items.map((item) => item.id)).toEqual(["2"]);
  });

  it("replaces state from update responses", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [makeItem("1")],
    });
    apiMock.updateProjectQueueItem.mockResolvedValue({
      item: makeItem("1", PROJECT_ID),
      queue: {
        projectId: PROJECT_ID,
        items: [
          {
            ...makeItem("1", PROJECT_ID),
            messagePreview: "Edited message",
            message: { text: "Edited message" },
          },
        ],
      },
    });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.updateItem("project-1", "1", {
        message: { text: "Edited message" },
      });
    });

    expect(apiMock.updateProjectQueueItem).toHaveBeenCalledWith(
      "project-1",
      "1",
      { message: { text: "Edited message" } },
    );
    expect(result.current.items).toMatchObject([
      { id: "1", messagePreview: "Edited message" },
    ]);
  });

  it("preserves queue order from move-to-top responses", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [makeItem("1"), makeItem("2")],
    });
    apiMock.moveProjectQueueItemToTop.mockResolvedValue({
      item: makeItem("2", PROJECT_ID),
      queue: {
        projectId: PROJECT_ID,
        items: [makeItem("2", PROJECT_ID), makeItem("1", PROJECT_ID)],
      },
    });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => {
      await result.current.moveItemToTop("project-1", "2");
    });

    expect(apiMock.moveProjectQueueItemToTop).toHaveBeenCalledWith(
      "project-1",
      "2",
    );
    expect(result.current.items.map((item) => item.id)).toEqual(["2", "1"]);
  });

  it("updates dispatch state from pause and resume responses", async () => {
    apiMock.getProjectQueueItems.mockResolvedValue({
      items: [makeItem("1")],
      dispatchState: { status: "running" },
    });
    apiMock.pauseProjectQueueDispatch.mockResolvedValue({
      items: [makeItem("1")],
      dispatchState: {
        status: "paused",
        reason: "manual",
        pausedAt: "2026-06-30T00:00:00.000Z",
      },
    });
    apiMock.resumeProjectQueueDispatch.mockResolvedValue({
      items: [makeItem("1")],
      dispatchState: { status: "running" },
    });

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.pauseDispatch();
    });

    expect(result.current.dispatchState).toMatchObject({
      status: "paused",
      reason: "manual",
    });

    await act(async () => {
      await result.current.resumeDispatch();
    });

    expect(result.current.dispatchState).toEqual({ status: "running" });
  });
});
