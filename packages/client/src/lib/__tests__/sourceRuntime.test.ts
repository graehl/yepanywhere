import { toUrlProjectId } from "@yep-anywhere/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  asClientSummarySourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
} from "../clientSummaryStore";
import { createSessionDetailMemoryCache } from "../sessionDetail/sessionDetailStore";
import type { SessionRouteSnapshot } from "../sessionRouteSnapshots";
import {
  createSourceRuntimeRegistry,
  getOrCreateCurrentSourceRuntime,
  getSourceRuntimeRegistry,
  type SourceApiClient,
} from "../sourceRuntime";

const apiMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionMetadata: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: apiMocks,
}));

function fakeApiClient(): SourceApiClient {
  return {
    getSession: vi.fn(() => Promise.resolve({} as never)),
    getSessionMetadata: vi.fn(() => Promise.resolve({} as never)),
  };
}

function snapshot(sessionId: string, messageId: string): SessionRouteSnapshot {
  return {
    messages: [
      {
        uuid: messageId,
        type: "user",
        timestamp: "2026-07-05T00:00:00.000Z",
        message: { role: "user", content: messageId },
      },
    ],
    session: {
      id: sessionId,
      projectId: toUrlProjectId("/repo/project-a"),
      provider: "claude",
      title: sessionId,
      fullTitle: sessionId,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
      messageCount: 1,
      ownership: { owner: "none" },
    },
    agentContent: {},
    toolUseToAgentEntries: [],
    lastMessageId: messageId,
    maxPersistedTimestampMs: 0,
  };
}

describe("source runtime session detail API", () => {
  beforeEach(() => {
    apiMocks.getSession.mockReset();
    apiMocks.getSessionMetadata.mockReset();
  });

  it("forwards bounded session-detail requests", async () => {
    apiMocks.getSession.mockResolvedValueOnce({ ok: true });
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    await runtime.api.getSession({
      projectId: "proj-1",
      sessionId: "sess-1",
      tailCompactions: 2,
    });

    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "proj-1",
      "sess-1",
      undefined,
      { tailCompactions: 2 },
    );
  });

  it("keeps full-history reads explicit without changing the server request", async () => {
    apiMocks.getSession.mockResolvedValueOnce({ ok: true });
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    await runtime.api.getSession({
      projectId: "proj-1",
      sessionId: "sess-1",
      fullHistory: true,
      fullHistoryReason: "test explicit full-history escape hatch",
    });

    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "proj-1",
      "sess-1",
      undefined,
      {
        fullHistory: true,
        fullHistoryReason: "test explicit full-history escape hatch",
      },
    );
  });

  it("rejects unbounded session-detail requests without explicit full history", () => {
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    expect(() =>
      runtime.api.getSession({
        projectId: "proj-1",
        sessionId: "sess-1",
      } as never),
    ).toThrow("Session detail request requires bounds or explicit fullHistory.");
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it("rejects full-history requests without a reason", () => {
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    expect(() =>
      runtime.api.getSession({
        projectId: "proj-1",
        sessionId: "sess-1",
        fullHistory: true,
        fullHistoryReason: "",
      }),
    ).toThrow("Full-history session request requires a reason.");
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it("keeps the current-source helper on the default registry path", () => {
    const sourceKey = asClientSummarySourceKey("host:compat");

    expect(getOrCreateCurrentSourceRuntime(sourceKey)).toBe(
      getSourceRuntimeRegistry().getOrCreateSourceRuntime(sourceKey),
    );
  });
});

describe("SourceRuntimeRegistry", () => {
  it("returns stable runtimes per source key and separate runtimes across keys", () => {
    const registry = createSourceRuntimeRegistry({
      apiClient: fakeApiClient(),
      sessionDetails: { cache: createSessionDetailMemoryCache() },
    });
    const sourceA = asClientSummarySourceKey("host:a");
    const sourceB = asClientSummarySourceKey("host:b");

    const runtimeA = registry.getOrCreateSourceRuntime(sourceA);

    expect(registry.getOrCreateSourceRuntime(sourceA)).toBe(runtimeA);
    expect(registry.getOrCreateSourceRuntime(sourceB)).not.toBe(runtimeA);
    expect(registry.getOrCreateSourceRuntime(sourceB).sourceKey).toBe(sourceB);
  });

  it("routes current-source helpers through the registry source key", () => {
    const sourceA = asClientSummarySourceKey("host:a");
    const sourceB = asClientSummarySourceKey("host:b");
    let currentSourceKey = sourceA;
    const registry = createSourceRuntimeRegistry({
      apiClient: fakeApiClient(),
      sessionDetails: { cache: createSessionDetailMemoryCache() },
      getCurrentSourceKey: () => currentSourceKey,
      setCurrentSourceKey: (sourceKey) => {
        currentSourceKey = sourceKey;
      },
    });

    expect(registry.getCurrentSourceRuntime().sourceKey).toBe(sourceA);

    registry.setCurrentSourceKey(sourceB);

    expect(registry.getCurrentSourceRuntime().sourceKey).toBe(sourceB);
  });

  it("keeps session-detail cache entries isolated by source key", () => {
    const registry = createSourceRuntimeRegistry({
      apiClient: fakeApiClient(),
      sessionDetails: { cache: createSessionDetailMemoryCache() },
    });
    const sourceA = asClientSummarySourceKey("host:a");
    const sourceB = asClientSummarySourceKey("host:b");
    const runtimeA = registry.getOrCreateSourceRuntime(sourceA);
    const runtimeB = registry.getOrCreateSourceRuntime(sourceB);
    const projectId = "project-a";
    const sessionId = "session-a";

    runtimeA.sessionDetails.cache.writeRouteSnapshot(
      { sourceKey: sourceA, projectId, sessionId },
      snapshot(sessionId, "msg-a"),
    );

    expect(
      runtimeB.sessionDetails.cache.readRouteSnapshot({
        sourceKey: sourceB,
        projectId,
        sessionId,
      }),
    ).toBeUndefined();
    expect(
      runtimeA.sessionDetails.cache.readRouteSnapshot({
        sourceKey: sourceA,
        projectId,
        sessionId,
      })?.lastMessageId,
    ).toBe("msg-a");
  });

  it("can dispose only the runtime wrapper for a source", () => {
    const registry = createSourceRuntimeRegistry({
      apiClient: fakeApiClient(),
      sessionDetails: { cache: createSessionDetailMemoryCache() },
    });
    const sourceKey = asClientSummarySourceKey("host:disposed");
    const first = registry.getOrCreateSourceRuntime(sourceKey);

    registry.disposeSource(sourceKey);

    const second = registry.getOrCreateSourceRuntime(sourceKey);
    expect(second).not.toBe(first);
    expect(second.sourceKey).toBe(sourceKey);
  });
});
