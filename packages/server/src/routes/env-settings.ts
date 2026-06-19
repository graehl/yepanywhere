import { Hono } from "hono";
import { getStartupEnvSettings } from "../envSettings.js";

/**
 * Read-only view of documented startup environment variables. Secrets are
 * already redacted in the snapshot (see envSettings.ts); this route only
 * serializes it. There is no edit path — env vars take effect at startup only.
 */
export function createEnvSettingsRoutes() {
  const app = new Hono();

  app.get("/", (c) => c.json(getStartupEnvSettings()));

  return app;
}
