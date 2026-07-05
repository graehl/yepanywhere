import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  type StoredWorkstream,
  type UrlProjectId,
  type WorkstreamId,
  mainWorkstreamId,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createWorkstreamRoutes } from "../../src/routes/workstreams.js";
import type { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { WorkstreamService } from "../../src/services/WorkstreamService.js";
import type { Project } from "../../src/supervisor/types.js";

const NOW = "2026-07-05T10:00:00.000Z";
const PROJECT_PATH = "/tmp/workstream-route-project";

describe("Workstream Routes", () => {
  let testDir: string;
  let projectId: UrlProjectId;
  let project: Project;
  let workstreamService: WorkstreamService;
  let scanner: Pick<ProjectScanner, "getOrCreateProject">;
  let workstreamsEnabled: boolean;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "workstream-routes-"));
    projectId = toUrlProjectId(PROJECT_PATH);
    project = {
      id: projectId,
      path: PROJECT_PATH,
      name: "workstream-route-project",
      sessionCount: 0,
      sessionDir: "/tmp/workstream-route-project/.claude-sessions",
      activeOwnedCount: 0,
      activeExternalCount: 0,
      lastActivity: null,
      provider: "claude",
    };
    scanner = {
      getOrCreateProject: vi.fn(async (id) =>
        id === projectId ? project : null,
      ),
    };
    workstreamsEnabled = true;
    workstreamService = new WorkstreamService({
      dataDir: testDir,
      now: () => new Date(NOW),
    });
    await workstreamService.initialize();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createRoutes() {
    const serverSettingsService = {
      getSetting: vi.fn((key: string) =>
        key === "workstreamsEnabled" ? workstreamsEnabled : undefined,
      ),
    } as unknown as ServerSettingsService;

    return createWorkstreamRoutes({
      scanner: scanner as ProjectScanner,
      serverSettingsService,
      workstreamService,
    });
  }

  function makeWorkstream(
    overrides: Partial<StoredWorkstream> = {},
  ): StoredWorkstream {
    return {
      id: "ws-tools" as WorkstreamId,
      projectId,
      label: "tools cleanup",
      kind: "checkout",
      path: "/tmp/workstream-route-project-tools",
      branch: "main",
      baseBranch: "main",
      baseCommit: null,
      managedByYa: true,
      queuePaused: false,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  it("hides the route when workstreams are disabled", async () => {
    workstreamsEnabled = false;

    const response = await createRoutes().request(`/${projectId}/workstreams`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Workstreams are not enabled",
    });
    expect(scanner.getOrCreateProject).not.toHaveBeenCalled();
  });

  it("rejects invalid project ids", async () => {
    const response = await createRoutes().request("/not a project/workstreams");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid project ID format",
    });
  });

  it("returns not found for unknown projects", async () => {
    const missingProjectId = toUrlProjectId("/tmp/missing-workstream-project");

    const response = await createRoutes().request(
      `/${missingProjectId}/workstreams`,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Project not found" });
  });

  it("returns the implicit main workstream", async () => {
    const response = await createRoutes().request(`/${projectId}/workstreams`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projectId,
      workstreams: [
        {
          id: mainWorkstreamId(projectId),
          projectId,
          label: "main",
          kind: "main",
          path: PROJECT_PATH,
          branch: "main",
          baseBranch: "main",
          baseCommit: null,
          managedByYa: false,
          queuePaused: false,
          status: "active",
          createdAt: "1970-01-01T00:00:00.000Z",
          updatedAt: "1970-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns stored checkout lanes after the implicit main workstream", async () => {
    await workstreamService.upsertWorkstream(makeWorkstream());

    const response = await createRoutes().request(`/${projectId}/workstreams`);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.workstreams.map((workstream: { id: string }) => workstream.id))
      .toEqual([mainWorkstreamId(projectId), "ws-tools"]);
    expect(json.workstreams[1]).toMatchObject({
      id: "ws-tools",
      projectId,
      label: "tools cleanup",
      kind: "checkout",
      path: "/tmp/workstream-route-project-tools",
      branch: "main",
      managedByYa: true,
    });
  });
});
