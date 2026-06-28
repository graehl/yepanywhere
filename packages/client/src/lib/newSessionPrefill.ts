import type { ClientSummarySourceKey } from "./clientSummaryStore";

const NEW_SESSION_PREFILL_KEY_PREFIX = "new-session-prefill:";

function encodePrefillKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function createNewSessionPrefillKey(
  sourceKey: ClientSummarySourceKey,
): string {
  return `${NEW_SESSION_PREFILL_KEY_PREFIX}${encodePrefillKeyPart(sourceKey)}`;
}

export function getNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(createNewSessionPrefillKey(sourceKey));
}

export function clearNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(createNewSessionPrefillKey(sourceKey));
}

export function setNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
  text: string,
): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(createNewSessionPrefillKey(sourceKey), text);
}
