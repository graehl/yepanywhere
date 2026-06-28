import type { ClientSummarySourceKey } from "./clientSummaryStore";

const PENDING_ELSEWHERE_DISMISS_KEY_PREFIX =
  "yepanywhere:pending-elsewhere-dismissed:";

function encodeStorageKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function createPendingElsewhereDismissKey(
  sourceKey: ClientSummarySourceKey,
  sessionId: string,
): string {
  return `${PENDING_ELSEWHERE_DISMISS_KEY_PREFIX}${encodeStorageKeyPart(sourceKey)}:${encodeStorageKeyPart(sessionId)}`;
}
