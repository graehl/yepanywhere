import type { ProjectScanner } from "../projects/scanner.js";
import { isDetachedProjectPath } from "../projects/paths.js";
import type { RetainedSessionCollections } from "../services/RetainedSessionCollections.js";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";
import type { AgentProvider } from "../sdk/providers/types.js";
import type { CoreApiSources } from "./service.js";

export function productionApiSources(deps: {
  scanner: Pick<ProjectScanner, "readRetainedProjects">;
  sessions: Pick<RetainedSessionCollections, "read">;
  metadata?: Pick<SessionMetadataService, "getMetadata">;
  providers: () => readonly Pick<
    AgentProvider,
    "name" | "displayName" | "supportsSteering" | "supportsPermissionMode"
  >[];
  sessionState: (sessionId: string) => string;
  hiddenProjects: NonNullable<CoreApiSources["hiddenProjects"]>;
}): CoreApiSources {
  return {
    async projects(signal) {
      signal?.throwIfAborted();
      const result = await deps.scanner.readRetainedProjects();
      signal?.throwIfAborted();
      return {
        items: result.projects
          .filter((p) => !isDetachedProjectPath(p.path))
          .map((p) => ({ id: p.id, name: p.name, path: p.path })),
        catalog: { complete: result.complete, refreshing: result.refreshing },
      };
    },
    async sessions(signal) {
      signal?.throwIfAborted();
      const result = await deps.sessions.read();
      signal?.throwIfAborted();
      // Session-wide metadata cannot disambiguate conflicting native sources.
      const sourceProjects = new Map<string, string>();
      const ambiguous = new Set<string>();
      for (const row of result.rows) {
        const previous = sourceProjects.get(row.sessionId);
        if (previous !== undefined && previous !== row.projectId)
          ambiguous.add(row.sessionId);
        sourceProjects.set(row.sessionId, row.projectId);
      }
      return {
        items: result.rows
          .filter((row) => !ambiguous.has(row.sessionId))
          .filter((r) => !isDetachedProjectPath(r.projectPath))
          .map((row) => {
            const metadata = deps.metadata?.getMetadata(row.sessionId);
            return {
              id: row.sessionId,
              projectId: metadata?.workingProjectId ?? row.projectId,
              provider: metadata?.provider ?? row.provider ?? row.catalogFamily,
              title: metadata?.customTitle ?? row.title ?? null,
              updatedAt: row.updatedAt,
              createdByUser: metadata?.createdByUser,
              state: deps.sessionState(row.sessionId),
            };
          }),
        catalog: {
          complete: result.catalog.complete,
          refreshing: result.catalog.refreshing,
        },
      };
    },
    async providers(signal) {
      signal?.throwIfAborted();
      return deps.providers().map((p) => ({
        id: p.name,
        name: p.displayName,
        supportsSteering: p.supportsSteering,
        supportsPermissionMode: p.supportsPermissionMode,
      }));
    },
    hiddenProjects: deps.hiddenProjects,
  };
}
