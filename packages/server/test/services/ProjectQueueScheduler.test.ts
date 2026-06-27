import { toUrlProjectId, type UrlProjectId } from "@yep-anywhere/shared";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogger } from "../../src/logging/logger.js";
import type { UserMessage } from "../../src/sdk/types.js";
import {
  ProjectQueueScheduler,
  type ProjectQueueDispatchResult,
  type ProjectQueueExternalTracker,
  type ProjectQueueProcessSnapshot,
  type ProjectQueueSupervisor,
} from "../../src/services/ProjectQueueScheduler.js";
import { ProjectQueueService } from "../../src/services/ProjectQueueService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const PROJECT_PATH = "/tmp/project-queue-scheduler";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  assertion: () => void,
  timeoutMs = 250,
): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await wait(5);
    }
  }
  if (lastError) throw lastError;
}

function createProcess(
  projectId: UrlProjectId,
  overrides: Partial<ProjectQueueProcessSnapshot> = {},
): ProjectQueueProcessSnapshot {
  const process: ProjectQueueProcessSnapshot = {
    id: "process-1",
    sessionId: "session-1",
    projectId,
    projectPath: PROJECT_PATH,
    state: { type: "idle" },
    queueDepth: 0,
    provider: "claude",
    promptSuggestionMode: "native",
    recapAfterSeconds: 300,
    isRetainingProviderWork: () => false,
    getPendingInputRequest: () => null,
    getDeferredQueueSummary: () => [],
    getLivenessSnapshot: () => ({
      derivedStatus:
        process.state.type === "idle" ? "verified-idle" : "recently-active",
    }),
    ...overrides,
  };
  return process;
}

class FakeSupervisor implements ProjectQueueSupervisor {
  processes: ProjectQueueProcessSnapshot[] = [];
  queueInfo: { projectId: UrlProjectId }[] = [];
  resumeCalls: {
    sessionId: string;
    projectPath: string;
    message: UserMessage;
  }[] = [];
  startCalls: { projectPath: string; message: UserMessage }[] = [];
  resumeError: Error | null = null;
  startError: Error | null = null;

  constructor(private projectId: UrlProjectId) {}

  getAllProcesses(): ProjectQueueProcessSnapshot[] {
    return this.processes;
  }

  getQueueInfo(): { projectId: UrlProjectId }[] {
    return this.queueInfo;
  }

  async startSession(
    projectPath: string,
    message: UserMessage,
  ): Promise<ProjectQueueDispatchResult> {
    this.startCalls.push({ projectPath, message });
    if (this.startError) throw this.startError;
    const process = createProcess(this.projectId, {
      id: `started-${this.startCalls.length}`,
      sessionId: `new-session-${this.startCalls.length}`,
    });
    this.processes.push(process);
    return process;
  }

  async resumeSession(
    sessionId: string,
    projectPath: string,
    message: UserMessage,
  ): Promise<ProjectQueueDispatchResult> {
    this.resumeCalls.push({ sessionId, projectPath, message });
    if (this.resumeError) throw this.resumeError;
    const process = createProcess(this.projectId, { sessionId });
    this.processes.push(process);
    return process;
  }
}

class FakeExternalTracker implements ProjectQueueExternalTracker {
  sessions = new Map<string, UrlProjectId>();

  getExternalSessions(): string[] {
    return [...this.sessions.keys()];
  }

  async getExternalSessionInfoWithUrlId(
    sessionId: string,
  ): Promise<{ projectId: UrlProjectId; lastActivity: Date } | null> {
    const projectId = this.sessions.get(sessionId);
    return projectId ? { projectId, lastActivity: new Date() } : null;
  }
}

describe("ProjectQueueScheduler", () => {
  let testDir: string;
  let projectId: UrlProjectId;
  let eventBus: EventBus;
  let service: ProjectQueueService;
  let supervisor: FakeSupervisor;
  let scheduler: ProjectQueueScheduler;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "project-queue-scheduler-"),
    );
    projectId = toUrlProjectId(PROJECT_PATH);
    eventBus = new EventBus();
    service = new ProjectQueueService({ dataDir: testDir, eventBus });
    await service.initialize();
    supervisor = new FakeSupervisor(projectId);
    scheduler = new ProjectQueueScheduler({
      projectQueueService: service,
      supervisor,
      eventBus,
      idleGraceMs: 1,
    });
  });

  afterEach(async () => {
    scheduler.dispose();
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("promotes an existing-session item when the project is idle", async () => {
    await service.createItem({
      projectId,
      projectPath: PROJECT_PATH,
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "run after idle  " },
      },
    });

    await waitFor(() => expect(supervisor.resumeCalls).toHaveLength(1));

    expect(supervisor.resumeCalls[0]).toMatchObject({
      sessionId: "session-1",
      projectPath: PROJECT_PATH,
      message: { text: "run after idle  " },
    });
    expect(service.listProject(projectId).items).toEqual([]);
  });

  it("waits for an active owned process to become verified idle", async () => {
    const process = createProcess(projectId, { state: { type: "in-turn" } });
    supervisor.processes = [process];

    await service.createItem({
      projectId,
      projectPath: PROJECT_PATH,
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "blocked while active" },
      },
    });

    await wait(25);
    expect(supervisor.resumeCalls).toHaveLength(0);

    process.state = { type: "idle" };
    eventBus.emit({
      type: "process-state-changed",
      sessionId: process.sessionId,
      projectId,
      activity: "idle",
      timestamp: new Date().toISOString(),
    });

    await waitFor(() => expect(supervisor.resumeCalls).toHaveLength(1));
  });

  it("waits for external ownership to clear", async () => {
    scheduler.dispose();
    const externalTracker = new FakeExternalTracker();
    externalTracker.sessions.set("external-session", projectId);
    scheduler = new ProjectQueueScheduler({
      projectQueueService: service,
      supervisor,
      eventBus,
      externalTracker,
      idleGraceMs: 1,
    });

    await service.createItem({
      projectId,
      projectPath: PROJECT_PATH,
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "blocked by external" },
      },
    });

    await wait(25);
    expect(supervisor.resumeCalls).toHaveLength(0);

    externalTracker.sessions.clear();
    eventBus.emit({
      type: "session-status-changed",
      sessionId: "external-session",
      projectId,
      ownership: { owner: "none" },
      timestamp: new Date().toISOString(),
    });

    await waitFor(() => expect(supervisor.resumeCalls).toHaveLength(1));
  });

  it("persists a failed dispatch and stops behind it", async () => {
    vi.spyOn(getLogger(), "warn").mockImplementation(() => undefined);
    supervisor.resumeError = new Error("provider unavailable");

    await service.createItem({
      projectId,
      projectPath: PROJECT_PATH,
      request: {
        target: { type: "existing-session", sessionId: "session-1" },
        message: { text: "first" },
      },
    });
    await service.createItem({
      projectId,
      projectPath: PROJECT_PATH,
      request: {
        target: { type: "existing-session", sessionId: "session-2" },
        message: { text: "second" },
      },
    });

    await waitFor(() => {
      expect(service.listProject(projectId).items[0]).toMatchObject({
        status: "failed",
        lastError: "provider unavailable",
      });
    });
    await wait(25);

    expect(supervisor.resumeCalls).toHaveLength(1);
    expect(service.listProject(projectId).items).toMatchObject([
      { status: "failed", messagePreview: "first" },
      { status: "queued", messagePreview: "second" },
    ]);
  });
});
