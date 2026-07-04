import { Hono } from "hono";
import type { Supervisor } from "../supervisor/Supervisor.js";

type SupervisorQueueDeps = Pick<
  Supervisor,
  | "cancelQueuedRequest"
  | "getQueueInfo"
  | "getQueuePosition"
  | "getWorkerActivity"
  | "getWorkerPoolStatus"
>;

export function createSupervisorQueueRoutes(
  supervisor: SupervisorQueueDeps,
): Hono {
  const routes = new Hono();

  // GET /api/status/workers - Get worker activity for safe restart indicator
  routes.get("/status/workers", (c) => {
    const activity = supervisor.getWorkerActivity();
    return c.json(activity);
  });

  // GET /api/queue - Get all queued requests
  routes.get("/queue", (c) => {
    const queue = supervisor.getQueueInfo();
    const poolStatus = supervisor.getWorkerPoolStatus();
    return c.json({ queue, ...poolStatus });
  });

  // GET /api/queue/:queueId - Get specific queue entry position
  routes.get("/queue/:queueId", (c) => {
    const queueId = c.req.param("queueId");
    const position = supervisor.getQueuePosition(queueId);

    if (position === undefined) {
      return c.json({ error: "Queue entry not found" }, 404);
    }

    return c.json({ queueId, position });
  });

  // DELETE /api/queue/:queueId - Cancel a queued request
  routes.delete("/queue/:queueId", (c) => {
    const queueId = c.req.param("queueId");

    const cancelled = supervisor.cancelQueuedRequest(queueId);
    if (!cancelled) {
      return c.json(
        { error: "Queue entry not found or already processed" },
        404,
      );
    }

    return c.json({ cancelled: true });
  });

  return routes;
}
