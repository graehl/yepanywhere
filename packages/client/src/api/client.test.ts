import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteClientMessage } from "@yep-anywhere/shared";
import { api, fetchJSON } from "./client";
import {
  asClientSummarySourceKey,
  resetClientSummaryStoreForTests,
  setCurrentClientSummarySourceKey,
} from "../lib/clientSummaryStore";
import type { ConnectionManager } from "../lib/connection/ConnectionManager";
import { SecureSourceTransport } from "../lib/transport";
import {
  getSourceRuntimeRegistry,
  resetSourceRuntimeRegistryForTests,
} from "../lib/sourceRuntime";

class FakeSecureBackingConnection {
  readonly mode = "secure" as const;
  manager: ConnectionManager | null = null;
  readonly close = vi.fn();
  readonly sendPing = vi.fn();
  readonly sendMessage = vi.fn((_msg: RemoteClientMessage) => undefined);
  readonly forceReconnect = vi.fn(async () => {
    this.manager?.markConnected();
  });
  readonly fetchMock = vi.fn(
    async (path: string, init?: RequestInit): Promise<unknown> => ({
      path,
      init,
      via: "secure",
    }),
  );

  setConnectionManager(manager: ConnectionManager | null): void {
    this.manager = manager;
  }

  fetch<T>(path: string, init?: RequestInit): Promise<T> {
    return this.fetchMock(path, init) as Promise<T>;
  }
}

function resetApiRoutingState(): void {
  resetClientSummaryStoreForTests();
  resetSourceRuntimeRegistryForTests();
}

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api.updateServerSettings", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: {
          serviceWorkerEnabled: true,
          persistRemoteSessionsToDisk: false,
        },
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiRoutingState();
  });

  it("serializes undefined setting values as null so clears reach the server", async () => {
    await api.updateServerSettings({
      globalInstructions: undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.body).toBe(JSON.stringify({ globalInstructions: null }));
  });
});

describe("fetchJSON source transport routing", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetApiRoutingState();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetApiRoutingState();
  });

  it("uses plain fetch semantics for the local source", async () => {
    fetchMock.mockResolvedValueOnce(okJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJSON("/projects")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects");
    expect(request?.credentials).toBe("include");
    const headers = request?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Yep-Anywhere")).toBe("true");
  });

  it("routes remote attached fetches through the backing secure connection", async () => {
    const sourceKey = asClientSummarySourceKey("remote:attached");
    setCurrentClientSummarySourceKey(sourceKey);
    const transport = getSourceRuntimeRegistry().registerSourceTransport(
      sourceKey,
      { kind: "secure" },
    );
    expect(transport).toBeInstanceOf(SecureSourceTransport);
    const backing = new FakeSecureBackingConnection();
    (transport as SecureSourceTransport).attach(backing as never);

    await expect(
      fetchJSON("/auth/status", { method: "POST" }),
    ).resolves.toEqual({
      path: "/auth/status",
      init: { method: "POST" },
      via: "secure",
    });
    expect(backing.fetchMock).toHaveBeenCalledWith("/auth/status", {
      method: "POST",
    });
  });

  it("rejects detached remote fetches with a retryable typed timeout", async () => {
    vi.useFakeTimers();
    const sourceKey = asClientSummarySourceKey("remote:detached");
    setCurrentClientSummarySourceKey(sourceKey);
    getSourceRuntimeRegistry().registerSourceTransport(sourceKey, {
      kind: "secure",
      options: { readyTimeoutMs: 25 },
    });

    const pending = fetchJSON("/auth/status");
    const assertion = expect(pending).rejects.toMatchObject({
      code: "SOURCE_TRANSPORT_NOT_READY",
      retryable: true,
      transportKind: "secure",
      channel: "secure-websocket",
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});
