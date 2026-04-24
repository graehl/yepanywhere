import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type SessionsDeps,
  createSessionsRoutes,
} from "../../src/routes/sessions.js";
import type { CodexSessionReader } from "../../src/sessions/codex-reader.js";
import type { ISessionReader } from "../../src/sessions/types.js";
import type { Project, SessionSummary } from "../../src/supervisor/types.js";

function createProject(): Project {
  return {
    id: "proj-1" as UrlProjectId,
    path: "/tmp/project",
    name: "project",
    sessionCount: 1,
    sessionDir: "/tmp/project/.claude-sessions",
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
    provider: "claude",
  };
}

function createSummary(): SessionSummary {
  return {
    id: "sess-1",
    projectId: "proj-1" as UrlProjectId,
    title: "Codex metadata title",
    fullTitle: "Codex metadata title",
    createdAt: new Date("2026-03-10T09:45:00.000Z").toISOString(),
    updatedAt: new Date("2026-03-10T09:46:00.000Z").toISOString(),
    messageCount: 2,
    ownership: { owner: "none" },
    provider: "codex",
    model: "gpt-5-codex",
  };
}

describe("Sessions metadata route", () => {
  it("resolves metadata across providers for mixed-provider projects", async () => {
    const project = createProject();
    const summary = createSummary();
    const claudeReader = {
      getSessionSummary: vi.fn(async () => null),
    } as unknown as ISessionReader;
    const codexReader = {
      getSessionSummary: vi.fn(async () => summary),
    } as unknown as ISessionReader;

    const routes = createSessionsRoutes({
      supervisor: {
        getProcessForSession: vi.fn(() => null),
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getProject: vi.fn(async () => project),
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(() => claudeReader),
      codexSessionsDir: "/tmp/codex-sessions",
      codexReaderFactory: vi.fn(
        () => codexReader as unknown as CodexSessionReader,
      ),
    });

    const response = await routes.request(
      `/projects/${project.id}/sessions/sess-1/metadata`,
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.session).toMatchObject({
      id: "sess-1",
      title: "Codex metadata title",
      provider: "codex",
      model: "gpt-5-codex",
    });
    expect(vi.mocked(claudeReader.getSessionSummary)).toHaveBeenCalledWith(
      "sess-1",
      project.id,
    );
    expect(vi.mocked(codexReader.getSessionSummary)).toHaveBeenCalledWith(
      "sess-1",
      project.id,
    );
  });

  it("keeps persisted provider when metadata refresh misses the session summary", async () => {
    const project = createProject();

    const routes = createSessionsRoutes({
      supervisor: {
        getProcessForSession: vi.fn(() => ({
          id: "proc-1",
          permissionMode: "default",
          modeVersion: 0,
          state: { type: "idle", since: new Date("2026-03-10T09:47:00.000Z") },
          provider: "claude",
          supportsDynamicCommands: false,
        })),
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getProject: vi.fn(async () => project),
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      sessionMetadataService: {
        getMetadata: vi.fn(() => undefined),
        getProvider: vi.fn(() => "codex"),
      } as unknown as NonNullable<SessionsDeps["sessionMetadataService"]>,
    });

    const response = await routes.request(
      `/projects/${project.id}/sessions/sess-1/metadata`,
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.session.provider).toBe("codex");
  });

  it("prefers persisted provider over conflicting client resume provider", async () => {
    const project = createProject();
    const resumeSession = vi.fn(async () => ({
      id: "proc-1",
      sessionId: "sess-1",
      permissionMode: "default",
      modeVersion: 0,
    }));

    const routes = createSessionsRoutes({
      supervisor: {
        resumeSession,
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      sessionMetadataService: {
        getProvider: vi.fn(() => "codex"),
        getExecutor: vi.fn(() => undefined),
      } as unknown as NonNullable<SessionsDeps["sessionMetadataService"]>,
    });

    const response = await routes.request(
      `/projects/${project.id}/sessions/sess-1/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "continue",
          provider: "claude",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(resumeSession).toHaveBeenCalledWith(
      "sess-1",
      project.path,
      expect.objectContaining({ text: "continue" }),
      undefined,
      expect.objectContaining({ providerName: "codex" }),
    );
  });

  it("preserves persisted provider and model when queueing a restartable message", async () => {
    const project = createProject();
    const queueMessageToSession = vi.fn(async () => ({
      success: true as const,
      restarted: true,
      process: { id: "proc-2" },
    }));

    const routes = createSessionsRoutes({
      supervisor: {
        getProcessForSession: vi.fn(() => ({
          projectPath: project.path,
          isTerminated: false,
          provider: "claude",
          model: "gpt-5.4",
          resolvedModel: "gpt-5.4",
          executor: undefined,
        })),
        queueMessageToSession,
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      sessionMetadataService: {
        getProvider: vi.fn(() => "codex"),
        getExecutor: vi.fn(() => undefined),
      } as unknown as NonNullable<SessionsDeps["sessionMetadataService"]>,
    });

    const response = await routes.request("/sessions/sess-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "continue",
        thinking: "max",
      }),
    });

    expect(response.status).toBe(200);
    expect(queueMessageToSession).toHaveBeenCalledWith(
      "sess-1",
      project.path,
      expect.objectContaining({ text: "continue" }),
      undefined,
      expect.objectContaining({
        model: "gpt-5.4",
        providerName: "codex",
      }),
    );
  });

  it("starts a fresh handoff session before aborting the old process", async () => {
    const project = createProject();
    let replacementListener: ((event: { type: string; message?: unknown }) => void) | undefined;
    const startSession = vi.fn(async () => ({
      id: "proc-new",
      sessionId: "sess-new",
      projectId: project.id,
      provider: "codex",
      model: "gpt-5.4",
      resolvedModel: "gpt-5.4",
      permissionMode: "default",
      modeVersion: 0,
      subscribe: vi.fn((listener) => {
        replacementListener = listener;
        return vi.fn();
      }),
    }));
    const abortProcess = vi.fn(async () => true);
    const interruptProcess = vi.fn(async () => ({
      success: true,
      supported: true,
    }));

    const routes = createSessionsRoutes({
      supervisor: {
        getProcessForSession: vi.fn(() => ({
          id: "proc-old",
          provider: "codex",
          model: "gpt-5.5",
          resolvedModel: "gpt-5.5",
          permissionMode: "default",
          modeVersion: 0,
          state: { type: "idle", since: new Date() },
          getMessageHistory: vi.fn(() => [
            {
              type: "user",
              uuid: "u1",
              timestamp: "2026-04-24T20:00:00.000Z",
              message: { role: "user", content: "please continue the bugfix" },
            },
          ]),
        })),
        startSession,
        interruptProcess,
        abortProcess,
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      sessionMetadataService: {
        getProvider: vi.fn(() => "codex"),
        getExecutor: vi.fn(() => undefined),
        getMetadata: vi.fn(() => ({ customTitle: "Broken Codex session" })),
        setProvider: vi.fn(async () => undefined),
        updateMetadata: vi.fn(async () => undefined),
      } as unknown as NonNullable<SessionsDeps["sessionMetadataService"]>,
    });

    const response = await routes.request(
      `/projects/${project.id}/sessions/sess-1/restart`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "codex",
          model: "gpt-5.4",
          reason: "test restart",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      sessionId: "sess-new",
      processId: "proc-new",
      restartedFrom: "sess-1",
      oldProcessId: "proc-old",
      oldProcessInterrupted: true,
      oldProcessAbortDeferred: true,
      oldProcessAborted: false,
    });
    expect(interruptProcess).toHaveBeenCalledWith("proc-old");
    expect(startSession).toHaveBeenCalledWith(
      project.path,
      expect.objectContaining({
        text: expect.stringContaining("please continue the bugfix"),
      }),
      undefined,
      expect.objectContaining({
        model: "gpt-5.4",
        providerName: "codex",
      }),
    );
    expect(interruptProcess.mock.invocationCallOrder[0]).toBeLessThan(
      startSession.mock.invocationCallOrder[0] ?? 0,
    );
    expect(abortProcess).not.toHaveBeenCalled();

    replacementListener?.({
      type: "message",
      message: { type: "assistant", message: { content: "working" } },
    });
    await Promise.resolve();
    expect(abortProcess).toHaveBeenCalledWith("proc-old");
  });

  it("does not abort the old process when handoff startup is queued", async () => {
    const project = createProject();
    const abortProcess = vi.fn(async () => true);
    const interruptProcess = vi.fn(async () => ({
      success: true,
      supported: true,
    }));
    const cancelQueuedRequest = vi.fn(() => true);

    const routes = createSessionsRoutes({
      supervisor: {
        getProcessForSession: vi.fn(() => ({
          id: "proc-old",
          provider: "codex",
          model: "gpt-5.5",
          resolvedModel: "gpt-5.5",
          permissionMode: "default",
          modeVersion: 0,
          state: { type: "idle", since: new Date() },
          getMessageHistory: vi.fn(() => []),
        })),
        interruptProcess,
        startSession: vi.fn(async () => ({
          queued: true,
          queueId: "queue-1",
          position: 1,
        })),
        cancelQueuedRequest,
        abortProcess,
      } as unknown as SessionsDeps["supervisor"],
      scanner: {
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      sessionMetadataService: {
        getProvider: vi.fn(() => "codex"),
        getExecutor: vi.fn(() => undefined),
      } as unknown as NonNullable<SessionsDeps["sessionMetadataService"]>,
    });

    const response = await routes.request(
      `/projects/${project.id}/sessions/sess-1/restart`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", model: "gpt-5.4" }),
      },
    );

    expect(response.status).toBe(503);
    expect(interruptProcess).toHaveBeenCalledWith("proc-old");
    expect(cancelQueuedRequest).toHaveBeenCalledWith("queue-1");
    expect(abortProcess).not.toHaveBeenCalled();
  });
});
