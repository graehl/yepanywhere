import { toUrlProjectId, type UrlProjectId } from "@yep-anywhere/shared";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProjectQueueService,
  ProjectQueueValidationError,
} from "../../src/services/ProjectQueueService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

describe("ProjectQueueService", () => {
  let testDir: string;
  let projectId: UrlProjectId;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-queue-test-"));
    projectId = toUrlProjectId("/tmp/project-queue");
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function createService(eventBus?: EventBus): Promise<ProjectQueueService> {
    const service = new ProjectQueueService({ dataDir: testDir, eventBus });
    await service.initialize();
    return service;
  }

  it("persists queued items across service re-instantiation", async () => {
    const service = await createService();
    const created = await service.createItem({
      projectId,
      projectPath: "/tmp/project-queue",
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "follow up after the project is idle  " },
        createdFrom: { client: "toolbar", sessionId: "session-1" },
      },
    });

    const reloaded = await createService();
    const queue = reloaded.listProject(projectId);

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      id: created.id,
      projectId,
      target: { type: "existing-session", sessionId: "session-1" },
      messagePreview: "follow up after the project is idle",
      message: { text: "follow up after the project is idle  " },
      status: "queued",
      attachmentCount: 0,
      createdFrom: { client: "toolbar", sessionId: "session-1" },
    });
  });

  it("updates, retries, and deletes items with project-scoped events", async () => {
    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.subscribe((event) => {
      if (event.type === "project-queue-changed") {
        events.push(`${event.reason}:${event.itemId ?? ""}:${event.items.length}`);
      }
    });
    const service = await createService(eventBus);
    const created = await service.createItem({
      projectId,
      projectPath: "/tmp/project-queue",
      request: {
        target: { type: "new-session", provider: "claude" },
        message: { text: "start later" },
        createdFrom: { client: "new-session" },
      },
    });

    const updated = await service.updateItem(projectId, created.id, {
      message: { text: "start later with more context" },
    });
    const retried = await service.retryItem(projectId, created.id);
    const deleted = await service.deleteItem(projectId, created.id);

    expect(updated?.messagePreview).toBe("start later with more context");
    expect(retried?.status).toBe("queued");
    expect(deleted).toBe(true);
    expect(service.listProject(projectId).items).toHaveLength(0);
    expect(events).toEqual([
      `created:${created.id}:1`,
      `updated:${created.id}:1`,
      `retry:${created.id}:1`,
      `deleted:${created.id}:0`,
    ]);
  });

  it("rejects empty messages", async () => {
    const service = await createService();

    await expect(
      service.createItem({
        projectId,
        projectPath: "/tmp/project-queue",
        request: {
          target: { type: "existing-session", sessionId: "session-1" },
          message: { text: "   " },
        },
      }),
    ).rejects.toBeInstanceOf(ProjectQueueValidationError);

    await expect(
      service.createItem({
        projectId,
        projectPath: "/tmp/project-queue",
        request: {
          target: { type: "existing-session", sessionId: "session-1" },
          message: { text: "   ", attachments: [] },
        },
      }),
    ).rejects.toBeInstanceOf(ProjectQueueValidationError);
  });

  it("filters malformed persisted items and resets dispatching items", async () => {
    await fs.writeFile(
      path.join(testDir, "project-queues.json"),
      JSON.stringify({
        version: 1,
        items: [
          { id: "bad", projectId: "not-a-url-project-id" },
          {
            id: "good",
            projectId,
            projectPath: "/tmp/project-queue",
            target: { type: "existing-session", sessionId: "session-1" },
            message: { text: "still queued after restart" },
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            status: "dispatching",
          },
        ],
      }),
    );

    const service = await createService();

    expect(service.listProject(projectId).items).toMatchObject([
      {
        id: "good",
        status: "queued",
        messagePreview: "still queued after restart",
      },
    ]);

    const persisted = JSON.parse(
      await fs.readFile(path.join(testDir, "project-queues.json"), "utf-8"),
    );
    expect(persisted.items).toMatchObject([
      {
        id: "good",
        status: "queued",
      },
    ]);
  });

  it("serializes concurrent creates without dropping writes", async () => {
    const service = await createService();

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        service.createItem({
          projectId,
          projectPath: "/tmp/project-queue",
          request: {
            target: { type: "existing-session", sessionId: `session-${index}` },
            message: { text: `message ${index}` },
          },
        }),
      ),
    );

    expect(service.listProject(projectId).items.map((item) => item.message.text))
      .toEqual(["message 0", "message 1", "message 2", "message 3", "message 4"]);
  });
});
