export const PROJECT_QUEUE_CAPABILITY = "projectQueue";

export interface ProjectQueueCapabilitySource {
  capabilities?: readonly string[];
}

export interface ProjectQueueAffordanceState {
  projectId?: string | null;
  currentSessionId?: string | null;
  currentSessionBlocksProjectQueue?: boolean;
  currentSessionHasSessionQueueBacklog?: boolean;
  activeProjectSessionIds?: readonly string[];
  projectQueueBlockingCount?: number | null;
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
  currentSessionBlocksProjectQueue = false,
  currentSessionHasSessionQueueBacklog = false,
  activeProjectSessionIds = [],
  projectQueueBlockingCount = null,
  projectQueueItemCount = 0,
}: ProjectQueueAffordanceState): boolean {
  if (!projectId) return false;
  if ((projectQueueItemCount ?? 0) > 0) return true;

  let knownCurrentSessionBlocksProjectQueue =
    currentSessionBlocksProjectQueue || currentSessionHasSessionQueueBacklog;
  for (const activeSessionId of activeProjectSessionIds) {
    if (activeSessionId === currentSessionId) {
      knownCurrentSessionBlocksProjectQueue = true;
      continue;
    }
    return true;
  }

  if (projectQueueBlockingCount !== null) {
    const currentBlockingCount = knownCurrentSessionBlocksProjectQueue ? 1 : 0;
    if (projectQueueBlockingCount > currentBlockingCount) {
      return true;
    }
  }

  return currentSessionHasSessionQueueBacklog;
}
