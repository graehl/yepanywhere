import { type UrlProjectId, isUrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { ProjectScanner } from "../projects/scanner.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { WorkstreamService } from "../services/WorkstreamService.js";
import type { Project } from "../supervisor/types.js";

export interface WorkstreamRoutesDeps {
  scanner: ProjectScanner;
  serverSettingsService: ServerSettingsService;
  workstreamService: WorkstreamService;
}

function isWorkstreamsEnabled(
  serverSettingsService: ServerSettingsService,
): boolean {
  return serverSettingsService.getSetting("workstreamsEnabled") === true;
}

async function resolveProject(
  scanner: ProjectScanner,
  projectId: string,
): Promise<
  | { project: Project }
  | {
      error: "Invalid project ID format" | "Project not found";
      status: 400 | 404;
    }
> {
  if (!isUrlProjectId(projectId)) {
    return { error: "Invalid project ID format", status: 400 };
  }

  const project = await scanner.getOrCreateProject(projectId);
  if (!project) {
    return { error: "Project not found", status: 404 };
  }

  return { project };
}

export function createWorkstreamRoutes(deps: WorkstreamRoutesDeps): Hono {
  const routes = new Hono();

  routes.get("/:projectId/workstreams", async (c) => {
    if (!isWorkstreamsEnabled(deps.serverSettingsService)) {
      return c.json({ error: "Workstreams are not enabled" }, 404);
    }

    const resolved = await resolveProject(
      deps.scanner,
      c.req.param("projectId"),
    );
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, resolved.status);
    }

    const { project } = resolved;
    const response = {
      projectId: project.id as UrlProjectId,
      workstreams: deps.workstreamService.listProject({
        projectId: project.id,
        projectPath: project.path,
      }),
    };
    return c.json(response);
  });

  return routes;
}
