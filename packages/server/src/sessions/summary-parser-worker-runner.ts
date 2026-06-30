import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { getModelContextWindow, type ProviderName } from "@yep-anywhere/shared";
import type { SessionSummary } from "../supervisor/types.js";
import { CodexSessionReader } from "./codex-reader.js";
import { readClaudeSessionSummary } from "./claude-summary.js";
import {
  type SummaryParserWorkerMetrics,
  type SummaryParserWorkerRequest,
  type SummaryParserWorkerResponse,
  sanitizeSummaryParserError,
} from "./summary-parser-worker-protocol.js";

interface ParsedSummaryResult {
  summary: SessionSummary | null;
  metrics?: Partial<SummaryParserWorkerMetrics>;
}

function contextWindowFromHints(
  request: SummaryParserWorkerRequest,
  model: string | undefined,
  provider?: ProviderName,
): number {
  const hints = request.contextWindowHints;
  const providerKey = `${provider ?? ""}:${model ?? ""}`;
  const modelKey = model ?? "";
  return (
    hints?.byModelProvider?.[providerKey] ??
    hints?.byModelProvider?.[modelKey] ??
    hints?.defaultContextWindow ??
    getModelContextWindow(model, provider)
  );
}

async function parseClaudeSummary(
  request: SummaryParserWorkerRequest,
): Promise<ParsedSummaryResult> {
  const stats = await stat(request.filePath);
  const parseStartedAt = Date.now();
  const summary = await readClaudeSessionSummary({
    filePath: request.filePath,
    stats,
    sessionId: request.sessionId,
    projectId: request.projectId,
    resolveContextWindow: (model, provider) =>
      contextWindowFromHints(request, model, provider),
  });

  return {
    summary,
    metrics: {
      parseMs: Date.now() - parseStartedAt,
      fileSize: Number(stats.size),
      fileMtimeMs: Number(stats.mtimeMs),
    },
  };
}

async function parseCodexSummary(
  request: SummaryParserWorkerRequest,
): Promise<ParsedSummaryResult> {
  const hints = request.sourceHints?.codex;
  const reader = new CodexSessionReader({
    sessionsDir: hints?.sessionsDir ?? dirname(request.filePath),
    ...(hints?.projectPath ? { projectPath: hints.projectPath } : {}),
    ...(hints?.dataDir ? { dataDir: hints.dataDir } : {}),
  });
  const summary = await reader.getSessionSummary(
    request.sessionId,
    request.projectId,
  );
  const streamMetrics = reader.getLastSummaryStreamMetrics();

  return {
    summary,
    metrics: streamMetrics
      ? {
          fileSize: streamMetrics.fileSize,
          fileMtimeMs: streamMetrics.fileMtimeMs,
          durationMs: streamMetrics.durationMs,
          parseMs: streamMetrics.parseMs,
          lineCount: streamMetrics.lineCount,
          parsedEntries: streamMetrics.parsedEntries,
          dedupedEntries: streamMetrics.dedupedEntries,
          skippedDuplicateEntries: streamMetrics.skippedDuplicateEntries,
          maxLineLength: streamMetrics.maxLineLength,
        }
      : undefined,
  };
}

async function parseSummary(
  request: SummaryParserWorkerRequest,
): Promise<ParsedSummaryResult> {
  switch (request.provider) {
    case "claude":
      return parseClaudeSummary(request);
    case "codex":
      return parseCodexSummary(request);
  }
}

export async function runSummaryParserWorkerRequest(
  request: SummaryParserWorkerRequest,
): Promise<SummaryParserWorkerResponse> {
  const startedAt = Date.now();
  const memoryBefore = process.memoryUsage();

  try {
    const result = await parseSummary(request);
    const memoryAfter = process.memoryUsage();
    const metrics: SummaryParserWorkerMetrics = {
      provider: request.provider,
      sessionId: request.sessionId,
      filePath: request.filePath,
      fileSize: result.metrics?.fileSize ?? request.stats.size,
      fileMtimeMs: result.metrics?.fileMtimeMs ?? request.stats.mtimeMs,
      workerPid: process.pid,
      nodeVersion: process.version,
      durationMs: result.metrics?.durationMs ?? Date.now() - startedAt,
      ...(result.metrics?.parseMs !== undefined
        ? { parseMs: result.metrics.parseMs }
        : {}),
      ...(result.metrics?.lineCount !== undefined
        ? { lineCount: result.metrics.lineCount }
        : {}),
      ...(result.metrics?.parsedEntries !== undefined
        ? { parsedEntries: result.metrics.parsedEntries }
        : {}),
      ...(result.metrics?.malformedLines !== undefined
        ? { malformedLines: result.metrics.malformedLines }
        : {}),
      ...(result.metrics?.dedupedEntries !== undefined
        ? { dedupedEntries: result.metrics.dedupedEntries }
        : {}),
      ...(result.metrics?.skippedDuplicateEntries !== undefined
        ? { skippedDuplicateEntries: result.metrics.skippedDuplicateEntries }
        : {}),
      ...(result.metrics?.maxLineLength !== undefined
        ? { maxLineLength: result.metrics.maxLineLength }
        : {}),
      heapUsedBefore: memoryBefore.heapUsed,
      heapUsedAfter: memoryAfter.heapUsed,
      rssBefore: memoryBefore.rss,
      rssAfter: memoryAfter.rss,
      ...(request.limits?.recycleAfterLineBytes !== undefined &&
      result.metrics?.maxLineLength !== undefined &&
      result.metrics.maxLineLength >= request.limits.recycleAfterLineBytes
        ? {
            recycleRecommended: true,
            recycleReason: "large_line",
          }
        : {}),
    };

    return {
      type: "result",
      requestId: request.requestId,
      status: result.summary ? "ok" : "empty",
      summary: result.summary,
      metrics,
    };
  } catch (error) {
    const memoryAfter = process.memoryUsage();
    return {
      type: "result",
      requestId: request.requestId,
      status: "error",
      summary: null,
      metrics: {
        provider: request.provider,
        sessionId: request.sessionId,
        filePath: request.filePath,
        fileSize: request.stats.size,
        fileMtimeMs: request.stats.mtimeMs,
        workerPid: process.pid,
        nodeVersion: process.version,
        durationMs: Date.now() - startedAt,
        heapUsedBefore: memoryBefore.heapUsed,
        heapUsedAfter: memoryAfter.heapUsed,
        rssBefore: memoryBefore.rss,
        rssAfter: memoryAfter.rss,
      },
      error: sanitizeSummaryParserError(error),
    };
  }
}
