import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SummaryParserClient,
  resolveSummaryParserWorkerEntrypoint,
  supportsTsxImportWorker,
  type InProcessSummaryParser,
} from "../../src/sessions/summary-parser-worker-client.js";
import type {
  SummaryParserClientEvent,
  SummaryParserWorkerRequest,
} from "../../src/sessions/summary-parser-worker-protocol.js";
import { runSummaryParserWorkerRequest } from "../../src/sessions/summary-parser-worker-runner.js";
import type { SessionSummary } from "../../src/supervisor/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..", "..");
const sourceWorkerSupported = supportsTsxImportWorker(process.versions.node);
const itIfSourceWorker = sourceWorkerSupported ? it : it.skip;

async function fileStats(filePath: string) {
  const stats = await stat(filePath);
  return {
    size: Number(stats.size),
    mtimeMs: Number(stats.mtimeMs),
    mtimeIso: stats.mtime.toISOString(),
  };
}

function sourceEntrypoint() {
  return resolveSummaryParserWorkerEntrypoint({
    runtime: "source",
    baseDir: join(packageRoot, "src", "sessions"),
  });
}

function fakeSummary(request: SummaryParserWorkerRequest): SessionSummary {
  return {
    id: request.sessionId,
    projectId: request.projectId,
    title: "fallback summary",
    fullTitle: "fallback summary",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    messageCount: 1,
    ownership: { owner: "none" },
    provider: request.provider === "codex" ? "codex" : "claude",
  };
}

