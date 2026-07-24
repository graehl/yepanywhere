/**
 * BangCommandService lifecycle: run/complete, previews, project-dir command
 * resolution, env scrubbing, truncation flags, kill, timeout, delete, and
 * restart recovery. Contract: topics/bang-commands.md.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { BangCommandTranscriptDisplayObject } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import { BangCommandService } from "../../src/services/BangCommandService.js";

const SESSION = "session-1";

let dataDir: string;
let projectDir: string;
let metadata: SessionMetadataService;
let events: Array<{ type: string; sessionId: string }>;

function createService(options: { timeoutMs?: number } = {}) {
  return new BangCommandService({
    dataDir,
    sessionMetadataService: metadata,
    eventBus: {
      emit: (event) => {
        events.push({ type: event.type, sessionId: event.sessionId });
      },
    },
    flushIntervalMs: 50,
    ...options,
  });
}

function bangObjects(): BangCommandTranscriptDisplayObject[] {
  return metadata
    .getTranscriptDisplayObjects(SESSION)
    .filter(
      (object): object is BangCommandTranscriptDisplayObject =>
        object.kind === "bang-command",
    );
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-bang-data-"));
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-bang-proj-"));
  metadata = new SessionMetadataService({ dataDir });
  await metadata.initialize();
  events = [];
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe("BangCommandService", () => {
  it("runs a command and records exit, previews, and full output", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "echo hello; echo oops 1>&2; exit 3",
      placementAfterMessageId: "msg-1",
    });
    expect(object.status).toBe("running");
    const final = await completion;
    expect(final.status).toBe("done");
    expect(final.exitCode).toBe(3);
    expect(final.stdoutPreview).toBe("hello\n");
    expect(final.stderrPreview).toBe("oops\n");
    expect(final.durationMs).toBeGreaterThanOrEqual(0);
    expect(final.cwd).toBe(projectDir);
    expect(final.placementAfterMessageId).toBe("msg-1");

    const output = await service.readOutput(SESSION, object.id);
    expect(output.stdout).toBe("hello\n");
    expect(output.stderr).toBe("oops\n");
    expect(output.responseTruncated).toBe(false);

    // Persisted in metadata and announced via metadata-changed events.
    expect(bangObjects().map((entry) => entry.id)).toContain(object.id);
    expect(
      events.filter((event) => event.type === "session-metadata-changed"),
    ).not.toHaveLength(0);
  });

  it("resolves bare names from the project directory (implicit PATH tail)", async () => {
    const toolPath = path.join(projectDir, "mytool");
    await fs.writeFile(toolPath, "#!/usr/bin/env bash\necho from-project\n");
    execSync(`chmod +x ${toolPath}`);
    const service = createService();
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "mytool",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.exitCode).toBe(0);
    expect(final.stdoutPreview).toBe("from-project\n");
  });

  it("scrubs agent-session identity markers from the child env", async () => {
    vi.stubEnv("AGENTCTL_SESSION_ID", "leak-me");
    try {
      const service = createService();
      const { completion } = await service.run({
        sessionId: SESSION,
        projectPath: projectDir,
        command:
          'if [ -z "$AGENTCTL_SESSION_ID" ]; then echo scrubbed; else echo leaked; fi',
        placementAfterMessageId: "",
      });
      const final = await completion;
      expect(final.stdoutPreview).toBe("scrubbed\n");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("bounds the preview while keeping full output on disk", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "seq 1 5000",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.stdoutPreview?.length).toBeLessThanOrEqual(4096);
    expect(final.stdoutPreview?.endsWith("5000\n")).toBe(true);
    expect(final.stdoutBytes).toBeGreaterThan(4096);
    const output = await service.readOutput(SESSION, object.id);
    expect(output.stdout.startsWith("1\n2\n")).toBe(true);
  });

  it("kills a running command's process group", async () => {
    const service = createService();
    const { object, completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    expect(service.isRunning(object.id)).toBe(true);
    expect(service.kill(object.id)).toBe(true);
    const final = await completion;
    expect(final.status).toBe("killed");
    expect(final.error).toBe("Cancelled");
  });

  it("kills on timeout with a timeout reason", async () => {
    const service = createService({ timeoutMs: 300 });
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.status).toBe("killed");
    expect(final.error).toMatch(/Timed out/);
  });

  it("refuses to remove a running command, removes a finished one", async () => {
    const service = createService();
    const running = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: "sleep 30",
      placementAfterMessageId: "",
    });
    expect(await service.remove(SESSION, running.object.id)).toBe(false);
    service.kill(running.object.id);
    await running.completion;
    expect(await service.remove(SESSION, running.object.id)).toBe(true);
    expect(bangObjects()).toHaveLength(0);
    const output = await service.readOutput(SESSION, running.object.id);
    expect(output.stdout).toBe("");
  });

  it("marks running commands killed on restart recovery", async () => {
    await metadata.addTranscriptDisplayObject(SESSION, {
      id: "stale-run",
      kind: "bang-command",
      createdAt: new Date().toISOString(),
      placementAfterMessageId: "",
      command: "sleep 999",
      cwd: projectDir,
      status: "running",
    });
    const reloaded = new SessionMetadataService({ dataDir });
    await reloaded.initialize();
    const recovered = reloaded
      .getTranscriptDisplayObjects(SESSION)
      .find((object) => object.id === "stale-run");
    expect(recovered?.status).toBe("killed");
    expect(recovered?.error).toMatch(/restart/);
  });

  it("runs the harness-check acli fixture end to end", async () => {
    const fixtures = path.join(__dirname, "fixtures");
    for (const name of ["harness-check"]) {
      await fs.copyFile(
        path.join(fixtures, name),
        path.join(projectDir, name),
      );
      execSync(`chmod +x ${path.join(projectDir, name)}`);
    }
    const service = createService();
    const { completion } = await service.run({
      sessionId: SESSION,
      projectPath: projectDir,
      command: `PATH="${path.join(fixtures, "bin")}:$PATH" harness-check --md --registry ${path.join(fixtures, "registry.json")} --harnesses claude,codex`,
      placementAfterMessageId: "",
    });
    const final = await completion;
    expect(final.exitCode).toBe(0);
    expect(final.stdoutPreview).toContain("## Harness updates");
    expect(final.stdoutPreview).toContain("update-available");
  });
});
