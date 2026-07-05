import type {
  DeviceServerMessage,
  RemoteClientMessage,
  StagedAttachmentRef,
  UploadedFile,
} from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionManager } from "../../connection/ConnectionManager";
import type { WebSocketConnection } from "../../connection/WebSocketConnection";
import type {
  Connection,
  ConnectionSpeechSocket,
  SessionSubscriptionOptions,
  StreamHandlers,
  Subscription,
} from "../../connection/types";
import {
  SecureSourceTransport,
  WebSocketSourceTransport,
} from "../MultiplexSourceTransport";

class FakeMultiplexConnection implements Connection {
  readonly mode = "secure" as const;
  manager: ConnectionManager | null = null;
  readonly fetchMock = vi.fn();
  readonly fetchBlobMock = vi.fn();
  readonly upload = vi.fn(
    async (
      _projectId: string,
      _sessionId: string,
      file: File,
    ): Promise<UploadedFile> => ({
      id: `${this.id}-file`,
      name: file.name,
      originalName: file.name,
      path: `/uploads/${file.name}`,
      size: file.size,
      mimeType: file.type,
    }),
  );
  readonly uploadStagedAttachment = vi.fn(
    async (file: File): Promise<StagedAttachmentRef> => ({
      id: `${this.id}-staged`,
      batchId: `${this.id}-batch`,
      originalName: file.name,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    }),
  );
  readonly close = vi.fn();
  readonly reconnect = vi.fn(async () => {
    this.manager?.markConnected();
  });
  readonly forceReconnect = vi.fn(async () => {
    this.manager?.markConnected();
  });
  readonly sendPing = vi.fn();
  readonly sendMessage = vi.fn((_msg: RemoteClientMessage) => undefined);
  private readonly deviceHandlers = new Set<
    (msg: DeviceServerMessage) => void
  >();

  constructor(readonly id: string) {}

  async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    this.fetchMock(path, init);
    return { from: this.id, path } as T;
  }

  async fetchBlob(path: string): Promise<Blob> {
    this.fetchBlobMock(path);
    return new Blob(["ok"]);
  }

  setConnectionManager(manager: ConnectionManager | null): void {
    this.manager = manager;
  }

  subscribeSession(
    _sessionId: string,
    handlers: StreamHandlers,
    _lastEventId?: string,
    _options?: SessionSubscriptionOptions,
  ): Subscription {
    handlers.onOpen?.();
    return { close: () => handlers.onClose?.() };
  }

  subscribeActivity(handlers: StreamHandlers): Subscription {
    handlers.onOpen?.();
    return { close: () => handlers.onClose?.() };
  }

  subscribeSessionWatch(
    _sessionId: string,
    handlers: StreamHandlers,
  ): Subscription {
    handlers.onOpen?.();
    return { close: () => handlers.onClose?.() };
  }

  onDeviceMessage(handler: (msg: DeviceServerMessage) => void): () => void {
    this.deviceHandlers.add(handler);
    return () => {
      this.deviceHandlers.delete(handler);
    };
  }

  openSpeechSocket(): Promise<ConnectionSpeechSocket> {
    return Promise.resolve({
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: vi.fn(),
      close: vi.fn(),
    });
  }
}

function streamChannel(transport: WebSocketSourceTransport) {
  return transport.status
    .getSnapshot()
    .channels.find((channel) => channel.name === "multiplex-websocket");
}

describe("multiplex source transports", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects empty-slot demand fetches with a retryable typed timeout", async () => {
    vi.useFakeTimers();
    const transport = new SecureSourceTransport({ readyTimeoutMs: 25 });

    const pending = transport.fetch("/sessions");
    const assertion = expect(pending).rejects.toMatchObject({
      code: "SOURCE_TRANSPORT_NOT_READY",
      retryable: true,
      transportKind: "secure",
      channel: "secure-websocket",
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    transport.dispose();
  });

  it("resolves pending fetches on attach and preserves facade identity across replacement", async () => {
    vi.useFakeTimers();
    const transport = new SecureSourceTransport({ readyTimeoutMs: 1000 });
    const facade = transport;
    const first = new FakeMultiplexConnection("first");
    const second = new FakeMultiplexConnection("second");

    const pending = transport.fetch("/projects");
    transport.attach(first as unknown as Parameters<typeof transport.attach>[0]);

    await expect(pending).resolves.toEqual({
      from: "first",
      path: "/projects",
    });
    expect(transport.status.getSnapshot()).toMatchObject({
      kind: "secure",
      state: "ready",
    });

    transport.attach(second as unknown as Parameters<typeof transport.attach>[0]);
    await expect(facade.fetch("/projects")).resolves.toEqual({
      from: "second",
      path: "/projects",
    });
    expect(first.close).not.toHaveBeenCalled();

    transport.dispose();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("reports retryable raw subscription errors while detached", async () => {
    const transport = new SecureSourceTransport({ readyTimeoutMs: 25 });
    const onError = vi.fn();
    const subscription = transport.subscribeActivity({
      onEvent: vi.fn(),
      onError,
    });

    await Promise.resolve();

    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: "SOURCE_TRANSPORT_NOT_READY",
      retryable: true,
      transportKind: "secure",
    });
    subscription.close();
    transport.dispose();
  });

  it("keeps the per-transport manager passive until consumers migrate", async () => {
    const transport = new WebSocketSourceTransport({ readyTimeoutMs: 25 });
    const connection = new FakeMultiplexConnection("ws");

    transport.attach(connection as unknown as WebSocketConnection);
    expect(streamChannel(transport)).toMatchObject({ state: "connected" });

    connection.manager?.handleClose(new Error("socket dropped"));
    expect(transport.status.getSnapshot().state).toBe("reconnecting");
    expect(streamChannel(transport)).toMatchObject({
      state: "reconnecting",
    });

    await Promise.resolve();
    expect(connection.reconnect).not.toHaveBeenCalled();

    connection.manager?.markConnected();
    expect(transport.status.getSnapshot().state).toBe("ready");
    expect(streamChannel(transport)).toMatchObject({ state: "connected" });
    transport.dispose();
  });
});
