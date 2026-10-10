import { beforeEach, expect, it, vi } from "vitest";
import { primeRemoteRoute } from "../remoteRouteBootstrap";
import { asClientSummarySourceKey } from "../clientSourceIdentity";
import { resetClientQueryControllerForTests } from "../clientQueryController";
import { resetServerSettingsForTests } from "../serverSettingsQuery";
import {
  readRecentsSnapshot,
  resetRecentSessionsForTests,
} from "../recentsQuery";
import { resetVersionQueryForTests } from "../versionQuery";

beforeEach(() => {
  resetClientQueryControllerForTests();
  resetServerSettingsForTests();
  resetRecentSessionsForTests();
  resetVersionQueryForTests();
});

it.each([
  ["/new-session", "/"],
  ["/-/relay/host/new-session", "/"],
  ["/remote/-/relay/host/new-session", "/remote/"],
])(
  "acquires %s from its attached source before any UI consumer",
  async (pathname, base) => {
    const sourceKey = asClientSummarySourceKey(`host:${pathname}`);
    const visit = {
      projectId: "recent-project",
      sessionId: "recent-session",
      visitedAt: "2026-10-10T00:00:00Z",
    };
    const frames = [
      { part: "projects", body: { projects: [] } },
      { part: "recents", body: { recents: [], visits: [visit] } },
      { part: "settings", body: { settings: {} } },
      {
        part: "version",
        body: { current: "0.9.4", latest: null, updateAvailable: false },
      },
      {
        part: "provider",
        body: {
          provider: {
            name: "codex",
            displayName: "Codex",
            installed: false,
            authenticated: false,
          },
        },
      },
    ];
    const transport = {
      fetch: vi.fn(),
      fetchStream: vi.fn(
        async () =>
          new Response(
            frames
              .map(
                (frame) =>
                  `event: bootstrap\ndata: ${JSON.stringify({ ...frame, status: 200 })}\n\n`,
              )
              .join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    };
    const result = await primeRemoteRoute(
      sourceKey,
      transport,
      { pathname, search: "?provider=codex" },
      base,
    );
    expect(result?.every((part) => part.status === "fulfilled")).toBe(true);
    expect(transport.fetchStream).toHaveBeenCalledExactlyOnceWith(
      "/settings?bootstrap=new-session-v1&provider=codex",
      { headers: { Accept: "text/event-stream" } },
    );
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(readRecentsSnapshot(sourceKey).visits).toEqual([visit]);
  },
);

it("leaves unrelated routes without bootstrap work", () => {
  const transport = { fetch: vi.fn(), fetchStream: vi.fn() };
  expect(
    primeRemoteRoute(
      asClientSummarySourceKey("host:other"),
      transport,
      { pathname: "/-/relay/host/sessions", search: "" },
      "/",
    ),
  ).toBeUndefined();
  expect(transport.fetchStream).not.toHaveBeenCalled();
  expect(transport.fetch).not.toHaveBeenCalled();
});
