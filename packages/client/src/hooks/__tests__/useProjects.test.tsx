import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../types";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjects: vi.fn(),
  activityBusOn: vi.fn(() => () => {}),
  useFileActivity: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: {
    getProject: mocks.getProject,
    getProjects: mocks.getProjects,
  },
}));

vi.mock("../../lib/activityBus", () => ({
  activityBus: {
    on: mocks.activityBusOn,
  },
}));

vi.mock("../useFileActivity", () => ({
  useFileActivity: mocks.useFileActivity,
}));

import { resetSessionCollectionStoreForTests } from "../../lib/sessionCollectionExternalStore";
import { useProject, useProjects } from "../useProjects";

const RECENT = "2026-06-27T11:00:00.000Z";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    path: `/tmp/${id}`,
    name: `Project ${id}`,
    sessionCount: 1,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    projectQueueBlockingCount: 0,
    lastActivity: RECENT,
    ...overrides,
  };
}

beforeEach(() => {
  resetSessionCollectionStoreForTests();
  mocks.getProject.mockReset();
  mocks.getProjects.mockReset();
  mocks.activityBusOn.mockClear();
  mocks.useFileActivity.mockClear();
});

afterEach(() => {
  cleanup();
  resetSessionCollectionStoreForTests();
});

describe("useProjects", () => {
  it("feeds project list responses into the collection store", async () => {
    mocks.getProjects.mockResolvedValue({
      projects: [project("project-a"), project("project-b")],
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.projects.map((row) => row.id)).toEqual([
      "project-a",
      "project-b",
    ]);
    expect(mocks.getProjects).toHaveBeenCalledTimes(1);
  });

  it("shares collection-backed project facts between list and detail hooks", async () => {
    mocks.getProjects.mockResolvedValue({
      projects: [project("project-a", { name: "List Project" })],
    });
    mocks.getProject.mockResolvedValue({
      project: project("project-a", {
        name: "Detail Project",
        sessionCount: 2,
      }),
    });

    const list = renderHook(() => useProjects());
    await waitFor(() => expect(list.result.current.loading).toBe(false));
    expect(list.result.current.projects[0]?.name).toBe("List Project");

    const detail = renderHook(() => useProject("project-a"));
    await waitFor(() => expect(detail.result.current.loading).toBe(false));

    expect(detail.result.current.project).toMatchObject({
      id: "project-a",
      name: "Detail Project",
      sessionCount: 2,
    });
    await waitFor(() =>
      expect(list.result.current.projects[0]?.name).toBe("Detail Project"),
    );
  });
});
