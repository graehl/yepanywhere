import {
  type CreateProjectQueueItemRequest,
  type ProjectQueueListResponse,
  type ProjectQueueItemSummary,
  type ProjectQueueRecoveredSessionQueueSummary,
  type UpdateProjectQueueItemRequest,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { SessionMetadataService } from "../metadata/index.js";
import {
  type ProjectQueueService,
  ProjectQueueValidationError,
} from "../services/ProjectQueueService.js";
import type {
  PersistedSessionQueuedMessage,
  SessionQueuePersistenceService,
} from "../services/SessionQueuePersistenceService.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { Project } from "../supervisor/types.js";

export interface ProjectQueueRoutesDeps {
  scanner: ProjectScanner;
  projectQueueService: ProjectQueueService;
}

export type GlobalProjectQueueRoutesDeps = Pick<
  ProjectQueueRoutesDeps,
  "projectQueueService"
> & {
  sessionMetadataService?: SessionMetadataService;
  sessionQueuePersistenceService?: SessionQueuePersistenceService;
};

function validationError(message: string) {
  return { error: "Invalid project queue request", reason: message };
}

function isRecoveredPatientQueueItem(
  item: PersistedSessionQueuedMessage,
): boolean {
  return item.kind === "patient" && item.status === "paused-after-restart";
}

function summarizeRecoveredSessionQueue(
  item: PersistedSessionQueuedMessage,
  sessionMetadataService: SessionMetadataService | undefined,
): ProjectQueueRecoveredSessionQueueSummary {
  const attachmentCount =
    (item.message.attachments?.length ?? 0) +
    (item.message.images?.length ?? 0) +
    (item.message.documents?.length ?? 0);
  const tempId = item.message.tempId ?? item.source?.tempId;
  const sessionTitle =
    sessionMetadataService?.getMetadata(item.sessionId)?.customTitle;

  return {
    id: item.id,
    ...(tempId ? { tempId } : {}),
    content: item.message.text,
    timestamp: item.queuedAt,
    ...(item.message.attachments?.length
      ? { attachments: item.message.attachments }
      : {}),
    ...(attachmentCount > 0 ? { attachmentCount } : {}),
    ...(item.message.metadata ? { metadata: item.message.metadata } : {}),
    kind: "patient",
    status: "paused-after-restart",
    sessionId: item.sessionId,
    projectId: item.projectId,
    queuedAt: item.queuedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(sessionTitle ? { sessionTitle } : {}),
  };
}

function listRecoveredSessionQueues(
  deps: GlobalProjectQueueRoutesDeps,
): ProjectQueueRecoveredSessionQueueSummary[] {
  return (deps.sessionQueuePersistenceService?.list() ?? [])
    .filter(isRecoveredPatientQueueItem)
    .sort((left, right) => {
      const project = left.projectId.localeCompare(right.projectId);
      if (project !== 0) return project;
      const session = left.sessionId.localeCompare(right.sessionId);
      if (session !== 0) return session;
      const queued = left.queuedAt.localeCompare(right.queuedAt);
      return queued !== 0 ? queued : left.id.localeCompare(right.id);
    })
    .map((item) =>
      summarizeRecoveredSessionQueue(item, deps.sessionMetadataService),
    );
}

function globalQueueResponse(
  deps: GlobalProjectQueueRoutesDeps,
  dispatchState = deps.projectQueueService.getDispatchState(),
): ProjectQueueListResponse {
  return {
    items: deps.projectQueueService.listAll(),
    dispatchState,
    recoveredSessionQueues: listRecoveredSessionQueues(deps),
  };
}

export function createGlobalProjectQueueRoutes(
  deps: GlobalProjectQueueRoutesDeps,
): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    return c.json(globalQueueResponse(deps));
  });

  routes.post("/pause", async (c) => {
    try {
      const dispatchState = await deps.projectQueueService.pauseDispatch();
      return c.json(globalQueueResponse(deps, dispatchState));
    } catch (error) {
      if (error instanceof ProjectQueueValidationError) {
        return c.json(validationError(error.message), 400);
      }
      throw error;
    }
  });

  routes.post("/resume", async (c) => {
    const dispatchState = await deps.projectQueueService.resumeDispatch();
    return c.json(globalQueueResponse(deps, dispatchState));
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
