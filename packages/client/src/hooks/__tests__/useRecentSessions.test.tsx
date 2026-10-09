import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SERVER_CAPABILITIES } from "@yep-anywhere/shared";
import { resetClientQueryControllerForTests } from "../../lib/clientQueryController";
import { resetClientQueryBootstrapForTests } from "../../lib/clientQueryBootstrap";
import {
  resetRecentSessionsForTests,
  useRecentSessions,
} from "../useRecentSessions";

const mocks = vi.hoisted(() => {
  const fetchA = vi.fn();
  const fetchB = vi.fn();
  return {
    runtime: { sourceKey: "host:a", transport: { fetch: fetchA } },
    fetchA,
    fetchB,
    version: vi.fn(),
    handlers: new Map<string, Set<() => void>>(),
  };
});
vi.mock("../../api/client", () => ({ api: { recordVisit: vi.fn() } }));
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => mocks.runtime,
}));
vi.mock("../../contexts/RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => null,
}));
vi.mock("../../lib/connection", () => ({ isRemoteClient: () => false }));
vi.mock("../useVersion", () => ({ ensureVersionInfo: mocks.version }));
vi.mock("../../lib/activityBus", () => ({
  activityBus: {
    on: (event: string, listener: () => void) => {
      const key = event;
      const listeners = mocks.handlers.get(key) ?? new Set();
      mocks.handlers.set(key, listeners);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retainSourceStream: () => () => {},
  },
}));

const entry = {
  sessionId: "one",
  projectId: "project",
  projectName: "Project",
  provider: "claude",
  visitedAt: "2026-10-09T00:00:00Z",
  title: "Known title",
};
const catalog = {
  catalogEpoch: "epoch",
  catalogGeneration: 1,
  complete: true,
  refreshing: false,
};
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function update(event = "session-catalog-updated") {
  for (const listener of mocks.handlers.get(event) ?? []) listener();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetClientQueryControllerForTests();
  resetClientQueryBootstrapForTests();
  resetRecentSessionsForTests();
  mocks.handlers.clear();
  mocks.fetchA.mockReset();
  mocks.fetchB.mockReset();
  mocks.runtime = { sourceKey: "host:a", transport: { fetch: mocks.fetchA } };
  mocks.version.mockReset();
  mocks.version.mockResolvedValue({
    current: "0.9.2",
    capabilities: [SERVER_CAPABILITIES.retainedRecents.name],
  });
});
afterEach(() => {
  cleanup();
  resetClientQueryControllerForTests();
  resetClientQueryBootstrapForTests();
  resetRecentSessionsForTests();
  vi.useRealTimers();
});

it("joins consumers, then replaces first-generation loading on a catalog publication", async () => {
  mocks.fetchA.mockResolvedValue({
    recents: [],
    catalog: { ...catalog, complete: false, refreshing: true },
    visits: [entry],
  });
  const first = renderHook(() => useRecentSessions({ limit: 30 }));
  const second = renderHook(() => useRecentSessions());
  await settle();
  expect(mocks.fetchA).toHaveBeenCalledTimes(1);
  expect(mocks.fetchA).toHaveBeenCalledWith(
    "/recents?limit=100&summaryMode=retained",
  );
  expect(first.result.current.isLoading).toBe(true);
  expect(first.result.current.isLoadingVisits).toBe(false);
  expect(first.result.current.recentProjectIds).toEqual(["project"]);
  mocks.fetchA.mockResolvedValue({ recents: [entry], catalog });
  act(update);
  await settle(500);
  expect(first.result.current.recentSessions).toEqual([entry]);
  expect(second.result.current.recentSessions).toEqual([entry]);
  expect(first.result.current.isLoading).toBe(false);
  expect(mocks.fetchA).toHaveBeenCalledTimes(2);
});

it("omits the new parameter for older servers", async () => {
  mocks.version.mockResolvedValue({ current: "0.9.2", capabilities: [] });
  mocks.fetchA.mockResolvedValue({ recents: [entry] });
  const hook = renderHook(() => useRecentSessions());
  await settle();
  expect(mocks.fetchA).toHaveBeenCalledWith("/recents?limit=100");
  expect(hook.result.current.recentSessions).toEqual([entry]);
});

it("preserves known titles and membership across incomplete catalog reads", async () => {
  mocks.fetchA.mockResolvedValue({ recents: [entry], catalog });
  const hook = renderHook(() => useRecentSessions());
  await settle();
  const { title: _title, ...unknownTitle } = entry;
  mocks.fetchA.mockResolvedValue({ recents: [unknownTitle], catalog });
  act(update);
  await settle(500);
  expect(hook.result.current.recentSessions[0]?.title).toBe(entry.title);
  mocks.fetchA.mockResolvedValue({
    recents: [],
    catalog: { ...catalog, complete: false, refreshing: true },
    visits: [entry],
  });
  act(update);
  await settle(500);
  expect(hook.result.current.recentSessions).toEqual([entry]);
  // Clearing visits remains authoritative even while the catalog is cold.
  mocks.fetchA.mockResolvedValue({
    recents: [],
    visits: [],
    catalog: { ...catalog, complete: false, refreshing: true },
  });
  act(() => update("recents-changed"));
  await settle(500);
  expect(hook.result.current.recentSessions).toEqual([]);
  expect(hook.result.current.isLoading).toBe(false);
});

it("keeps requests and late results with their source while capability lookup is pending", async () => {
  let resolveVersion!: (version: unknown) => void;
  mocks.version.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveVersion = resolve;
      }),
  );
  mocks.fetchA.mockResolvedValue({ recents: [entry] });
  mocks.fetchB.mockResolvedValue({
    recents: [{ ...entry, sessionId: "other-host" }],
    catalog,
  });
  const hook = renderHook(() => useRecentSessions());
  await settle();
  mocks.runtime = { sourceKey: "host:b", transport: { fetch: mocks.fetchB } };
  hook.rerender();
  await settle();
  expect(hook.result.current.recentSessions[0]?.sessionId).toBe("other-host");
  act(() => resolveVersion({ current: "0.9.2" }));
  await settle();
  expect(mocks.fetchA).toHaveBeenCalledWith("/recents?limit=100");
  expect(mocks.fetchB).toHaveBeenCalledTimes(1);
  expect(hook.result.current.recentSessions[0]?.sessionId).toBe("other-host");
});
