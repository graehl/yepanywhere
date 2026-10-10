import {
  RELAY_RESPONSE_STREAM_WINDOW_BYTES,
  type RelayRequest,
  type RemoteClientMessage,
} from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { RelayProtocol, type RelayTransport } from "../RelayProtocol";

function harness(supportsStreamedResponses = true) {
  const sent: RemoteClientMessage[] = [];
  const transport: RelayTransport = {
    sendMessage: (msg) => {
      sent.push(msg);
    },
    sendUploadChunk: vi.fn(async () => undefined),
    ensureConnected: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
    supportsStreamedResponses,
  };
  return { sent, protocol: new RelayProtocol(transport) };
}

async function sentRequest(sent: RemoteClientMessage[]): Promise<RelayRequest> {
  for (let i = 0; i < 20; i++) {
    const request = sent.find(
      (msg): msg is RelayRequest => msg.type === "request",
    );
    if (request) return request;
    await Promise.resolve();
  }
  throw new Error("No request sent");
}

function acks(sent: RemoteClientMessage[]): number[] {
  return sent.flatMap((msg) =>
    msg.type === "response_stream_ack" ? [msg.bytes] : [],
  );
}

const piece = (size: number, fill: number) => new Uint8Array(size).fill(fill);

describe("RelayProtocol streamed responses", () => {
  it("preserves bootstrap negotiation headers and ordinary JSON from older servers", async () => {
    const { sent, protocol } = harness();
    const pending = protocol.fetchStream("/settings?bootstrap=new-session-v1", {
      headers: new Headers({ Accept: "text/event-stream" }),
    });
    const request = await sentRequest(sent);
    expect(new Headers(request.headers).get("Accept")).toBe(
      "text/event-stream",
    );
    expect(new Headers(request.headers).get("X-Yep-Anywhere")).toBe("true");
    protocol.routeMessage({
      type: "response",
      id: request.id,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { settings: {} },
    });
    expect(await (await pending).json()).toEqual({ settings: {} });
  });

  it("asks to stream and delivers the body as it arrives", async () => {
    const { sent, protocol } = harness();
    const pending = protocol.fetchStream("/projects/p/files/raw?path=a.bin");
    const request = await sentRequest(sent);
    expect(request).toMatchObject({
      method: "GET",
      path: "/api/projects/p/files/raw?path=a.bin",
      stream: true,
    });

    protocol.routeMessage({
      type: "response_stream_start",
      id: request.id,
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      length: 6,
    });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("6");
    protocol.handleResponseChunk(request.id, piece(4, 1));
    protocol.handleResponseChunk(request.id, piece(2, 2));
    protocol.routeMessage({ type: "response_stream_end", id: request.id });

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 1, 1, 1, 2, 2]),
    );
  });

  it("reports consumed bytes so the server can send more", async () => {
    const { sent, protocol } = harness();
    const pending = protocol.fetchStream("/file");
    const request = await sentRequest(sent);
    protocol.routeMessage({
      type: "response_stream_start",
      id: request.id,
      status: 200,
    });
    const reader = (await pending).body!.getReader();
    const chunk = RELAY_RESPONSE_STREAM_WINDOW_BYTES / 4;

    // Unread bytes are not acknowledged: a slow reader holds the server back.
    for (let i = 0; i < 4; i++) {
      protocol.handleResponseChunk(request.id, piece(chunk, i));
    }
    expect(acks(sent)).toEqual([]);

    let read = 0;
    while (read < RELAY_RESPONSE_STREAM_WINDOW_BYTES) {
      const { value } = await reader.read();
      read += value!.byteLength;
    }
    await Promise.resolve();
    expect(acks(sent).at(-1)).toBe(RELAY_RESPONSE_STREAM_WINDOW_BYTES);
  });

  it("accepts one ordinary response from a server that does not stream", async () => {
    const { sent, protocol } = harness();
    const pending = protocol.fetchStream("/file");
    const request = await sentRequest(sent);
    protocol.routeMessage({
      type: "response",
      id: request.id,
      status: 200,
      headers: { "content-type": "image/png" },
      body: { _binary: true, data: btoa("png") },
    });
    const response = await pending;
    expect(await response.text()).toBe("png");
  });

  it("rejects an error status", async () => {
    const { sent, protocol } = harness();
    const pending = protocol.fetchStream("/file");
    const request = await sentRequest(sent);
    protocol.routeMessage({
      type: "response",
      id: request.id,
      status: 404,
      body: { error: "File not found" },
    });
    await expect(pending).rejects.toThrow("File not found");
  });

  it("cancels the server's stream when the reader cancels", async () => {
    const { sent, protocol } = harness();
    const pending = protocol.fetchStream("/file");
    const request = await sentRequest(sent);
    protocol.routeMessage({
      type: "response_stream_start",
      id: request.id,
      status: 200,
    });
    const response = await pending;
    await response.body!.cancel();

    expect(sent.at(-1)).toEqual({
      type: "response_stream_cancel",
      id: request.id,
    });
    // Chunks already in flight are dropped.
    expect(() =>
      protocol.handleResponseChunk(request.id, piece(8, 1)),
    ).not.toThrow();
  });

  it("cancels a stream that starts after its caller gave up", async () => {
    const { sent, protocol } = harness();
    const controller = new AbortController();
    const pending = protocol.fetchStream("/file", {
      signal: controller.signal,
    });
    const request = await sentRequest(sent);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    protocol.routeMessage({
      type: "response_stream_start",
      id: request.id,
      status: 200,
    });
    expect(sent.at(-1)).toEqual({
      type: "response_stream_cancel",
      id: request.id,
    });
  });

  it("fails the body when the stream ends with an error or the connection drops", async () => {
    const { sent, protocol } = harness();
    const first = protocol.fetchStream("/first");
    const firstRequest = await sentRequest(sent);
    protocol.routeMessage({
      type: "response_stream_start",
      id: firstRequest.id,
      status: 200,
    });
    const firstResponse = await first;
    protocol.routeMessage({
      type: "response_stream_end",
      id: firstRequest.id,
      error: "The file could not be read completely",
    });
    await expect(firstResponse.arrayBuffer()).rejects.toThrow(
      "could not be read completely",
    );

    sent.length = 0;
    const second = protocol.fetchStream("/second");
    const secondRequest = await sentRequest(sent);
    protocol.routeMessage({
      type: "response_stream_start",
      id: secondRequest.id,
      status: 200,
    });
    const secondResponse = await second;
    protocol.rejectAllPending(new Error("Connection lost"));
    await expect(secondResponse.arrayBuffer()).rejects.toThrow(
      "Connection lost",
    );
  });

  it("builds blobs from the stream without asking a non-streaming transport to stream", async () => {
    const streaming = harness();
    const blob = streaming.protocol.fetchBlob("/image.png");
    const request = await sentRequest(streaming.sent);
    streaming.protocol.routeMessage({
      type: "response_stream_start",
      id: request.id,
      status: 200,
      headers: { "content-type": "image/png" },
    });
    await Promise.resolve();
    streaming.protocol.handleResponseChunk(request.id, piece(3, 7));
    streaming.protocol.routeMessage({
      type: "response_stream_end",
      id: request.id,
    });
    const result = await blob;
    expect(result.type).toBe("image/png");
    expect(result.size).toBe(3);

    const plain = harness(false);
    void plain.protocol.fetchBlob("/image.png").catch(() => undefined);
    expect(await sentRequest(plain.sent)).not.toHaveProperty("stream");
  });
});
