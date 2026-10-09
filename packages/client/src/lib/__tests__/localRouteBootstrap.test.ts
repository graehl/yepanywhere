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

beforeEach(() => {
  resetClientQueryControllerForTests();
  resetRecentSessionsForTests();
  resetServerSettingsForTests();
  resetVersionQueryForTests();
});
afterEach(() => vi.unstubAllGlobals());

it("starts project and visit reads before settings/version settle and shares them with consumers", async () => {
  const requests = new Map<string, (response: Response) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          requests.set(url, resolve);
        }),
    ),
  );
  const bootstrap = primeLocalRoute("new-session", null);
  await vi.waitFor(() =>
    expect([...requests.keys()].sort()).toEqual([
      "/api/projects?summaryMode=retained",
      "/api/recents?limit=100&summaryMode=retained",
      "/api/settings",
      "/api/version",
    ]),
  );
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
  requests.get("/api/projects?summaryMode=retained")?.(
    Response.json({ projects: [] }),
  );
  requests.get("/api/recents?limit=100&summaryMode=retained")?.(
    Response.json({ recents: [], visits: [visit] }),
  );
  await Promise.all([projects, recents]);
  expect(readRecentsSnapshot(LOCAL_CLIENT_SUMMARY_SOURCE_KEY).visits).toEqual([
    visit,
  ]);
  expect(duplicateProjectFetch).not.toHaveBeenCalled();
  expect(duplicateRecentFetch).not.toHaveBeenCalled();
  // A failed independent settings request cannot erase accepted collections.
  requests.get("/api/settings")?.(
    Response.json({ error: "unavailable" }, { status: 503 }),
  );
  requests.get("/api/version")?.(
    Response.json({ current: "0.9.4", latest: null, updateAvailable: false }),
  );
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
