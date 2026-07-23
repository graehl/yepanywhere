import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeProjectId } from "../../src/projects/paths.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { ExternalSessionTracker } from "../../src/supervisor/ExternalSessionTracker.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import { EventBus, type BusEvent } from "../../src/watcher/EventBus.js";

describe("ExternalSessionTracker", () => {
  it("does not mark owned active Claude sessions external on file changes", async () => {
    const eventBus = new EventBus();
    const events: BusEvent[] = [];
    eventBus.subscribe((event) => events.push(event));

    const projectId = encodeProjectId("/tmp/test");
    const supervisor = {
      getProcessForSession: vi.fn((sessionId: string) =>
        sessionId === "owned-active-session"
          ? { projectId, state: { type: "in-turn" } }
          : undefined,
      ),
    } as unknown as Supervisor;
    const scanner = {
      getProjectBySessionDirSuffix: vi.fn(),
    } as unknown as ProjectScanner;

    const tracker = new ExternalSessionTracker({
      eventBus,
      supervisor,
      scanner,
      decayMs: 100,
    });

    try {
      eventBus.emit({
        type: "file-change",
        provider: "claude",
        path: "/tmp/projects/-tmp-test/owned-active-session.jsonl",
        relativePath: "-tmp-test/owned-active-session.jsonl",
        changeType: "modify",
        fileType: "session",
        timestamp: new Date().toISOString(),
      });

      await Promise.resolve();

      expect(tracker.isExternal("owned-active-session")).toBe(false);
      expect(scanner.getProjectBySessionDirSuffix).not.toHaveBeenCalled();
      expect(
        events.some(
          (event) =>
            event.type === "session-status-changed" &&
            event.sessionId === "owned-active-session" &&
            event.ownership.owner === "external",
        ),
      ).toBe(false);
    } finally {
      tracker.dispose();
    }
  });

  it("does not mark recently aborted Claude sessions external on file changes", async () => {
    const eventBus = new EventBus();
    const projectId = encodeProjectId("/tmp/test");
    const supervisor = {
      getProcessForSession: vi.fn(() => undefined),
    } as unknown as Supervisor;
    const scanner = {
      getProjectBySessionDirSuffix: vi.fn(),
    } as unknown as ProjectScanner;

    const tracker = new ExternalSessionTracker({
      eventBus,
      supervisor,
      scanner,
      decayMs: 100,
      abortGraceMs: 1000,
    });

    try {
      eventBus.emit({
        type: "session-aborted",
        sessionId: "idle-reaped-session",
        projectId,
        timestamp: new Date().toISOString(),
      });
      eventBus.emit({
        type: "file-change",
        provider: "claude",
        path: "/tmp/projects/-tmp-test/idle-reaped-session.jsonl",
        relativePath: "-tmp-test/idle-reaped-session.jsonl",
        changeType: "modify",
        fileType: "session",
        timestamp: new Date().toISOString(),
      });

      await Promise.resolve();

      expect(tracker.isExternal("idle-reaped-session")).toBe(false);
      expect(scanner.getProjectBySessionDirSuffix).not.toHaveBeenCalled();
    } finally {
      tracker.dispose();
    }
  });

  it("emits only bounded fields for owned Codex file changes", async () => {
    const eventBus = new EventBus();
    const events: BusEvent[] = [];
    eventBus.subscribe((event) => events.push(event));
    const projectId = encodeProjectId("/tmp/codex-project");
    const sessionId = "019f28d9-2dff-7dd2-8326-4b0e6093aed4";
    const supervisor = {
      getProcessForSession: vi.fn((candidate: string) =>
        candidate === sessionId
          ? { projectId, state: { type: "in-turn" } }
          : undefined,
      ),
    } as unknown as Supervisor;
    const scanner = {
      getProjectBySessionDirSuffix: vi.fn(),
    } as unknown as ProjectScanner;
    const getSessionSummary = vi.fn(async () => ({
      id: sessionId,
      projectId,
      title: "Codex title",
      fullTitle: "Codex title",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:01.000Z",
      messageCount: 1,
      ownership: { owner: "none" as const },
      provider: "codex" as const,
    }));
    const getSessionListSummary = vi.fn(async () => ({
      id: sessionId,
      projectId,
      title: "Codex title",
      fullTitle: "Codex title",
      updatedAt: "2026-07-04T00:00:01.000Z",
      provider: "codex" as const,
    }));

    const tracker = new ExternalSessionTracker({
      eventBus,
      supervisor,
      scanner,
      decayMs: 100,
      getSessionSummary,
      getSessionListSummary,
    });

    try {
      eventBus.emit({
        type: "file-change",
        provider: "codex",
        path: `/tmp/codex/rollout-${sessionId}.jsonl`,
        relativePath: `2026/07/04/rollout-${sessionId}.jsonl`,
        changeType: "modify",
        fileType: "session",
        timestamp: new Date().toISOString(),
      });

      await vi.waitFor(() => {
        expect(getSessionListSummary).toHaveBeenCalledWith(
          sessionId,
          projectId,
        );
      });
      expect(getSessionSummary).not.toHaveBeenCalled();
      const update = events.find(
        (event) =>
          event.type === "session-updated" && event.sessionId === sessionId,
      );
      expect(update).toMatchObject({
        type: "session-updated",
        sessionId,
        projectId,
        title: "Codex title",
        updatedAt: "2026-07-04T00:00:01.000Z",
      });
      expect(update).not.toHaveProperty("messageCount");
      expect(update).not.toHaveProperty("contextUsage");
      expect(update).not.toHaveProperty("model");
      expect(update).not.toHaveProperty("lastAgentText");
      expect(tracker.isExternal(sessionId)).toBe(false);
    } finally {
      tracker.dispose();
    }
  });

  it("keeps external Codex creation complete before bounded updates", async () => {
    const eventBus = new EventBus();
    const events: BusEvent[] = [];
    eventBus.subscribe((event) => events.push(event));

    const projectPath = "/tmp/external-codex-project";
    const projectId = encodeProjectId(projectPath);
    const sessionId = "019f28d9-2dff-7dd2-8326-4b0e6093aed5";
    const tempDir = join(tmpdir(), `codex-external-${randomUUID()}`);
    const sessionFile = join(tempDir, `rollout-${sessionId}.jsonl`);

    await mkdir(tempDir, { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          cwd: projectPath,
          timestamp: "2026-07-04T00:00:00.000Z",
          model: "codex-test-model",
        },
      })}\n`,
    );

    const supervisor = {
      getProcessForSession: vi.fn(() => undefined),
    } as unknown as Supervisor;
    const scanner = {
      getProjectBySessionDirSuffix: vi.fn(),
    } as unknown as ProjectScanner;
    const getSessionSummary = vi.fn(async () => null);
    const getSessionListSummary = vi.fn(async () => ({
      id: sessionId,
      projectId,
      title: "External Codex title",
      fullTitle: "External Codex title",
      updatedAt: "2026-07-04T00:00:01.000Z",
      provider: "codex" as const,
    }));

    const tracker = new ExternalSessionTracker({
      eventBus,
      supervisor,
      scanner,
      decayMs: 1000,
      getSessionSummary,
      getSessionListSummary,
    });

    try {
      eventBus.emit({
        type: "file-change",
        provider: "codex",
        path: sessionFile,
        relativePath: `2026/07/04/rollout-${sessionId}.jsonl`,
        changeType: "modify",
        fileType: "session",
        timestamp: new Date().toISOString(),
      });

      await vi.waitFor(() => {
        expect(getSessionListSummary).toHaveBeenCalledWith(
          sessionId,
          projectId,
        );
      });

      const creation = events.find(
        (event) =>
          event.type === "session-created" && event.session.id === sessionId,
      );
      expect(creation).toMatchObject({
        type: "session-created",
        session: {
          id: sessionId,
          projectId,
          messageCount: 0,
          model: "codex-test-model",
          ownership: { owner: "external" },
        },
      });

      const update = events.find(
        (event) =>
          event.type === "session-updated" && event.sessionId === sessionId,
      );
      expect(update).toMatchObject({
        type: "session-updated",
        sessionId,
        projectId,
        title: "External Codex title",
        updatedAt: "2026-07-04T00:00:01.000Z",
      });
      expect(update).not.toHaveProperty("messageCount");
      expect(update).not.toHaveProperty("contextUsage");
      expect(update).not.toHaveProperty("model");
      expect(update).not.toHaveProperty("lastAgentText");
      expect(getSessionSummary).not.toHaveBeenCalled();
    } finally {
      tracker.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("marks Pi sessions external from the JSONL header", async () => {
    const eventBus = new EventBus();
    const events: BusEvent[] = [];
    eventBus.subscribe((event) => events.push(event));

    const projectPath = "/tmp/pi-project";
    const projectId = encodeProjectId(projectPath);
    const sessionId = "pi-external-session";
    const tempDir = join(tmpdir(), `pi-external-${randomUUID()}`);
    const sessionFile = join(tempDir, "2026-06-23_pi-external-session.jsonl");

    await mkdir(tempDir, { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        cwd: projectPath,
        timestamp: "2026-06-23T00:00:00.000Z",
      })}\n`,
    );

    const supervisor = {
      getProcessForSession: vi.fn(() => undefined),
    } as unknown as Supervisor;
    const scanner = {
      getProjectBySessionDirSuffix: vi.fn(),
    } as unknown as ProjectScanner;

    const tracker = new ExternalSessionTracker({
      eventBus,
      supervisor,
      scanner,
      decayMs: 100,
    });

    try {
      eventBus.emit({
        type: "file-change",
        provider: "pi",
        path: sessionFile,
        relativePath: "encoded/2026-06-23_pi-external-session.jsonl",
        changeType: "modify",
        fileType: "session",
        timestamp: new Date().toISOString(),
      });

      await vi.waitFor(() => {
        expect(tracker.isExternal(sessionId)).toBe(true);
      });

      expect(scanner.getProjectBySessionDirSuffix).not.toHaveBeenCalled();
      expect(
        events.some(
          (event) =>
            event.type === "session-status-changed" &&
            event.sessionId === sessionId &&
            event.projectId === projectId &&
            event.ownership.owner === "external",
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "session-created" &&
            event.session.id === sessionId &&
            event.session.provider === "pi" &&
            event.session.ownership.owner === "external",
        ),
      ).toBe(true);
    } finally {
      tracker.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
