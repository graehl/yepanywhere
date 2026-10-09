import { useEffect, useMemo, useState } from "react";
import type { Project } from "../types";
import { useActingPrincipal } from "./useActingPrincipal";
import { useClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import {
  newSessionProjectSnapshotKey,
  readNewSessionProjectSnapshot,
  writeNewSessionProjectSnapshot,
} from "../lib/newSessionProjectSnapshot";

/** Display-only overlay; never reported as a live collection observation. */
export function useNewSessionProjectSnapshot({
  projects,
  complete,
  recentProjectIds,
  visitsLoading,
  projectId,
}: {
  projects: Project[];
  complete: boolean;
  recentProjectIds: string[];
  visitsLoading: boolean;
  projectId?: string;
}) {
  const sourceKey = useClientSummarySourceKey();
  const { principal, resolved } = useActingPrincipal();
  const [storageRevision, setStorageRevision] = useState(0);
  const key = newSessionProjectSnapshotKey(sourceKey, principal.username);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Storage events invalidate the external snapshot without changing its source or principal.
  const snapshot = useMemo(
    () =>
      resolved ? readNewSessionProjectSnapshot(sourceKey, principal) : null,
    [sourceKey, principal, resolved, storageRevision],
  );
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setStorageRevision((value) => value + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  useEffect(() => {
    if (!resolved || !complete) return;
    writeNewSessionProjectSnapshot(
      sourceKey,
      principal,
      projects,
      visitsLoading ? undefined : recentProjectIds,
      projectId,
    );
  }, [
    sourceKey,
    principal,
    resolved,
    projects,
    complete,
    recentProjectIds,
    visitsLoading,
    projectId,
  ]);
  return useMemo(() => {
    const liveIds = new Set(projects.map((project) => project.id));
    const cached =
      snapshot?.projects.filter((project) => !liveIds.has(project.id)) ?? [];
    return {
      projects:
        !complete && cached.length ? [...projects, ...cached] : projects,
      cachedProjects: cached,
      unconfirmedProjectIds: cached.map((project) => project.id),
      recentProjectIds: visitsLoading
        ? (snapshot?.recentProjectIds ?? recentProjectIds)
        : recentProjectIds,
    };
  }, [projects, complete, snapshot, visitsLoading, recentProjectIds]);
}
