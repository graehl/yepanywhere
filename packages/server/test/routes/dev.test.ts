import type { SafeRestartState } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { createDevRoutes } from "../../src/routes/dev.js";
import type { SafeRestartService } from "../../src/services/SafeRestartService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const idleState: SafeRestartState = {
  status: "idle",
  blockers: [],
  canRestartNow: true,
  updatedAt: "2026-06-30T00:00:00.000Z",
};

const scheduledState: SafeRestartState = {
  status: "scheduled",
  blockers: [{ type: "session-queue", count: 2 }],
  canRestartNow: false,
  scheduledAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
};

describe("dev routes", () => {
  it("exposes safe restart state and mutations", async () => {
    const safeRestartService = {
      getState: vi.fn(() => idleState),
      schedule: vi.fn(async () => scheduledState),
      cancel: vi.fn(async () => idleState),
    } as unknown as SafeRestartService;
    const routes = createDevRoutes({
      eventBus: new EventBus(),
      safeRestartService,
    });

    const getResponse = await routes.request("/safe-restart");
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual(idleState);

    const postResponse = await routes.request("/safe-restart", {
      method: "POST",
    });
    expect(postResponse.status).toBe(200);
    expect(await postResponse.json()).toEqual(scheduledState);
    expect(safeRestartService.schedule).toHaveBeenCalledTimes(1);

    const deleteResponse = await routes.request("/safe-restart", {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual(idleState);
    expect(safeRestartService.cancel).toHaveBeenCalledTimes(1);
  });
});
