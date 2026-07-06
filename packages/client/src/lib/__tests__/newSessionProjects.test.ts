import { describe, expect, it } from "vitest";
import type { Project } from "../../types";
import {
  findProjectByInput,
  normalizeProjectInput,
  sortProjectsForChooser,
} from "../newSessionProjects";

function project(
  id: string,
  name: string,
  path: string,
  lastActivity: string | null,
): Project {
  return {
    id,
    name,
    path,
    lastActivity,
    sessionCount: 0,
    activeOwnedCount: 0,
    activeExternalCount: 0,
  };
}

describe("new session project helpers", () => {
  it("sorts recent projects first, then activity, name, and path", () => {
    const projects = [
      project("old", "Zulu", "/work/zulu", "2026-07-01T10:00:00.000Z"),
      project("recent-2", "Alpha", "/work/alpha", null),
      project("active", "Beta", "/work/beta", "2026-07-05T10:00:00.000Z"),
      project("recent-1", "Gamma", "/work/gamma", "2026-07-02T10:00:00.000Z"),
    ];

    expect(
      sortProjectsForChooser(projects, ["recent-1", "recent-2"]).map(
        (item) => item.id,
      ),
    ).toEqual(["recent-1", "recent-2", "active", "old"]);
  });

  it("normalizes typed project input before matching paths or unique names", () => {
    const projects = [
      project("alpha", "Alpha", "/work/alpha", null),
      project("duplicate-a", "Shared", "/work/shared-a", null),
      project("duplicate-b", "Shared", "/work/shared-b", null),
    ];

    expect(normalizeProjectInput("  /work/alpha/  ")).toBe("/work/alpha");
    expect(findProjectByInput(projects, "/work/alpha/")?.id).toBe("alpha");
    expect(findProjectByInput(projects, "alpha")?.id).toBe("alpha");
    expect(findProjectByInput(projects, "shared")).toBeNull();
    expect(findProjectByInput(projects, " ")).toBeNull();
  });
});
