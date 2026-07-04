import type { ClientSummarySourceKey } from "../clientSummaryStore";

export interface SessionDetailEntryKeyInput {
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function getSessionDetailEntryKey({
  sourceKey,
  projectId,
  sessionId,
  tailTurns,
  tailFrom,
}: SessionDetailEntryKeyInput): string {
  const base = [
    encodeKeyPart(sourceKey),
    encodeKeyPart(projectId),
    encodeKeyPart(sessionId),
  ].join(":");
  const variant = [
    tailTurns !== undefined ? `tailTurns=${tailTurns}` : "",
    tailFrom ? `tailFrom=${encodeKeyPart(tailFrom)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  return variant ? `${base}?${variant}` : base;
}
