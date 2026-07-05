// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJSON } from "../../api/client";
import { activityBus } from "../../lib/activityBus";
import {
  FRONTEND_RELOAD_QUERY_PARAM,
  buildFrontendReloadUrl,
  getFrontendReloadCleanupUrl,
  getVisibleReloadBanners,
  useReloadNotifications,
} from "../useReloadNotifications";

vi.mock("../../api/client", () => ({
  fetchJSON: vi.fn(),
}));

const mockFetchJSON = vi.mocked(fetchJSON);

const workerActivity = {
  type: "worker-activity-changed" as const,
  activeWorkers: 0,
  interruptibleSessionCount: 0,
  queueLength: 0,
  queuedSessionMessageCount: 0,
  hasActiveWork: false,
  timestamp: "2026-07-05T00:00:00.000Z",
};

const idleSafeRestartState = {
  status: "idle" as const,
  blockers: [],
  canRestartNow: true,
  updatedAt: "2026-07-05T00:00:00.000Z",
};

let backendDirty = false;

beforeEach(() => {
  backendDirty = false;
  mockFetchJSON.mockImplementation(async (url) => {
    if (url === "/dev/status") {
      return {
        noBackendReload: true,
        noFrontendReload: true,
        backendDirty,
      } as never;
    }
    if (url === "/status/workers") {
      return workerActivity as never;
    }
    if (url === "/dev/safe-restart") {
      return idleSafeRestartState as never;
    }
    return {} as never;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useReloadNotifications URL helpers", () => {
  it("adds a cache-busting reload param while preserving query and hash", () => {
    const nextUrl = buildFrontendReloadUrl(
      "https://example.test/projects?foo=bar#session-1",
      "12345",
    );
    const parsed = new URL(nextUrl);

    expect(parsed.searchParams.get("foo")).toBe("bar");
    expect(parsed.searchParams.get(FRONTEND_RELOAD_QUERY_PARAM)).toBe("12345");
    expect(parsed.hash).toBe("#session-1");
  });

  it("removes only the reload param during post-load cleanup", () => {
    const cleanedUrl = getFrontendReloadCleanupUrl(
      "https://example.test/projects?foo=bar&__ya_reload=12345#session-1",
    );

    expect(cleanedUrl).toBe("https://example.test/projects?foo=bar#session-1");
  });

  it("returns null when there is no reload param to clean up", () => {
    expect(
      getFrontendReloadCleanupUrl(
        "https://example.test/projects?foo=bar#session-1",
      ),
    ).toBeNull();
  });
});

describe("getVisibleReloadBanners", () => {
  it("gives backend reloads precedence over frontend reloads", () => {
    expect(
      getVisibleReloadBanners(true, { backend: true, frontend: true }),
    ).toEqual({ backend: true, frontend: false });

    expect(
      getVisibleReloadBanners(true, { backend: false, frontend: true }),
    ).toEqual({ backend: false, frontend: true });

    expect(
      getVisibleReloadBanners(false, { backend: true, frontend: true }),
    ).toEqual({ backend: false, frontend: false });
  });
});

describe("useReloadNotifications dismissal", () => {
  it("keeps dismissed backend reloads hidden until the page state is recreated", async () => {
    const first = renderHook(() => useReloadNotifications());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      activityBus.emitLocal("source-change", {
        type: "source-change",
        target: "backend",
        files: ["server.ts"],
        timestamp: "2026-07-05T00:00:00.000Z",
      });
    });

    expect(first.result.current.pendingReloads.backend).toBe(true);

    act(() => {
      first.result.current.dismiss("backend");
    });

    expect(first.result.current.pendingReloads.backend).toBe(false);

    await act(async () => {
      activityBus.emitLocal("source-change", {
        type: "source-change",
        target: "backend",
        files: ["server.ts"],
        timestamp: "2026-07-05T00:00:01.000Z",
      });
    });

    expect(first.result.current.pendingReloads.backend).toBe(false);

    backendDirty = true;
    await act(async () => {
      activityBus.emitLocal("refresh", undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(first.result.current.pendingReloads.backend).toBe(false);

    first.unmount();
    const second = renderHook(() => useReloadNotifications());

    await waitFor(() => {
      expect(second.result.current.pendingReloads.backend).toBe(true);
    });
  });
});
