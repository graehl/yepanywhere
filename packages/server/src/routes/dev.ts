import { Hono } from "hono";
import type { SafeRestartState } from "@yep-anywhere/shared";
import type { SafeRestartService } from "../services/SafeRestartService.js";
import type { EventBus, SourceChangeEvent } from "../watcher/index.js";

export interface DevDeps {
  eventBus: EventBus;
  safeRestartService?: SafeRestartService;
}

// Track backend dirty state - persists across page refreshes until server restarts
// If backend code changed and we're still running, we're dirty
let backendDirty = false;

/**
 * Dev-only routes for manual reload workflow.
 * Only mounted when NO_BACKEND_RELOAD or NO_FRONTEND_RELOAD is set.
 */
export function createDevRoutes(deps: DevDeps): Hono {
  const routes = new Hono();

  // Subscribe to source-change events to track backend dirty state
  deps.eventBus.subscribe((event) => {
    if (event.type === "source-change" && event.target === "backend") {
      backendDirty = true;
    }
  });

  // POST /api/dev/frontend-changed - Called by Vite plugin when frontend files change
  routes.post("/frontend-changed", async (c) => {
    const body = await c.req
      .json<{ files?: string[] }>()
      .catch(() => ({ files: [] as string[] }));

    const event: SourceChangeEvent = {
      type: "source-change",
      target: "frontend",
      files: body.files ?? [],
      timestamp: new Date().toISOString(),
    };

    deps.eventBus.emit(event);
    console.log(
      `[Dev] Frontend source changed: ${event.files.join(", ") || "(unknown files)"}`,
    );

    return c.json({ ok: true });
  });

  // GET /api/dev/status - Get dev mode status including dirty flag
  routes.get("/status", (c) => {
    return c.json({
      noBackendReload: process.env.NO_BACKEND_RELOAD === "true",
      noFrontendReload: process.env.NO_FRONTEND_RELOAD === "true",
      backendDirty,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /api/dev/safe-restart - Get scheduled safe restart state
  routes.get("/safe-restart", (c) => {
    return c.json<SafeRestartState>(
      deps.safeRestartService?.getState() ?? {
        status: "idle",
        blockers: [],
        canRestartNow: true,
        updatedAt: new Date().toISOString(),
      },
    );
  });

  // POST /api/dev/safe-restart - Restart after active work and queues drain
  routes.post("/safe-restart", async (c) => {
    if (!deps.safeRestartService) {
      return c.json({ error: "Safe restart is not available" }, 404);
    }
    const state = await deps.safeRestartService.schedule();
    return c.json(state);
  });

  // DELETE /api/dev/safe-restart - Cancel a scheduled safe restart
  routes.delete("/safe-restart", async (c) => {
    if (!deps.safeRestartService) {
      return c.json({ error: "Safe restart is not available" }, 404);
    }
    const state = await deps.safeRestartService.cancel();
    return c.json(state);
  });

  return routes;
}
