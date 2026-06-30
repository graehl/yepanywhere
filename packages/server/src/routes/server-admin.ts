import { Hono } from "hono";
import { markDevReloadRequested } from "../dev-reload-signal.js";
import type { NotificationService } from "../notifications/index.js";
import type { Supervisor } from "../supervisor/Supervisor.js";

export interface ServerAdminDeps {
  supervisor: Supervisor;
  notificationService?: NotificationService;
}

export interface TriggerServerRestartOptions {
  notificationService?: NotificationService;
  exit?: (code: number) => void;
  exitDelayMs?: number;
}

export async function triggerServerRestart({
  notificationService,
  exit = (code) => process.exit(code),
  exitDelayMs = 100,
}: TriggerServerRestartOptions = {}): Promise<void> {
  await notificationService?.flush();
  markDevReloadRequested();

  // Process supervisor (scripts/dev.js, systemd, pm2) will restart the process.
  setTimeout(() => {
    exit(0);
  }, exitDelayMs);
}

/**
 * Administrative routes for server management.
 * Always mounted (not dev-mode-only), so remote relay clients can use them.
 */
export function createServerAdminRoutes(deps: ServerAdminDeps): Hono {
  const routes = new Hono();

  // POST /api/server/restart - Trigger graceful server restart
  routes.post("/restart", async (c) => {
    console.log("[ServerAdmin] Restart requested via API");

    await triggerServerRestart({
      notificationService: deps.notificationService,
    });

    // Respond before exiting
    const response = c.json({
      ok: true,
      message: "Server restarting...",
    });

    return response;
  });

  return routes;
}
