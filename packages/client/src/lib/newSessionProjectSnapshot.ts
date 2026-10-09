import {
  isRecord,
  projectAccessLevel,
  type ActingPrincipal,
} from "@yep-anywhere/shared";
import type { Project } from "../types";

const PREFIX = "ya:new-session-projects:";
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_STORAGE_BYTES = 256 * 1024;
const MAX_PROJECTS = 256;

export interface NewSessionProjectSnapshot {
  projects: Project[];
  recentProjectIds: string[];
}

export function newSessionProjectSnapshotKey(
  sourceKey: string,
  username: string | null,
): string {
  return `${PREFIX}${JSON.stringify([sourceKey, username])}`;
}

function displayProject(value: unknown): Project | null {
  if (!isRecord(value)) return null;
  for (const key of ["id", "path", "name"] as const) {
    if (typeof value[key] !== "string" || value[key].length > 4096) return null;
  }
  if (!value.id || !value.path) return null;
  return {
    id: value.id as string,
    path: value.path as string,
    name: value.name as string,
    ...(typeof value.codeName === "string" && value.codeName.length <= 4096
      ? { codeName: value.codeName }
      : {}),
    ...(typeof value.ownerUsername === "string" &&
    value.ownerUsername.length <= 4096
      ? { ownerUsername: value.ownerUsername }
      : {}),
    sessionCount: 0,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
  };
}

export function readNewSessionProjectSnapshot(
  sourceKey: string,
  principal: ActingPrincipal,
): NewSessionProjectSnapshot | null {
  const key = newSessionProjectSnapshotKey(sourceKey, principal.username);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    if (raw.length * 2 > MAX_STORAGE_BYTES) {
      localStorage.removeItem(key);
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > Date.now() ||
      Date.now() - value.savedAt > MAX_AGE_MS ||
      !Array.isArray(value.projects) ||
      value.projects.length > MAX_PROJECTS ||
      !Array.isArray(value.recentProjectIds) ||
      value.recentProjectIds.length > MAX_PROJECTS
    ) {
      localStorage.removeItem(key);
      return null;
    }
    const projects: Project[] = [];
    for (const row of value.projects) {
      const project = displayProject(row);
      if (!project) return null;
      if (
        principal.username !== null &&
        (!principal.grants ||
          projectAccessLevel(principal.grants, project.id) === "none")
      )
        continue;
      projects.push(project);
    }
    const ids = new Set(projects.map((project) => project.id));
    return {
      projects,
      recentProjectIds: value.recentProjectIds.filter(
        (id): id is string => typeof id === "string" && ids.has(id),
      ),
    };
  } catch {
    // Private/unavailable storage only disables the display accelerator.
    return null;
  }
}

export function writeNewSessionProjectSnapshot(
  sourceKey: string,
  principal: ActingPrincipal,
  projects: readonly Project[],
  recentProjectIds?: readonly string[],
  preferredProjectId?: string | null,
): void {
  const key = newSessionProjectSnapshotKey(sourceKey, principal.username);
  const recents =
    recentProjectIds ??
    readNewSessionProjectSnapshot(sourceKey, principal)?.recentProjectIds ??
    [];
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ordered = new Set([
    ...(preferredProjectId ? [preferredProjectId] : []),
    ...recents,
    ...byId.keys(),
  ]);
  const rows: Project[] = [];
  for (const id of ordered) {
    const project = displayProject(byId.get(id));
    if (project) rows.push(project);
    if (rows.length === MAX_PROJECTS) break;
  }
  const ids = new Set(rows.map((project) => project.id));
  const raw = JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    projects: rows,
    recentProjectIds: recents
      .filter((id) => ids.has(id))
      .slice(0, MAX_PROJECTS),
  });
  try {
    if (raw.length * 2 > MAX_STORAGE_BYTES) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
  } catch {
    // Storage quota cannot fail the accepted server collection.
  }
}
