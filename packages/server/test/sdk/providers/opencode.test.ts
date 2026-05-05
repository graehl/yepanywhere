/**
 * Unit tests for OpenCodeProvider.startSession() blocking session-ID resolution.
 *
 * The core invariant: startSession() must resolve with an iterator whose FIRST
 * yield is already the init message carrying the real ses_* session ID.  That
 * allows Process.waitForSessionId() to resolve immediately without racing the
 * 5-second timeout and returning a stale UUID to the client.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- helpers ---

function makeFakeProcess(): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  emitter.pid = 12345;
  emitter.killed = false;
  emitter.kill = vi.fn(() => true) as unknown as ChildProcess["kill"];
  const fakeStream = new EventEmitter() as unknown as import("stream").Readable;
  emitter.stdout = fakeStream;
  emitter.stderr = fakeStream;
  return emitter;
}

// Minimal Response-like object for mocking global fetch
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

describe("OpenCodeProvider.startSession — blocking session ID", () => {
  let spawnMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let fakeProcess: ChildProcess;

  beforeEach(async () => {
    fakeProcess = makeFakeProcess();
    spawnMock = vi.fn(() => fakeProcess);
    fetchMock = vi.fn();

    // Patch module-level imports
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: spawnMock, exec: actual.exec, execFile: actual.execFile };
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, existsSync: (p: string) => p.includes("opencode") || actual.existsSync(p) };
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("startSession resolves before the iterator is consumed and first yield is init with ses_ ID", async () => {
    const expectedSessionId = "ses_abc123testid";

    // GET /session (waitForServer poll) → OK
    // POST /session (session creation) → { id: "ses_abc123testid" }
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: expectedSessionId }));
      }
      // GET — server health check
      return Promise.resolve(jsonResponse({ sessions: [] }));
    });

    const { OpenCodeProvider } = await import(
      "../../../src/sdk/providers/opencode.js"
    );
    const provider = new OpenCodeProvider({ opencodePath: "/fake/opencode" });

    // startSession must resolve (blocking work done) before we pull from iterator
    const session = await provider.startSession({
      cwd: "/tmp/test",
    });

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledWith(
      "/fake/opencode",
      expect.arrayContaining(["serve"]),
      expect.any(Object),
    );

    // The very first value from the iterator must be the init message
    const first = await session.iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: expectedSessionId,
    });

    // Abort to clean up (kills the fake server process)
    session.abort();
  });

  it("returns error iterator immediately when opencode binary is not found", async () => {
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      // existsSync returns false for everything → binary not found
      return { ...actual, existsSync: () => false };
    });

    // Also make exec (which command) fail
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawn: spawnMock,
        exec: (_cmd: string, _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error("not found"));
          return {} as ChildProcess;
        },
        execFile: actual.execFile,
      };
    });

    const { OpenCodeProvider } = await import(
      "../../../src/sdk/providers/opencode.js"
    );
    const provider = new OpenCodeProvider();

    const session = await provider.startSession({ cwd: "/tmp/test" });

    const first = await session.iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "error" });
    expect((first.value as { error: string }).error).toMatch(/not found/i);

    // spawn should not have been called
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns error iterator when server fails to start within timeout", async () => {
    // Simulate server never becoming ready
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const { OpenCodeProvider } = await import(
      "../../../src/sdk/providers/opencode.js"
    );
    // Short timeout so the test doesn't actually wait 10 seconds
    const provider = new OpenCodeProvider({
      opencodePath: "/fake/opencode",
      timeout: 100,
    });

    // Override waitForServer by giving a minimal timeout via a subclass
    // We need to test this faster — use a derived class with tiny timeout
    const fastProvider = Object.create(provider) as typeof provider;
    // Access private method via prototype to inject a short timeout
    const origWaitForServer = (provider as unknown as { waitForServer: (url: string, timeout: number) => Promise<boolean> }).waitForServer.bind(provider);
    (fastProvider as unknown as { waitForServer: (url: string, timeout: number) => Promise<boolean> }).waitForServer = (_url: string) =>
      origWaitForServer(_url, 200); // 200ms max

    const session = await fastProvider.startSession({ cwd: "/tmp/test" });

    const first = await session.iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "error" });
    expect((first.value as { error: string }).error).toMatch(/failed to start/i);
  });

  it("uses ses_ resumeSessionId directly without creating a new session", async () => {
    const resumeId = "ses_existing_session";

    // GET /session for health check
    fetchMock.mockResolvedValue(jsonResponse({ sessions: [] }));

    const { OpenCodeProvider } = await import(
      "../../../src/sdk/providers/opencode.js"
    );
    const provider = new OpenCodeProvider({ opencodePath: "/fake/opencode" });

    const session = await provider.startSession({
      cwd: "/tmp/test",
      resumeSessionId: resumeId,
    });

    // POST /session should NOT have been called (we resumed)
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]: [string, RequestInit?]) => init?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);

    const first = await session.iterator.next();
    expect(first.value).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: resumeId,
    });

    session.abort();
  });
});
