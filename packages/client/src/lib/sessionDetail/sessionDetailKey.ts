import type { ClientSummarySourceKey } from "../clientSummaryStore";

export interface SessionDetailEntryKeyInput {
  sourceKey: ClientSummarySourceKey;
  projectId: string;
  sessionId: string;
  initialHistoryCompactions?: number | null;
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
  initialHistoryCompactions,
  tailTurns,
  tailFrom,
}: SessionDetailEntryKeyInput): string {
  const base = [
    encodeKeyPart(sourceKey),
    encodeKeyPart(projectId),
    encodeKeyPart(sessionId),
  ].join(":");
  const variant = [
    initialHistoryCompactions !== undefined
      ? `initialHistory=${initialHistoryCompactions ?? "unlimited"}`
      : "",
    tailTurns !== undefined ? `tailTurns=${tailTurns}` : "",
    tailFrom ? `tailFrom=${encodeKeyPart(tailFrom)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  return variant ? `${base}?${variant}` : base;
}
