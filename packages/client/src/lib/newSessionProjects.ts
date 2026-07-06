import type { Project } from "../types";

export const QUICK_PROJECT_COUNT = 10;
export const PROJECT_SUGGESTION_COUNT = 10;

function getProjectSortValue(project: Project): number {
  return project.lastActivity ? new Date(project.lastActivity).getTime() : 0;
}

export function sortProjectsForChooser(
  projects: readonly Project[],
  recentProjectIds: readonly string[] = [],
): Project[] {
  const recentRanks = new Map(
    recentProjectIds.map((projectId, index) => [projectId, index]),
  );

  return [...projects].sort((a, b) => {
    const recentRankA = recentRanks.get(a.id) ?? Number.POSITIVE_INFINITY;
    const recentRankB = recentRanks.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (recentRankA !== recentRankB) return recentRankA - recentRankB;

    const activityDiff = getProjectSortValue(b) - getProjectSortValue(a);
    if (activityDiff !== 0) return activityDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.path.localeCompare(b.path);
  });
}

export function normalizeProjectInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 1 && /[/\\]$/.test(trimmed)) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

export function findProjectByInput(
  projects: readonly Project[],
  candidate: string,
): Project | null {
  const normalizedCandidate = normalizeProjectInput(candidate);
  if (!normalizedCandidate) return null;

  const exactPathMatch = projects.find(
    (project) => project.path === normalizedCandidate,
  );
  if (exactPathMatch) return exactPathMatch;

  const exactNameMatches = projects.filter(
    (project) =>
      project.name.toLowerCase() === normalizedCandidate.toLowerCase(),
  );
  if (exactNameMatches.length === 1) {
    return exactNameMatches[0] ?? null;
  }

  return null;
}
