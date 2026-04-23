import { Hono } from "hono";
import type { CodexUpdateChecker } from "../services/CodexUpdateChecker.js";

export interface CodexUpdateRoutesDeps {
  codexUpdateChecker: CodexUpdateChecker;
}

export function createCodexUpdateRoutes(deps: CodexUpdateRoutesDeps): Hono {
  const app = new Hono();
  const { codexUpdateChecker } = deps;

  app.get("/", async (c) => {
    const force = c.req.query("force") === "true";
    const status = await codexUpdateChecker.getStatus({ force });
    return c.json({ status });
  });

  app.post("/refresh", async (c) => {
    const status = await codexUpdateChecker.getStatus({ force: true });
    return c.json({ status });
  });

  return app;
}
