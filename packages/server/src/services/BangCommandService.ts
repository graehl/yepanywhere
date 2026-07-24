/**
 * BangCommandService runs `!!command` composer submissions as local shell
 * commands in a session's project directory, entirely outside provider
 * context. Each run persists as a `bang-command` transcript display object
 * (bounded previews in session metadata); full output lands in per-session
 * files under {dataDir}/bang-commands/ and is fetched on demand.
 *
 * Contract: topics/bang-commands.md.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type {
  BangCommandTranscriptDisplayObject,
  TranscriptDisplayObject,
} from "@yep-anywhere/shared";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";

const STDOUT_PREVIEW_MAX_CHARS = 4096;
const STDERR_PREVIEW_MAX_CHARS = 2048;
const OUTPUT_FILE_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_FLUSH_INTERVAL_MS = 750;
const SIGKILL_GRACE_MS = 2000;
const MAX_BANG_OBJECTS_PER_SESSION = 100;
export const BANG_OUTPUT_READ_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Agent-session identity markers scrubbed from the child environment so a
 * bang-run tool (e.g. agentctl) never adopts an agent session's identity.
 * BASH_ENV is scrubbed too: an agent launcher's bridge script would
 * otherwise be re-sourced by the child bash and re-inject the identity
 * vars this list just removed.
 */
const SCRUBBED_ENV_VARS = [
  "AGENTCTL_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDECODE",
  "BASH_ENV",
];

interface BangEventSink {
  emit(event: {
    type: "session-metadata-changed";
    sessionId: string;
    transcriptDisplayObjects: TranscriptDisplayObject[];
    timestamp: string;
  }): void;
}

export interface BangCommandServiceOptions {
  dataDir: string;
  sessionMetadataService: SessionMetadataService;
  eventBus?: BangEventSink;
  /** Wall-clock cap per command; the run is killed past it. */
  timeoutMs?: number;
  /** Coalescing interval for streaming preview updates. */
  flushIntervalMs?: number;
}

export interface BangRunRequest {
  sessionId: string;
  projectPath: string;
  command: string;
  placementAfterMessageId: string;
}

export interface BangRunHandle {
  object: BangCommandTranscriptDisplayObject;
  /** Resolves with the final object state; never rejects. */
  completion: Promise<BangCommandTranscriptDisplayObject>;
}

interface RunningEntry {
  sessionId: string;
  child: ReturnType<typeof spawn>;
  killedReason?: string;
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function appendTail(tail: string, chunk: string, maxChars: number): string {
  return (tail + chunk).slice(-maxChars);
}

export class BangCommandService {
  private readonly dataDir: string;
  private readonly metadata: SessionMetadataService;
  private readonly eventBus?: BangEventSink;
  private readonly timeoutMs: number;
  private readonly flushIntervalMs: number;
  private readonly running = new Map<string, RunningEntry>();

  constructor(options: BangCommandServiceOptions) {
    this.dataDir = options.dataDir;
    this.metadata = options.sessionMetadataService;
    this.eventBus = options.eventBus;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  isRunning(objectId: string): boolean {
    return this.running.has(objectId);
  }

  outputPath(sessionId: string, objectId: string, stream: "stdout" | "stderr") {
    return path.join(
      this.dataDir,
      "bang-commands",
      safePathSegment(sessionId),
      `${safePathSegment(objectId)}.${stream}`,
    );
  }

  async run(request: BangRunRequest): Promise<BangRunHandle> {
    const { sessionId, projectPath, command } = request;
    const id = randomUUID();
    const startedAtMs = Date.now();
    const object: BangCommandTranscriptDisplayObject = {
      id,
      kind: "bang-command",
      createdAt: new Date(startedAtMs).toISOString(),
      placementAfterMessageId: request.placementAfterMessageId,
      command,
      cwd: projectPath,
      status: "running",
    };

    await this.pruneOldObjects(sessionId);
    await this.metadata.addTranscriptDisplayObject(sessionId, object);
    this.emitObjects(sessionId);

    const outDir = path.dirname(this.outputPath(sessionId, id, "stdout"));
    await fsp.mkdir(outDir, { recursive: true });
    const stdoutFile = fs.createWriteStream(
      this.outputPath(sessionId, id, "stdout"),
    );
    const stderrFile = fs.createWriteStream(
      this.outputPath(sessionId, id, "stderr"),
    );

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of SCRUBBED_ENV_VARS) {
      delete env[name];
    }
    env.PATH = env.PATH
      ? `${env.PATH}${path.delimiter}${projectPath}`
      : projectPath;

    // detached: the child leads its own process group so kill() can signal
    // the whole pipeline, not just the bash wrapper.
    const child = spawn("bash", ["-c", command], {
      cwd: projectPath,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const entry: RunningEntry = { sessionId, child };
    this.running.set(id, entry);

    let stdoutTail = "";
    let stderrTail = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let spawnError: string | undefined;
    let dirty = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < OUTPUT_FILE_MAX_BYTES) {
        stdoutFile.write(chunk);
      } else {
        stdoutTruncated = true;
      }
      stdoutBytes += chunk.length;
      stdoutTail = appendTail(
        stdoutTail,
        chunk.toString("utf8"),
        STDOUT_PREVIEW_MAX_CHARS,
      );
      dirty = true;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < OUTPUT_FILE_MAX_BYTES) {
        stderrFile.write(chunk);
      } else {
        stderrTruncated = true;
      }
      stderrBytes += chunk.length;
      stderrTail = appendTail(
        stderrTail,
        chunk.toString("utf8"),
        STDERR_PREVIEW_MAX_CHARS,
      );
      dirty = true;
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });

