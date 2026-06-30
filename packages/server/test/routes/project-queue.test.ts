import { toUrlProjectId, type UrlProjectId } from "@yep-anywhere/shared";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import {
  createGlobalProjectQueueRoutes,
  createProjectQueueRoutes,
} from "../../src/routes/project-queue.js";
import { ProjectQueueService } from "../../src/services/ProjectQueueService.js";
import {
  type PersistedSessionQueuedMessage,
  SessionQueuePersistenceService,
} from "../../src/services/SessionQueuePersistenceService.js";
import type { Project } from "../../src/supervisor/types.js";
import type { SessionMetadataService } from "../../src/metadata/index.js";

describe("Project Queue Routes", () => {
  let testDir: string;
  let projectId: UrlProjectId;
  let project: Project;
  let service: ProjectQueueService;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-queue-route-"));
    projectId = toUrlProjectId("/tmp/project-queue-route");
    project = {
      id: projectId,
      path: "/tmp/project-queue-route",
      name: "project-queue-route",
      sessionCount: 0,
      sessionDir: "/tmp/project-queue-route/.claude-sessions",
      activeOwnedCount: 0,
      activeExternalCount: 0,
      lastActivity: null,
      provider: "claude",
    };
    service = new ProjectQueueService({ dataDir: testDir });
    await service.initialize();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createRoutes() {
    return createProjectQueueRoutes({
      scanner: {
        getOrCreateProject: vi.fn(async (id) =>
          id === projectId ? project : null,
        ),
      } as unknown as ProjectScanner,
      projectQueueService: service,
    });
  }

  function createGlobalRoutes() {
    return createGlobalProjectQueueRoutes({
      projectQueueService: service,
    });
  }

  function makePersistedSessionQueueItem(
    overrides: Partial<PersistedSessionQueuedMessage> = {},
  ): PersistedSessionQueuedMessage {
    return {
      id: "persisted-1",
      sessionId: "session-1",
      projectId,
      projectPath: project.path,
      provider: "claude",
      kind: "patient",
      message: { text: "resume this first" },
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      queuedAt: "2026-06-30T00:00:00.000Z",
      status: "paused-after-restart",
      ...overrides,
    };
  }

  it("creates, lists, updates, retries, and deletes project queue items", async () => {
    const routes = createRoutes();
    const createResponse = await routes.request(`/${projectId}/queue`, {
      method: "POST",
      body: JSON.stringify({
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "do this after the project settles" },
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    const itemId = created.item.id as string;
    expect(created.queue.items).toHaveLength(1);

    const listResponse = await routes.request(`/${projectId}/queue`);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).items[0]).toMatchObject({
      id: itemId,
      messagePreview: "do this after the project settles",
    });

    const patchResponse = await routes.request(`/${projectId}/queue/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ message: { text: "updated text" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).item.messagePreview).toBe(
      "updated text",
    );

    const retryResponse = await routes.request(
      `/${projectId}/queue/${itemId}/retry`,
      { method: "POST" },
    );
    expect(retryResponse.status).toBe(200);

    const deleteResponse = await routes.request(
      `/${projectId}/queue/${itemId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    expect((await deleteResponse.json()).queue.items).toEqual([]);
  });

  it("rejects invalid queue requests", async () => {
    const routes = createRoutes();

    const response = await routes.request(`/${projectId}/queue`, {
      method: "POST",
      body: JSON.stringify({
        target: { type: "existing-session" },
        message: { text: "missing session target" },
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid project queue request",
    });
  });

  it("lists project queue items globally", async () => {
    const otherProjectId = toUrlProjectId("/tmp/project-queue-route-other");
    await service.createItem({
      projectId,
      projectPath: project.path,
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "first queued item" },
      },
    });
    await service.createItem({
      projectId: otherProjectId,
      projectPath: "/tmp/project-queue-route-other",
      request: {
        target: { type: "new-session", title: "Start later" },
        message: { text: "second queued item" },
      },
    });

    const response = await createGlobalRoutes().request("/");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dispatchState).toEqual({ status: "running" });
    expect(body.items).toMatchObject([
      {
        projectId,
        messagePreview: "first queued item",
      },
      {
        projectId: otherProjectId,
        messagePreview: "second queued item",
      },
    ]);
  });

  it("includes recovered session queue entries in the global list", async () => {
    const sessionQueuePersistenceService = new SessionQueuePersistenceService({
      dataDir: testDir,
    });
    await sessionQueuePersistenceService.initialize();
    await sessionQueuePersistenceService.replaceAll([
      makePersistedSessionQueueItem({
        id: "persisted-2",
        message: { text: "second recovered" },
        queuedAt: "2026-06-30T00:00:02.000Z",
      }),
      makePersistedSessionQueueItem({
        id: "persisted-1",
        message: { text: "first recovered" },
        queuedAt: "2026-06-30T00:00:01.000Z",
      }),
      makePersistedSessionQueueItem({
        id: "live-patient",
        message: { text: "not recovered" },
        status: "queued",
      }),
    ]);

    const routes = createGlobalProjectQueueRoutes({
      projectQueueService: service,
      sessionQueuePersistenceService,
      sessionMetadataService: {
        getMetadata: vi.fn((sessionId: string) =>
          sessionId === "session-1"
            ? { customTitle: "Recovered session" }
            : undefined,
        ),
      } as unknown as SessionMetadataService,
    });
    const response = await routes.request("/");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recoveredSessionQueues).toMatchObject([
      {
        id: "persisted-1",
        sessionId: "session-1",
        projectId,
        content: "first recovered",
        status: "paused-after-restart",
        kind: "patient",
        sessionTitle: "Recovered session",
      },
      {
        id: "persisted-2",
        content: "second recovered",
      },
    ]);
  });

  it("pauses and resumes project queue dispatch globally", async () => {
    await service.createItem({
      projectId,
      projectPath: project.path,
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "pause this queue" },
      },
    });

    const routes = createGlobalRoutes();
    const pauseResponse = await routes.request("/pause", { method: "POST" });
    expect(pauseResponse.status).toBe(200);
    expect(await pauseResponse.json()).toMatchObject({
      dispatchState: { status: "paused", reason: "manual" },
      items: [{ messagePreview: "pause this queue" }],
    });

    const resumeResponse = await routes.request("/resume", { method: "POST" });
    expect(resumeResponse.status).toBe(200);
    expect(await resumeResponse.json()).toMatchObject({
      dispatchState: { status: "running" },
      items: [{ messagePreview: "pause this queue" }],
    });
  });

  it("rejects pausing an empty project queue", async () => {
    const response = await createGlobalRoutes().request("/pause", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid project queue request",
    });
  });
});