describe("summary parser worker harness", () => {
  let testDir: string;
  let dataDir: string;
  let client: SummaryParserClient | null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `summary-parser-worker-${randomUUID()}`);
    dataDir = join(testDir, "ya-data");
    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    client = null;
  });

  afterEach(async () => {
    await client?.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it("guards source tsx workers to Node 20.6 and later", () => {
    expect(supportsTsxImportWorker("20.5.1")).toBe(false);
    expect(supportsTsxImportWorker("20.6.0")).toBe(true);
    expect(supportsTsxImportWorker("21.0.0")).toBe(true);
    expect(supportsTsxImportWorker("v25.8.2")).toBe(true);
  });

  it("resolves built worker entrypoint without tsx exec args", () => {
    const entrypoint = resolveSummaryParserWorkerEntrypoint({
      runtime: "built",
      baseDir: join(packageRoot, "dist", "sessions"),
    });

    expect(entrypoint.supported).toBe(true);
    if (!entrypoint.supported) return;
    expect(entrypoint.runtime).toBe("built");
    expect(entrypoint.execArgv).toEqual([]);
    expect(entrypoint.modulePath.endsWith("summary-parser-worker-entry.js")).toBe(
      true,
    );
  });

  itIfSourceWorker("parses a Claude fixture through a source worker", async () => {
    const sessionId = "claude-worker-session";
    const filePath = join(testDir, `${sessionId}.jsonl`);
    const now = "2026-06-30T00:00:00.000Z";
    const later = "2026-06-30T00:00:01.000Z";
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: now,
          message: {
            content: "Explain the worker harness",
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          parentUuid: "user-1",
          timestamp: later,
          message: {
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text: "It isolates parsing." }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          },
        }),
      ].join("\n") + "\n",
    );

    client = new SummaryParserClient({
      mode: "required",
      cwd: packageRoot,
      entrypoint: sourceEntrypoint(),
      timeoutMs: 15_000,
      launchTimeoutMs: 10_000,
    });

    const request: SummaryParserWorkerRequest = {
      type: "parse",
      requestId: randomUUID(),
      provider: "claude",
      filePath,
      sessionId,
      projectId: "worker-project" as UrlProjectId,
      stats: await fileStats(filePath),
    };
    const result = await client.parse(request);

    expect(result.source).toBe("worker");
    expect(result.status).toBe("ok");
    expect(result.summary?.title).toBe("Explain the worker harness");
    expect(result.summary?.messageCount).toBe(2);
    expect(result.response?.metrics.workerPid).not.toBe(process.pid);
  });

  itIfSourceWorker("parses a Codex fixture through a source worker", async () => {
    const sessionId = "codex-worker-session";
    const projectPath = "/test/project";
    const filePath = join(testDir, `${sessionId}.jsonl`);
    const now = "2026-06-30T00:00:00.000Z";
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: now,
          payload: {
            id: sessionId,
            cwd: projectPath,
            timestamp: now,
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          type: "turn_context",
          timestamp: now,
          payload: { model: "gpt-5" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: now,
          payload: {
            type: "user_message",
            message: "Hello from Codex",
          },
        }),
      ].join("\n") + "\n",
    );

    client = new SummaryParserClient({
      mode: "required",
      cwd: packageRoot,
      entrypoint: sourceEntrypoint(),
      timeoutMs: 15_000,
      launchTimeoutMs: 10_000,
    });

    const request: SummaryParserWorkerRequest = {
      type: "parse",
      requestId: randomUUID(),
      provider: "codex",
      filePath,
      sessionId,
      projectId: "worker-project" as UrlProjectId,
      stats: await fileStats(filePath),
      sourceHints: {
        codex: {
          sessionsDir: testDir,
          projectPath,
          dataDir,
        },
      },
    };
    const result = await client.parse(request);

    expect(result.source).toBe("worker");
    expect(result.status).toBe("ok");
    expect(result.summary?.title).toBe("Hello from Codex");
    expect(result.summary?.provider).toBe("codex");
    expect(result.response?.metrics.lineCount).toBe(3);
  });

  it("falls back in on mode when the worker is unsupported", async () => {
    const events: SummaryParserClientEvent[] = [];
    client = new SummaryParserClient({
      mode: "on",
      entrypoint: {
        supported: false,
        runtime: "source",
        reason: "source worker requires Node >=20.6",
      },
      onEvent: (event) => events.push(event),
    });
    const fallback: InProcessSummaryParser = async (request) =>
      fakeSummary(request);
    const request: SummaryParserWorkerRequest = {
      type: "parse",
      requestId: randomUUID(),
      provider: "claude",
      filePath: join(testDir, "missing.jsonl"),
      sessionId: "fallback-session",
      projectId: "worker-project" as UrlProjectId,
      stats: { size: 0, mtimeMs: 0 },
    };

    const result = await client.parse(request, fallback);

    expect(result.source).toBe("fallback");
    expect(result.status).toBe("fallback");
    expect(result.summary?.title).toBe("fallback summary");
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "summary_parser_worker_fallback",
        fallbackReason: "source worker requires Node >=20.6",
      }),
    );
  });

  it("does not fall back in required mode when the worker is unsupported", async () => {
    client = new SummaryParserClient({
      mode: "required",
      entrypoint: {
        supported: false,
        runtime: "source",
        reason: "source worker requires Node >=20.6",
      },
    });
    const request: SummaryParserWorkerRequest = {
      type: "parse",
      requestId: randomUUID(),
      provider: "claude",
      filePath: join(testDir, "missing.jsonl"),
      sessionId: "required-session",
      projectId: "worker-project" as UrlProjectId,
      stats: { size: 0, mtimeMs: 0 },
    };

    await expect(client.parse(request, async () => fakeSummary(request))).rejects
      .toThrow("source worker requires Node >=20.6");
  });

  it("can run the same parser in-process for explicit fallback", async () => {
    const sessionId = "in-process-session";
    const filePath = join(testDir, `${sessionId}.jsonl`);
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: "user",
        uuid: "user-1",
        timestamp: "2026-06-30T00:00:00.000Z",
        message: { content: "Fallback parse" },
      })}\n`,
    );
    const request: SummaryParserWorkerRequest = {
      type: "parse",
      requestId: randomUUID(),
      provider: "claude",
      filePath,
      sessionId,
      projectId: "worker-project" as UrlProjectId,
      stats: await fileStats(filePath),
    };

    const response = await runSummaryParserWorkerRequest(request);

    expect(response.status).toBe("ok");
    expect(response.summary?.title).toBe("Fallback parse");
    expect(response.metrics.workerPid).toBe(process.pid);
  });
});
