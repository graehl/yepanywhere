import { Hono } from "hono";
import { getStartupEnvSettings } from "../envSettings.js";

interface EnvSettingsRouteOptions {
  /**
   * Live (request-time) accessor for the addresses the server is actually
   * listening on, e.g. ["127.0.0.1:3400"]. Reads real sockets, so a failed
   * --host bind never shows up. Used to annotate the HOST entry.
   */
  getActiveListeners?: () => string[];
}

/**
 * Read-only view of documented startup environment variables. Secrets are
 * already redacted in the snapshot (see envSettings.ts); this route only
 * serializes it. There is no edit path — env vars take effect at startup only.
 *
 * The static snapshot is augmented per-request with dynamic notes that depend
 * on live server state (the active listen addresses), without mutating it.
 */
export function createEnvSettingsRoutes(options: EnvSettingsRouteOptions = {}) {
  const app = new Hono();

  app.get("/", (c) => {
    const report = getStartupEnvSettings();
    const listeners = options.getActiveListeners?.() ?? [];
    const note =
      listeners.length > 0 ? `Listening on ${listeners.join(", ")}` : undefined;

    // Don't mutate the cached snapshot: copy entries, annotating HOST.
    const entries =
      note === undefined
        ? report.entries
        : report.entries.map((entry) =>
            entry.name === "HOST" ? { ...entry, note } : entry,
          );

    return c.json({ ...report, entries });
  });

  return app;
}
