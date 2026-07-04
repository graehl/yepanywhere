import {
  type CreateProjectQueueItemRequest,
  type ProjectQueueItemSummary,
  type ProjectQueuePromoteNowRequest,
  type ProjectQueuePromoteNowResponse,
  type UpdateProjectQueueItemRequest,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import type {
  GlobalProjectQueueRoutesDeps,
  ProjectQueueRoutesDeps,
} from "./project-queue-response.js";
import {
  globalQueueResponse,
  projectQueueResponse,
} from "./project-queue-response.js";
import { ProjectQueueValidationError } from "../services/ProjectQueueService.js";
import type { Project } from "../supervisor/types.js";

function validationError(message: string) {
  return { error: "Invalid project queue request", reason: message };
}

export function createGlobalProjectQueueRoutes(
  deps: GlobalProjectQueueRoutesDeps,
): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    return c.json(await globalQueueResponse(deps));
  });

  routes.post("/pause", async (c) => {
    try {
      const dispatchState = await deps.projectQueueService.pauseDispatch();
      return c.json(await globalQueueResponse(deps, dispatchState));
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
  });

  routes.post("/resume", async (c) => {
    const dispatchState = await deps.projectQueueService.resumeDispatch();
    return c.json(await globalQueueResponse(deps, dispatchState));
  });

  routes.post("/:projectId/promote-now", async (c) => {
    const projectId = c.req.param("projectId");
    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }
    if (!deps.projectQueueScheduler) {
      return c.json({ error: "Project Queue scheduler unavailable" }, 503);
    }

    let body: ProjectQueuePromoteNowRequest = {};
    if (c.req.header("content-type")?.includes("application/json")) {
      try {
        body = await c.req.json<ProjectQueuePromoteNowRequest>();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
    }
    const options = {
      ...(typeof body.itemId === "string" && body.itemId.trim()
        ? { itemId: body.itemId }
        : {}),
      ...(body.force === true ? { force: true } : {}),
    };
    const promoteResult =
      await deps.projectQueueScheduler.promoteNow(projectId, options);
    const response: ProjectQueuePromoteNowResponse = {
      ...(await globalQueueResponse(deps)),
      promoteResult,
    };
    return c.json(response);
  });

  return routes;
}

export function createProjectQueueRoutes(deps: ProjectQueueRoutesDeps): Hono {
  const routes = new Hono();

  async function resolveProject(
    projectId: string,
  ): Promise<
    | { project: Project }
    | {
        error: "Invalid project ID format" | "Project not found";
        status: 400 | 404;
      }
  > {
    if (!isUrlProjectId(projectId)) {
      return { error: "Invalid project ID format" as const, status: 400 };
    }

    const project = await deps.scanner.getOrCreateProject(projectId);
    if (!project) {
      return { error: "Project not found" as const, status: 404 };
    }

    return { project };
  }

  routes.get("/:projectId/queue", async (c) => {
    const resolved = await resolveProject(c.req.param("projectId"));
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    return c.json(await projectQueueResponse(resolved.project, deps));
  });

  routes.post("/:projectId/queue", async (c) => {
    const resolved = await resolveProject(c.req.param("projectId"));
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    let body: CreateProjectQueueItemRequest;
    try {
      body = await c.req.json<CreateProjectQueueItemRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const item = await deps.projectQueueService.createItem({
        projectId: resolved.project.id,
        projectPath: resolved.project.path,
        request: body,
      });
      const queue = await projectQueueResponse(resolved.project, deps);
      return c.json(
        {
          item: queue.items.find((candidate) => candidate.id === item.id) ?? item,
          queue,
        },
        201,
      );
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
  });

  routes.patch("/:projectId/queue/:itemId", async (c) => {
    const resolved = await resolveProject(c.req.param("projectId"));
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    let body: UpdateProjectQueueItemRequest;
    try {
      body = await c.req.json<UpdateProjectQueueItemRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (body.target === undefined && body.message === undefined) {
      return c.json(validationError("target or message is required"), 400);
    }

    try {
      const item = await deps.projectQueueService.updateItem(
        resolved.project.id,
        c.req.param("itemId"),
        body,
      );
      if (!item) {
        return c.json({ error: "Project queue item not found" }, 404);
      }
      const queue = await projectQueueResponse(resolved.project, deps);
      return c.json({
        item: queue.items.find((candidate) => candidate.id === item.id) ?? item,
        queue,
      });
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
  });

  routes.delete("/:projectId/queue/:itemId", async (c) => {
    const resolved = await resolveProject(c.req.param("projectId"));
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    let deleted: boolean;
    try {
      deleted = await deps.projectQueueService.deleteItem(
        resolved.project.id,
        c.req.param("itemId"),
      );
      if (!deleted) {
        return c.json({ error: "Project queue item not found" }, 404);
      }
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
    return c.json({
      deleted: true,
      queue: await projectQueueResponse(resolved.project, deps),
    });
  });

  routes.post("/:projectId/queue/:itemId/retry", async (c) => {
    const resolved = await resolveProject(c.req.param("projectId"));
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    let item: ProjectQueueItemSummary | null;
    try {
      item = await deps.projectQueueService.retryItem(
        resolved.project.id,
        c.req.param("itemId"),
      );
      if (!item) {
        return c.json({ error: "Project queue item not found" }, 404);
      }
      const queue = await projectQueueResponse(resolved.project, deps);
      const enrichedItem =
        queue.items.find((candidate) => candidate.id === item?.id) ?? item;
      return c.json({
        item: enrichedItem,
        queue,
      });
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
  });

  routes.post("/:projectId/queue/:itemId/move-to-top", async (c) => {
    const resolved = await resolveProject(c.req.param("projectId"));
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    let item: ProjectQueueItemSummary | null;
    try {
      item = await deps.projectQueueService.moveItemToTop(
        resolved.project.id,
        c.req.param("itemId"),
      );
      if (!item) {
        return c.json({ error: "Project queue item not found" }, 404);
      }
      const queue = await projectQueueResponse(resolved.project, deps);
      const enrichedItem =
        queue.items.find((candidate) => candidate.id === item?.id) ?? item;
      return c.json({
        item: enrichedItem,
        queue,
      });
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
  });

  return routes;
}
