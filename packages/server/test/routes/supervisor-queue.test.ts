import type { UrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createSupervisorQueueRoutes } from "../../src/routes/supervisor-queue.js";

function createTestApp() {
  const projectId = "project-1" as UrlProjectId;
  const supervisor = {
    cancelQueuedRequest: (queueId: string) => queueId === "cancel-me",
    getQueueInfo: () => [
      {
        id: "queue-1",
        position: 1,
        projectId,
        queuedAt: "2026-07-04T00:00:00.000Z",
        type: "new-session" as const,
      },
    ],
    getQueuePosition: (queueId: string) =>
      queueId === "queue-1" ? 1 : undefined,
    getWorkerActivity: () => ({
      activeWorkers: 1,
      hasActiveWork: true,
      interruptibleSessionCount: 1,
      queueLength: 1,
      queuedSessionMessageCount: 0,
    }),
    getWorkerPoolStatus: () => ({
      activeWorkers: 1,
      maxWorkers: 4,
      queueLength: 1,
    }),
  };
  const app = new Hono();
  app.route("/api", createSupervisorQueueRoutes(supervisor));
  return { app, projectId };
}

describe("supervisor queue routes", () => {
  it("preserves the public worker activity path under /api", async () => {
    const { app } = createTestApp();
    const response = await app.request("/api/status/workers");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeWorkers: 1,
      hasActiveWork: true,
      interruptibleSessionCount: 1,
    });
  });

  it("preserves the public queue list path under /api", async () => {
    const { app, projectId } = createTestApp();
    const response = await app.request("/api/queue");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeWorkers: 1,
      maxWorkers: 4,
      queueLength: 1,
      queue: [
        {
          id: "queue-1",
          position: 1,
          projectId,
          queuedAt: "2026-07-04T00:00:00.000Z",
          type: "new-session",
        },
      ],
    });
  });

  it("returns queue positions and 404s missing entries", async () => {
    const { app } = createTestApp();

    const found = await app.request("/api/queue/queue-1");
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({
      queueId: "queue-1",
      position: 1,
    });

    const missing = await app.request("/api/queue/missing");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: "Queue entry not found",
    });
  });

  it("cancels queue entries and 404s already processed entries", async () => {
    const { app } = createTestApp();

    const cancelled = await app.request("/api/queue/cancel-me", {
      method: "DELETE",
    });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({ cancelled: true });

    const missing = await app.request("/api/queue/missing", {
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: "Queue entry not found or already processed",
    });
  });
});
