import { Hono } from "hono";
import {
  BrowserSettingsBackupValidationError,
  type BrowserSettingsBackupService,
} from "../services/BrowserSettingsBackupService.js";

export interface BrowserSettingsBackupRoutesDeps {
  browserSettingsBackupService: BrowserSettingsBackupService;
}

export function createBrowserSettingsBackupRoutes(
  deps: BrowserSettingsBackupRoutesDeps,
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({ backup: deps.browserSettingsBackupService.getBackup() });
  });

  app.put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be JSON" }, 400);
    }
    const input =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    try {
      const backup = await deps.browserSettingsBackupService.saveBackup({
        version: input.version,
        values: input.values,
      });
      return c.json({ backup });
    } catch (error) {
      if (error instanceof BrowserSettingsBackupValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return app;
}
