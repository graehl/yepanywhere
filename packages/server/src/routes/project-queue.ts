import {
  type CreateProjectQueueItemRequest,
  type ProjectQueueListResponse,
  type ProjectQueueItemSummary,
  type ProjectQueueProjectStatus,
  type ProjectQueuePromoteNowRequest,
  type ProjectQueuePromoteNowResponse,
  type ProjectQueueRecoveredSessionQueueSummary,
  type ProjectQueueResponse,
  type UpdateProjectQueueItemRequest,
  getSessionDisplayTitle,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { SessionMetadataService } from "../metadata/index.js";
import {
  type ProjectQueueService,
  ProjectQueueValidationError,
} from "../services/ProjectQueueService.js";
import type { ProjectQueueScheduler } from "../services/ProjectQueueScheduler.js";
import type {
  PersistedSessionQueuedMessage,
  SessionQueuePersistenceService,
} from "../services/SessionQueuePersistenceService.js";
import type { ProjectScanner } from "../projects/scanner.js";
import {
  findSessionSummaryAcrossProviders,
  type ProviderResolutionDeps,
} from "../sessions/provider-resolution.js";
import type { Project } from "../supervisor/types.js";

interface ProjectQueueTitleDeps extends Partial<ProviderResolutionDeps> {
  scanner?: ProjectScanner;
  sessionMetadataService?: SessionMetadataService;
}

export interface ProjectQueueRoutesDeps extends ProjectQueueTitleDeps {
  scanner: ProjectScanner;
  projectQueueService: ProjectQueueService;
  projectQueueScheduler?: Pick<ProjectQueueScheduler, "getProjectStatus">;
}

export type GlobalProjectQueueRoutesDeps = ProjectQueueTitleDeps & {
  projectQueueService: ProjectQueueService;
  projectQueueScheduler?: Pick<
    ProjectQueueScheduler,
    "getProjectStatus" | "promoteNow"
  >;
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

function hasTitleResolutionDeps(
  deps: ProjectQueueTitleDeps,
): deps is ProjectQueueTitleDeps & Pick<ProviderResolutionDeps, "readerFactory"> {
  return typeof deps.readerFactory === "function";
}

function hasDisplayMetadataDeps(deps: ProjectQueueTitleDeps): boolean {
  return !!deps.sessionMetadataService || hasTitleResolutionDeps(deps);
}

function resolveTargetTitles(
  sessionId: string,
  summary: { title?: string | null; fullTitle?: string | null } | null,
  deps: ProjectQueueTitleDeps,
): Pick<ProjectQueueItemSummary, "targetTitle" | "targetFullTitle"> {
  const customTitle =
    deps.sessionMetadataService?.getMetadata(sessionId)?.customTitle;
  const title = summary?.title ?? null;
  return {
    targetTitle:
      customTitle !== undefined || title !== null
        ? getSessionDisplayTitle({ customTitle, title })
        : null,
    targetFullTitle: customTitle ?? summary?.fullTitle ?? null,
  };
}

function buildProviderResolutionDeps(
  deps: ProjectQueueTitleDeps & Pick<ProviderResolutionDeps, "readerFactory">,
): ProviderResolutionDeps {
  const resolutionDeps: ProviderResolutionDeps = {
    readerFactory: deps.readerFactory,
  };
  if (deps.sessionIndexService) {
    resolutionDeps.sessionIndexService = deps.sessionIndexService;
  }
  if (deps.codexSessionsDir) {
    resolutionDeps.codexSessionsDir = deps.codexSessionsDir;
  }
  if (deps.codexReaderFactory) {
    resolutionDeps.codexReaderFactory = deps.codexReaderFactory;
  }
  if (deps.geminiSessionsDir) {
    resolutionDeps.geminiSessionsDir = deps.geminiSessionsDir;
  }
  if (deps.geminiReaderFactory) {
    resolutionDeps.geminiReaderFactory = deps.geminiReaderFactory;
  }
  if (deps.geminiHashToCwd) {
    resolutionDeps.geminiHashToCwd = deps.geminiHashToCwd;
  }
  if (deps.grokSessionsDir) {
    resolutionDeps.grokSessionsDir = deps.grokSessionsDir;
  }
  if (deps.grokReaderFactory) {
    resolutionDeps.grokReaderFactory = deps.grokReaderFactory;
  }
  if (deps.piSessionsDir) {
    resolutionDeps.piSessionsDir = deps.piSessionsDir;
  }
  if (deps.piReaderFactory) {
    resolutionDeps.piReaderFactory = deps.piReaderFactory;
  }
  return resolutionDeps;
}

async function enrichProjectQueueItem(
  project: Project | null,
  item: ProjectQueueItemSummary,
  deps: ProjectQueueTitleDeps,
): Promise<ProjectQueueItemSummary> {
  if (item.target.type !== "existing-session" || !hasDisplayMetadataDeps(deps)) {
    return item;
  }

  if (!project || !hasTitleResolutionDeps(deps)) {
    const titles = resolveTargetTitles(item.target.sessionId, null, deps);
    return titles.targetTitle !== null || titles.targetFullTitle !== null
      ? { ...item, ...titles }
      : item;
  }

  try {
    const resolved = await findSessionSummaryAcrossProviders(
      project,
      item.target.sessionId,
      project.id,
      buildProviderResolutionDeps(deps),
      item.target.provider,
    );
    return {
      ...item,
      ...resolveTargetTitles(
        item.target.sessionId,
        resolved?.summary ?? null,
        deps,
      ),
    };
  } catch {
    return {
      ...item,
      ...resolveTargetTitles(item.target.sessionId, null, deps),
    };
  }
}

async function enrichProjectQueueItems(
  project: Project,
  items: ProjectQueueItemSummary[],
  deps: ProjectQueueTitleDeps,
): Promise<ProjectQueueItemSummary[]> {
  if (!hasDisplayMetadataDeps(deps)) {
    return items;
  }
  return Promise.all(
    items.map((item) => enrichProjectQueueItem(project, item, deps)),
  );
}

async function resolveProjectForQueueItem(
  item: ProjectQueueItemSummary,
  deps: GlobalProjectQueueRoutesDeps,
  projectCache: Map<string, Promise<Project | null>>,
): Promise<Project | null> {
  if (!deps.scanner) return null;
  let projectPromise = projectCache.get(item.projectId);
  if (!projectPromise) {
    projectPromise = deps.scanner
      .getOrCreateProject(item.projectId)
      .catch(() => null);
    projectCache.set(item.projectId, projectPromise);
  }
  return projectPromise;
}

async function enrichGlobalProjectQueueItems(
  items: ProjectQueueItemSummary[],
  deps: GlobalProjectQueueRoutesDeps,
): Promise<ProjectQueueItemSummary[]> {
  if (!hasDisplayMetadataDeps(deps)) {
    return items;
  }
  const projectCache = new Map<string, Promise<Project | null>>();
  return Promise.all(
    items.map(async (item) => {
      const project =
        deps.scanner && hasTitleResolutionDeps(deps)
          ? await resolveProjectForQueueItem(item, deps, projectCache)
          : null;
      return enrichProjectQueueItem(project, item, deps);
    }),
  );
}

async function projectQueueResponse(
  project: Project,
  deps: ProjectQueueRoutesDeps,
): Promise<ProjectQueueResponse> {
  const queue = deps.projectQueueService.listProject(project.id);
  const projectStatuses = await projectStatusesForIds([project.id], deps);
  return {
    ...queue,
    items: await enrichProjectQueueItems(project, queue.items, deps),
    projectStatuses,
  };
}

async function projectStatusesForIds(
  projectIds: Iterable<string>,
  deps: Pick<
    GlobalProjectQueueRoutesDeps | ProjectQueueRoutesDeps,
    "projectQueueScheduler"
  >,
): Promise<Record<string, ProjectQueueProjectStatus> | undefined> {
  const scheduler = deps.projectQueueScheduler;
  if (!scheduler) return undefined;
  const statuses: Record<string, ProjectQueueProjectStatus> = {};
  for (const projectId of new Set(projectIds)) {
    if (!isUrlProjectId(projectId)) continue;
    statuses[projectId] = await scheduler.getProjectStatus(projectId);
  }
  return statuses;
}

async function globalQueueResponse(
  deps: GlobalProjectQueueRoutesDeps,
  dispatchState = deps.projectQueueService.getDispatchState(),
): Promise<ProjectQueueListResponse> {
  const items = deps.projectQueueService.listAll();
  const recoveredSessionQueues = listRecoveredSessionQueues(deps);
  const projectStatuses = await projectStatusesForIds(
    [
      ...items.map((item) => item.projectId),
      ...recoveredSessionQueues.map((item) => item.projectId),
    ],
    deps,
  );
  return {
    items: await enrichGlobalProjectQueueItems(items, deps),
    dispatchState,
    recoveredSessionQueues,
    projectStatuses,
  };
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
