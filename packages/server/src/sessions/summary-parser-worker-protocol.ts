import type { UrlProjectId } from "@yep-anywhere/shared";
import type { SessionSummary } from "../supervisor/types.js";

export type SummaryParserWorkerProvider = "claude" | "codex";

export type SummaryParserWorkerMode = "off" | "on" | "required";

export type SummaryParserResponseStatus = "ok" | "empty" | "error";

export type SummaryParserClientStatus =
  | SummaryParserResponseStatus
  | "fallback"
  | "timeout"
  | "crash"
  | "protocol_error";

export interface SummaryParserWorkerFileStats {
  size: number;
  mtimeMs: number;
  mtimeIso?: string;
}

export interface SummaryParserContextWindowHints {
  byModelProvider?: Record<string, number>;
  defaultContextWindow?: number;
}

export interface SummaryParserWorkerSourceHints {
  claude?: {
    sessionDir?: string;
  };
  codex?: {
    sessionsDir?: string;
    projectPath?: string;
    dataDir?: string;
  };
}

export interface SummaryParserWorkerLimits {
  timeoutMs?: number;
  recycleAfterBytes?: number;
  recycleAfterFiles?: number;
  recycleAfterLineBytes?: number;
}

export interface SummaryParserWorkerRequest {
  type: "parse";
  requestId: string;
  provider: SummaryParserWorkerProvider;
  filePath: string;
  sessionId: string;
  projectId: UrlProjectId;
  stats: SummaryParserWorkerFileStats;
  sourceHints?: SummaryParserWorkerSourceHints;
  contextWindowHints?: SummaryParserContextWindowHints;
  limits?: SummaryParserWorkerLimits;
}

export interface SummaryParserWorkerError {
  name: string;
  message: string;
}

export interface SummaryParserWorkerMetrics {
  provider: SummaryParserWorkerProvider;
  sessionId: string;
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  workerPid: number;
  workerGeneration?: number;
  nodeVersion: string;
  durationMs: number;
  parseMs?: number;
  lineCount?: number;
  parsedEntries?: number;
  malformedLines?: number;
  dedupedEntries?: number;
  skippedDuplicateEntries?: number;
  maxLineLength?: number;
  heapUsedBefore: number;
  heapUsedAfter: number;
  rssBefore: number;
  rssAfter: number;
  recycleRecommended?: boolean;
  recycleReason?: string;
}

export interface SummaryParserWorkerResponse {
  type: "result";
  requestId: string;
  status: SummaryParserResponseStatus;
  summary: SessionSummary | null;
  metrics: SummaryParserWorkerMetrics;
  error?: SummaryParserWorkerError;
}

export interface SummaryParserWorkerReady {
  type: "ready";
  pid: number;
  nodeVersion: string;
}

export type SummaryParserWorkerMessage =
  | SummaryParserWorkerReady
  | SummaryParserWorkerResponse;

export interface SummaryParserClientEvent {
  event: "summary_parser_worker_fallback" | "summary_parser_worker_result";
  provider: SummaryParserWorkerProvider;
  sessionId: string;
  filePath: string;
  mode: SummaryParserWorkerMode;
  status: SummaryParserClientStatus;
  fallbackReason?: string;
  workerPid?: number;
  workerGeneration?: number;
  error?: SummaryParserWorkerError;
}

export function sanitizeSummaryParserError(
  error: unknown,
): SummaryParserWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
    };
  }
  return {
    name: "Error",
    message: typeof error === "string" ? error : "Unknown error",
  };
}

export function isSummaryParserWorkerReady(
  value: unknown,
): value is SummaryParserWorkerReady {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "ready" &&
    typeof (value as { pid?: unknown }).pid === "number"
  );
}

export function isSummaryParserWorkerResponse(
  value: unknown,
): value is SummaryParserWorkerResponse {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "result" &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}
