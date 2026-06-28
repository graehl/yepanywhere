import type { ProjectQueueItemSummary } from "@yep-anywhere/shared";
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
  updateProjectQueueItem: vi.fn(),
  deleteProjectQueueItem: vi.fn(),
  retryProjectQueueItem: vi.fn(),
}));
const versionMock = vi.hoisted(() => ({
  version: { capabilities: ["projectQueue"] as string[] },
}));

vi.mock("../../api/client", () => ({
  api: apiMock,
}));

vi.mock("../../lib/activityBus", () => ({
  activityBus: { on: busMock.on },
}));

vi.mock("../useVersion", () => ({
  useVersion: () => ({ version: versionMock.version }),
}));

import { resetSessionCollectionStoreForTests } from "../../lib/sessionCollectionExternalStore";
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

beforeEach(() => {
  resetSessionCollectionStoreForTests();
  versionMock.version = { capabilities: ["projectQueue"] };
  busMock.reset();
  busMock.on.mockClear();
  apiMock.getProjectQueue.mockReset();
  apiMock.updateProjectQueueItem.mockReset();
  apiMock.deleteProjectQueueItem.mockReset();
  apiMock.retryProjectQueueItem.mockReset();
});

afterEach(() => {
  cleanup();
  resetSessionCollectionStoreForTests();
});

describe("useProjectQueues", () => {
  it("stays idle without the project queue server capability", async () => {
    versionMock.version = { capabilities: [] };

    const { result } = renderHook(() => useProjectQueues(["project-1"]));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(apiMock.getProjectQueue).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it("fetches queues for the supplied projects", async () => {
    apiMock.getProjectQueue.mockImplementation(async (projectId: string) => ({
      projectId,
      items: [
        makeItem(
          projectId === "project-1" ? "1" : "2",
          projectId === "project-1" ? PROJECT_ID : PROJECT_ID_2,
        ),
      ],
    }));

    const { result } = renderHook(() =>
      useProjectQueues(["project-1", "project-2"]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(apiMock.getProjectQueue).toHaveBeenCalledWith("project-1");
    expect(apiMock.getProjectQueue).toHaveBeenCalledWith("project-2");
    expect(result.current.items.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("updates a project queue from activity events", async () => {
    apiMock.getProjectQueue.mockResolvedValue({
      projectId: PROJECT_ID,
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
    apiMock.getProjectQueue.mockResolvedValue({
      projectId: PROJECT_ID,
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
    apiMock.getProjectQueue.mockResolvedValue({
      projectId: PROJECT_ID,
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
});
