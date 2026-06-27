export const PROJECT_QUEUE_CAPABILITY = "projectQueue";

export interface ProjectQueueCapabilitySource {
  capabilities?: readonly string[];
}

export interface ProjectQueueAffordanceState {
  projectId?: string | null;
  currentSessionId?: string | null;
  currentSessionIsActive?: boolean;
  currentSessionHasSessionQueueBacklog?: boolean;
  activeProjectSessionIds?: readonly string[];
  projectActiveSessionCount?: number | null;
  projectQueueItemCount?: number | null;
}

export function serverSupportsProjectQueue(
  version: ProjectQueueCapabilitySource | null | undefined,
): boolean {
  return version?.capabilities?.includes(PROJECT_QUEUE_CAPABILITY) ?? false;
}

export function shouldShowProjectQueueAffordance({
  projectId,
  currentSessionId,
  currentSessionIsActive = false,
  currentSessionHasSessionQueueBacklog = false,
  activeProjectSessionIds = [],
  projectActiveSessionCount = null,
  projectQueueItemCount = 0,
}: ProjectQueueAffordanceState): boolean {
  if (!projectId) return false;
  if ((projectQueueItemCount ?? 0) > 0) return true;

  let knownCurrentSessionIsActive = currentSessionIsActive;
  for (const activeSessionId of activeProjectSessionIds) {
    if (activeSessionId === currentSessionId) {
      knownCurrentSessionIsActive = true;
      continue;
    }
    return true;
  }

  if (projectActiveSessionCount !== null) {
    const currentActiveCount = knownCurrentSessionIsActive ? 1 : 0;
    if (projectActiveSessionCount > currentActiveCount) {
      return true;
    }
  }

  return knownCurrentSessionIsActive && currentSessionHasSessionQueueBacklog;
}
