import type { PaginationInfo } from "../../api/client";

export type SessionLoadProgressStage =
  | "idle"
  | "fetching"
  | "rendering"
  | "complete"
  | "error";

export interface SessionLoadProgress {
  stage: SessionLoadProgressStage;
  messageCount?: number;
  totalMessageCount?: number;
  hasOlderMessages?: boolean;
  updatedAtMs: number;
}

export type SessionLoadProgressDetails = Omit<
  SessionLoadProgress,
  "stage" | "updatedAtMs"
>;

export function createSessionLoadProgress(
  stage: SessionLoadProgressStage,
  details: SessionLoadProgressDetails = {},
  nowMs = Date.now(),
): SessionLoadProgress {
  return {
    stage,
    ...details,
    updatedAtMs: nowMs,
  };
}

export function createSessionLoadProgressForWindow(
  stage: SessionLoadProgressStage,
  {
    messageCount,
    pagination,
    nowMs,
  }: {
    messageCount?: number;
    pagination?: Pick<PaginationInfo, "totalMessageCount" | "hasOlderMessages">;
    nowMs?: number;
  },
): SessionLoadProgress {
  return createSessionLoadProgress(
    stage,
    {
      messageCount,
      totalMessageCount: pagination?.totalMessageCount,
      hasOlderMessages: pagination?.hasOlderMessages,
    },
    nowMs,
  );
}
