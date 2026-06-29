import {
  type CreateProjectQueueItemRequest,
  type ProjectQueueListResponse,
  type ProjectQueueItemSummary,
  type UpdateProjectQueueItemRequest,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import {
  type ProjectQueueService,
  ProjectQueueValidationError,
} from "../services/ProjectQueueService.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { Project } from "../supervisor/types.js";

export interface ProjectQueueRoutesDeps {
  scanner: ProjectScanner;
  projectQueueService: ProjectQueueService;
}

export type GlobalProjectQueueRoutesDeps = Pick<
  ProjectQueueRoutesDeps,
  "projectQueueService"
>;

function validationError(message: string) {
  return { error: "Invalid project queue request", reason: message };
}

export function createGlobalProjectQueueRoutes(
  deps: GlobalProjectQueueRoutesDeps,
): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const response: ProjectQueueListResponse = {
      items: deps.projectQueueService.listAll(),
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

    return c.json(deps.projectQueueService.listProject(resolved.project.id));
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
      return c.json(
        {
          item,
          queue: deps.projectQueueService.listProject(resolved.project.id),
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
      return c.json({
        item,
        queue: deps.projectQueueService.listProject(resolved.project.id),
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
      queue: deps.projectQueueService.listProject(resolved.project.id),
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
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
    return c.json({
      item,
      queue: deps.projectQueueService.listProject(resolved.project.id),
    });
  });

  return routes;
}
