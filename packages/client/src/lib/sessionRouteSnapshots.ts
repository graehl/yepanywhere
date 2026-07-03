import type { PaginationInfo } from "../api/client";
import type { AgentContentMap } from "../hooks/useSessionMessages";
import type { Message, SessionMetadata } from "../types";
import {
  defaultSessionDetailStore,
  getSessionDetailEntryKey,
  type SessionDetailEntryKeyInput,
  type SessionDetailRetentionOptions,
} from "./sessionDetail/sessionDetailStore";

/**
 * Session route snapshots are the serializable transcript-window DTO used for
 * warm route reveals. Runtime ownership now lives in `SessionDetailStore`;
 * the functions in this module remain as a legacy compatibility surface.
 */
export interface SessionRouteScrollSnapshot {
  atBottom: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchor?: {
    id: string;
    topOffset: number;
  };
  updatedAtMs: number;
}

export interface SessionRouteSnapshot {
  messages: Message[];
  session: SessionMetadata;
  pagination?: PaginationInfo;
  agentContent: AgentContentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  scrollSnapshot?: SessionRouteScrollSnapshot;
}

export type SessionRouteSnapshotKeyInput = SessionDetailEntryKeyInput;
export interface SessionRouteSnapshotWriteOptions
  extends SessionDetailRetentionOptions {}

export function getSessionRouteSnapshotKey({
  sourceKey,
  projectId,
  sessionId,
  tailTurns,
  tailFrom,
}: SessionRouteSnapshotKeyInput): string {
  return getSessionDetailEntryKey({
    sourceKey,
    projectId,
    sessionId,
    tailTurns,
    tailFrom,
  });
}

export function readSessionRouteSnapshot(
  input: SessionRouteSnapshotKeyInput,
  options: Pick<SessionRouteSnapshotWriteOptions, "nowMs"> = {},
): SessionRouteSnapshot | undefined {
  if (typeof window === "undefined") return undefined;
  return defaultSessionDetailStore.readRouteSnapshot(input, options);
}

export function writeSessionRouteSnapshot(
  input: SessionRouteSnapshotKeyInput,
  snapshot: SessionRouteSnapshot,
  options: SessionRouteSnapshotWriteOptions = {},
): boolean {
  if (typeof window === "undefined") return false;
  return defaultSessionDetailStore.writeRouteSnapshot(input, snapshot, options);
}

export function patchSessionRouteScrollSnapshot(
  input: SessionRouteSnapshotKeyInput,
  scrollSnapshot: SessionRouteScrollSnapshot,
): void {
  if (typeof window === "undefined") return;
  defaultSessionDetailStore.patchScrollSnapshot(input, scrollSnapshot);
}

export function clearSessionRouteSnapshots(): void {
  defaultSessionDetailStore.clear();
}

export function resetSessionRouteSnapshotsForTests(): void {
  clearSessionRouteSnapshots();
}
