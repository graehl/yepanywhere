import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { primeLocalRoute } from "../localRouteBootstrap";
import {
  ensureClientQuery,
  resetClientQueryControllerForTests,
} from "../clientQueryController";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "../clientSourceIdentity";
import { createProjectsQuery } from "../projectsQuery";
import {
  createRecentsQuery,
  readRecentsSnapshot,
  resetRecentSessionsForTests,
} from "../recentsQuery";
import { resetServerSettingsForTests } from "../serverSettingsQuery";
import { resetVersionQueryForTests } from "../versionQuery";
import { createNewSessionBootstrap } from "../newSessionBootstrap";

beforeEach(() => {
  resetClientQueryControllerForTests();
  resetRecentSessionsForTests();
  resetServerSettingsForTests();
  resetVersionQueryForTests();
});
afterEach(() => vi.unstubAllGlobals());

it("starts project and visit reads before settings/version settle and shares them with consumers", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
    },
  });
  const send = (part: string, body: unknown, status = 200) =>
    stream.enqueue(
      new TextEncoder().encode(
        `event: bootstrap\ndata: ${JSON.stringify({ part, status, body })}\n\n`,
      ),
    );
  const fetch = vi.fn(
    async () =>
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
  );
  vi.stubGlobal("fetch", fetch);
  const bootstrap = primeLocalRoute("new-session", null);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const duplicateProjectFetch = vi.fn();
  const duplicateRecentFetch = vi.fn();
  const projects = ensureClientQuery(
    createProjectsQuery(LOCAL_CLIENT_SUMMARY_SOURCE_KEY, duplicateProjectFetch),
  );
  const recents = ensureClientQuery(
    createRecentsQuery(LOCAL_CLIENT_SUMMARY_SOURCE_KEY, {
      getRecents: duplicateRecentFetch,
    }),
  );
  const visit = {
    sessionId: "recent-session",
    projectId: "recent-project",
    visitedAt: "2026-10-09T00:00:00Z",
  };
  send("projects", { projects: [] });
  send("recents", { recents: [], visits: [visit] });
  await Promise.all([projects, recents]);
  expect(readRecentsSnapshot(LOCAL_CLIENT_SUMMARY_SOURCE_KEY).visits).toEqual([
    visit,
  ]);
  expect(duplicateProjectFetch).not.toHaveBeenCalled();
  expect(duplicateRecentFetch).not.toHaveBeenCalled();
  // A failed independent settings request cannot erase accepted collections.
  send("settings", { error: "unavailable" }, 503);
  send("provider", { error: "unavailable" }, 503);
  send("version", { current: "0.9.4", latest: null, updateAvailable: false });
  stream.close();
  const outcomes = await bootstrap;
  expect(
    outcomes.filter((outcome) => outcome.status === "rejected"),
  ).toHaveLength(1);
  expect(readRecentsSnapshot(LOCAL_CLIENT_SUMMARY_SOURCE_KEY).visits).toEqual([
    visit,
  ]);
});

it("does not acquire New Session collections for Settings", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url === "/api/settings") return Response.json({ settings: {} });
    if (url === "/api/version")
      return Response.json({
        current: "0.9.4",
        latest: null,
        updateAvailable: false,
      });
    throw new Error(`Unexpected Settings bootstrap request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const outcomes = await primeLocalRoute("settings", null);
  expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(
    true,
  );
  expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
    "/api/settings",
    "/api/version",
  ]);
});

it("uses ordinary settings JSON from older servers and only existing fallback endpoints", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url === "/api/settings?bootstrap=new-session-v1")
      return Response.json({
        settings: { newSessionDefaults: { provider: "codex" } },
      });
    if (url === "/api/projects?summaryMode=retained")
      return Response.json({ projects: [] });
    if (url === "/api/recents?limit=100&summaryMode=retained")
      return Response.json({ recents: [] });
    if (url === "/api/providers/codex")
      return Response.json({
        provider: {
          name: "codex",
          displayName: "Codex",
          installed: false,
          authenticated: false,
        },
      });
    if (url === "/api/version")
      return Response.json({
        current: "0.9.2",
        latest: null,
        updateAvailable: false,
      });
    throw new Error(`Unexpected legacy bootstrap request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  expect(
    (await primeLocalRoute("new-session", null)).every(
      (result) => result.status === "fulfilled",
    ),
  ).toBe(true);
  expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
    [
      "/api/settings?bootstrap=new-session-v1",
      "/api/projects?summaryMode=retained",
      "/api/recents?limit=100&summaryMode=retained",
      "/api/providers/codex",
      "/api/version",
    ].sort(),
  );
});

it("accepts split UTF-8 frames and rejects missing parts without discarding received data", async () => {
  const bytes = new TextEncoder().encode(
    `event: bootstrap\ndata: ${JSON.stringify({ part: "projects", status: 200, body: { projects: ["日本語"] } })}\n\n`,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const byte of bytes)
                controller.enqueue(new Uint8Array([byte]));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
  const bundle = createNewSessionBootstrap(undefined);
  const fallback = vi.fn();
  const results = await Promise.allSettled([
    bundle.read("projects", fallback),
    bundle.read("version", fallback),
  ]);
  expect(results[0]).toEqual({
    status: "fulfilled",
    value: { projects: ["日本語"] },
  });
  expect(results[1]).toMatchObject({
    status: "rejected",
    reason: expect.objectContaining({
      message: "New Session bootstrap ended before every part arrived",
    }),
  });
  expect(fallback).not.toHaveBeenCalled();
});