    const previewPatch = (): Partial<BangCommandTranscriptDisplayObject> => ({
      stdoutPreview: stdoutTail || undefined,
      stderrPreview: stderrTail || undefined,
      stdoutBytes,
      stderrBytes,
      stdoutTruncated: stdoutTruncated || undefined,
      stderrTruncated: stderrTruncated || undefined,
    });

    const flushTimer = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      void this.updateObject(sessionId, id, previewPatch());
    }, this.flushIntervalMs);
    const timeoutTimer = setTimeout(() => {
      this.killEntry(
        id,
        `Timed out after ${Math.round(this.timeoutMs / 1000)}s`,
      );
    }, this.timeoutMs);

    const completion = new Promise<BangCommandTranscriptDisplayObject>(
      (resolve) => {
        child.on("close", (code, signal) => {
          clearInterval(flushTimer);
          clearTimeout(timeoutTimer);
          this.running.delete(id);
          void (async () => {
            await Promise.all([
              new Promise((r) => stdoutFile.end(r)),
              new Promise((r) => stderrFile.end(r)),
            ]);
            const killedReason = entry.killedReason;
            const patch: Partial<BangCommandTranscriptDisplayObject> = {
              ...previewPatch(),
              durationMs: Date.now() - startedAtMs,
              status: killedReason ? "killed" : spawnError ? "error" : "done",
              exitCode: code ?? undefined,
              error:
                killedReason ??
                spawnError ??
                (code === null && signal
                  ? `Terminated by signal ${signal}`
                  : undefined),
            };
            const updated = await this.updateObject(sessionId, id, patch);
            resolve(updated ?? { ...object, ...patch });
          })();
        });
      },
    );

    return { object, completion };
  }

  /** Request termination of a running command's process group. */
  kill(objectId: string, reason = "Cancelled"): boolean {
    return this.killEntry(objectId, reason);
  }

  private killEntry(objectId: string, reason: string): boolean {
    const entry = this.running.get(objectId);
    if (!entry) {
      return false;
    }
    entry.killedReason = reason;
    this.signalEntry(entry, "SIGTERM");
    setTimeout(() => {
      if (this.running.has(objectId)) {
        this.signalEntry(entry, "SIGKILL");
      }
    }, SIGKILL_GRACE_MS).unref();
    return true;
  }

  private signalEntry(entry: RunningEntry, signal: NodeJS.Signals): void {
    const pid = entry.child.pid;
    try {
      if (pid) {
        process.kill(-pid, signal);
      } else {
        entry.child.kill(signal);
      }
    } catch {
      try {
        entry.child.kill(signal);
      } catch {
        // Process already gone.
      }
    }
  }

  async readOutput(
    sessionId: string,
    objectId: string,
  ): Promise<{ stdout: string; stderr: string; responseTruncated: boolean }> {
    const read = async (stream: "stdout" | "stderr") => {
      try {
        const handle = await fsp.open(
          this.outputPath(sessionId, objectId, stream),
          "r",
        );
        try {
          const stat = await handle.stat();
          const length = Math.min(stat.size, BANG_OUTPUT_READ_MAX_BYTES);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, 0);
          return {
            text: buffer.toString("utf8"),
            truncated: stat.size > length,
          };
        } finally {
          await handle.close();
        }
      } catch {
        return { text: "", truncated: false };
      }
    };
    const [stdout, stderr] = await Promise.all([read("stdout"), read("stderr")]);
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      responseTruncated: stdout.truncated || stderr.truncated,
    };
  }

  /** Remove a finished command's display object and stored output. */
  async remove(sessionId: string, objectId: string): Promise<boolean> {
    if (this.running.has(objectId)) {
      return false;
    }
    const removed = await this.metadata.removeTranscriptDisplayObject(
      sessionId,
      objectId,
    );
    if (removed) {
      await this.deleteOutputs(sessionId, objectId);
      this.emitObjects(sessionId);
    }
    return removed;
  }

  private async deleteOutputs(
    sessionId: string,
    objectId: string,
  ): Promise<void> {
    for (const stream of ["stdout", "stderr"] as const) {
      await fsp
        .unlink(this.outputPath(sessionId, objectId, stream))
        .catch(() => {});
    }
  }

  private async pruneOldObjects(sessionId: string): Promise<void> {
    const bangObjects = this.metadata
      .getTranscriptDisplayObjects(sessionId)
      .filter((object) => object.kind === "bang-command");
    const excess = bangObjects.length - (MAX_BANG_OBJECTS_PER_SESSION - 1);
    if (excess <= 0) {
      return;
    }
    const oldest = [...bangObjects]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, excess);
    for (const object of oldest) {
      await this.metadata.removeTranscriptDisplayObject(sessionId, object.id);
      await this.deleteOutputs(sessionId, object.id);
    }
  }

  private async updateObject(
    sessionId: string,
    objectId: string,
    patch: Partial<BangCommandTranscriptDisplayObject>,
  ): Promise<BangCommandTranscriptDisplayObject | undefined> {
    const updated = await this.metadata.updateTranscriptDisplayObject(
      sessionId,
      objectId,
      (object) =>
        object.kind === "bang-command" ? { ...object, ...patch } : object,
    );
    this.emitObjects(sessionId);
    return updated?.kind === "bang-command" ? updated : undefined;
  }

  private emitObjects(sessionId: string): void {
    this.eventBus?.emit({
      type: "session-metadata-changed",
      sessionId,
      transcriptDisplayObjects:
        this.metadata.getTranscriptDisplayObjects(sessionId),
      timestamp: new Date().toISOString(),
    });
  }
}
