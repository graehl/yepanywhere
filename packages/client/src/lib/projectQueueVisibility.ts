export const PROJECT_QUEUE_CAPABILITY = "projectQueue";

export interface ProjectQueueCapabilitySource {
  capabilities?: readonly string[];
}

export interface ProjectQueueAffordanceState {
  projectId?: string | null;
  currentSessionId?: string | null;
  currentSessionHasSessionQueueBacklog?: boolean;
  activeProjectSessionIds?: readonly string[];
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
  currentSessionHasSessionQueueBacklog = false,
  activeProjectSessionIds = [],
  projectQueueItemCount = 0,
}: ProjectQueueAffordanceState): boolean {
  if (!projectId) return false;
  if ((projectQueueItemCount ?? 0) > 0) return true;

  let currentSessionIsActive = false;
  for (const activeSessionId of activeProjectSessionIds) {
    if (activeSessionId === currentSessionId) {
      currentSessionIsActive = true;
      continue;
    }
    return true;
  }

  return currentSessionIsActive && currentSessionHasSessionQueueBacklog;
}
