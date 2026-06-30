import { describe, expect, it } from "vitest";
import { createSessionIndexRoutes } from "../../src/routes/session-index.js";

describe("session index routes", () => {
  it("returns warmup status", async () => {
    const routes = createSessionIndexRoutes({
      sessionIndexService: {
        getWarmupStatus: () => ({
          summaryParseConcurrency: 1,
          activeParses: 0,
          queuedParses: 0,
          activeJobs: [],
          recentJobs: [],
        }),
      },
    });

    const response = await routes.request("/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summaryParseConcurrency: 1,
      activeParses: 0,
      queuedParses: 0,
      activeJobs: [],
      recentJobs: [],
    });
  });
});
