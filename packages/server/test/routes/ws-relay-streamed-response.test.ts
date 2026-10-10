import type { HttpBindings } from "@hono/node-server";
import {
  BinaryFormat,
  RELAY_RESPONSE_STREAM_CHUNK_BYTES,
  RELAY_RESPONSE_STREAM_IDLE_TIMEOUT_MS,
  RELAY_RESPONSE_STREAM_WINDOW_BYTES,
  TransportChunkReassembler,
  type YepMessage,
  decodeResponseChunkPayload,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptBinaryEnvelopeRaw } from "../../src/crypto/index.js";
import {
  type ConnectionState,
  RELAY_BINARY_RESPONSE_MAX_BYTES,
  cleanupConnectionState,
  createConnectionState,
  createSendFn,
  handleRequest,
  handleResponseStreamAck,
  handleResponseStreamCancel,
} from "../../src/routes/ws-relay-handlers.js";

const REQUEST_ID = "3f1b2a4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const sessionKey = new Uint8Array(32).fill(7);

type Received =
  | { kind: "message"; seq: number; msg: YepMessage }
  | { kind: "chunk"; seq: number; requestId: string; data: Uint8Array };

function setup(body: () => Response, path = "/api/file") {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get(path.split("?")[0]!, body);
  const state = createConnectionState();
  state.authState = "authenticated";
  state.sessionKey = sessionKey;
  state.supportedFormats = new Set([
    BinaryFormat.JSON,
    BinaryFormat.TRANSPORT_CHUNK,
  ]);
  const received: Received[] = [];
  const reassembler = new TransportChunkReassembler();
  const closes: unknown[] = [];
  const ws = {
    send: (frame: string | ArrayBuffer | Uint8Array) => {
      if (typeof frame === "string") throw new Error("Expected binary");
      const envelope = reassembler.acceptFrame(frame);
      if (!envelope) return;
      const decrypted = decryptBinaryEnvelopeRaw(envelope, sessionKey);
      if (!decrypted) throw new Error("Undecryptable frame");
      if (decrypted.format === BinaryFormat.RESPONSE_CHUNK) {
        received.push({
          kind: "chunk",
          ...decodeResponseChunkPayload(decrypted.payload),
        });
        return;
      }
      const { seq, msg } = JSON.parse(
        new TextDecoder().decode(decrypted.payload),
      ) as { seq: number; msg: YepMessage };
      received.push({ kind: "message", seq, msg });
    },
    close: (code?: number) => {
      closes.push(code);
    },
  };
  const request = (stream = true) =>
    handleRequest(
      {
        type: "request",
        id: REQUEST_ID,
        method: "GET",
        path,
        ...(stream ? { stream: true } : {}),
      },
      createSendFn(ws, state),
      ws,
      app,
      "http://localhost",
      state,
    );
  return { state, received, closes, request };
}

function chunkBytes(received: Received[]): number {
  return received.reduce(
    (sum, item) => sum + (item.kind === "chunk" ? item.data.byteLength : 0),
    0,
  );
}

function messages(received: Received[]): YepMessage[] {
  return received.flatMap((item) =>
    item.kind === "message" ? [item.msg] : [],
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function attachmentResponse(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("streamed relay responses", () => {
  it("delivers a bootstrap part before completion and cancels a quiet producer", async () => {
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        producer = controller;
      },
      cancel: cancelled,
    });
    const { state, received, request } = setup(
      () =>
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      "/api/settings?bootstrap=new-session-v1",
    );
    const running = request();
    try {
      const first = new TextEncoder().encode(
        'event: bootstrap\ndata: {"part":"projects","status":200,"body":{"projects":[]}}\n\n',
      );
      producer.enqueue(first);
      await vi.waitFor(() =>
        expect(chunkBytes(received)).toBe(first.byteLength),
      );
      expect(messages(received).map((message) => message.type)).toEqual([
        "response_stream_start",
      ]);
      expect(state.responseStreams.size).toBe(1);
      handleResponseStreamCancel(state, REQUEST_ID);
      await running;
      expect(cancelled).toHaveBeenCalledOnce();
      expect(state.responseStreams.size).toBe(0);
    } finally {
      cleanupConnectionState(state);
      await running;
    }
  });

  it("streams a body past the single-message limit within the client's window", async () => {
    // Larger than one relayed response may be, so only streaming can carry it.
    const size = RELAY_BINARY_RESPONSE_MAX_BYTES + 3;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 4093) bytes[i] = i % 251;
    const { state, received, request } = setup(() => attachmentResponse(bytes));

    const done = request();
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    let delivered = 0;
    let acked = 0;
    let checksum = 0;
    while (!finished) {
      await settle();
      for (const item of received) {
        if (item.kind !== "chunk") continue;
        delivered += item.data.byteLength;
        for (const byte of item.data) checksum += byte;
      }
      // Keep only messages; the test must not hold the whole body either.
      received.splice(
        0,
        received.length,
        ...received.filter((item) => item.kind === "message"),
      );
      expect(delivered - acked).toBeLessThanOrEqual(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      acked = delivered;
      handleResponseStreamAck(state, REQUEST_ID, acked);
    }
    await done;

    let expected = 0;
    for (const byte of bytes) expected += byte;
    expect(delivered).toBe(size);
    expect(checksum).toBe(expected);
    expect(messages(received).map((msg) => msg.type)).toEqual([
      "response_stream_start",
      "response_stream_end",
    ]);
    expect(state.responseStreams.size).toBe(0);
  }, 60_000);

  it("delivers exact bytes and sequences chunks with the other messages", async () => {
    const size = 3 * RELAY_RESPONSE_STREAM_CHUNK_BYTES + 17;
    const bytes = new Uint8Array(size).map((_, i) => (i * 31) % 256);
    const { state, received, request } = setup(() => attachmentResponse(bytes));

    const done = request();
    // Everything fits the first window, so no acknowledgement is needed.
    await done;

    const start = received[0];
    expect(start).toMatchObject({
      kind: "message",
      msg: {
        type: "response_stream_start",
        id: REQUEST_ID,
        status: 200,
        length: size,
        headers: { "content-type": "application/octet-stream" },
      },
    });
    expect(received.at(-1)).toMatchObject({
      kind: "message",
      msg: { type: "response_stream_end", id: REQUEST_ID },
    });
    expect(
      (received.at(-1) as unknown as { msg: Record<string, unknown> }).msg,
    ).not.toHaveProperty("error");
    const chunks = received.filter((item) => item.kind === "chunk");
    expect(chunks.every((chunk) => chunk.requestId === REQUEST_ID)).toBe(true);
    expect(
      chunks.every(
        (chunk) => chunk.data.byteLength <= RELAY_RESPONSE_STREAM_CHUNK_BYTES,
      ),
    ).toBe(true);
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk.data, offset);
      offset += chunk.data.byteLength;
    }
    expect(offset).toBe(size);
    // Deep equality walks a typed array element by element: the whole test
    // took 664ms here and exceeded 5s on loaded CI (graehl 37211422041).
    expect(Buffer.compare(joined, bytes)).toBe(0);
    expect(received.map((item) => item.seq)).toEqual(
      received.map((_, index) => index),
    );
    expect(state.nextOutboundSeq).toBe(received.length);
  });

  it("stops reading when the client cancels", async () => {
    let pulls = 0;
    const body = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            controller.enqueue(
              new Uint8Array(RELAY_RESPONSE_STREAM_CHUNK_BYTES),
            );
          },
        }),
        { headers: { "Content-Type": "video/mp4" } },
      );
    const { state, received, request } = setup(body);

    const done = request();
    await settle();
    expect(chunkBytes(received)).toBe(RELAY_RESPONSE_STREAM_WINDOW_BYTES);
    handleResponseStreamCancel(state, REQUEST_ID);
    await done;
    const pullsAtCancel = pulls;
    await settle();

    expect(pulls).toBe(pullsAtCancel);
    expect(messages(received).map((msg) => msg.type)).toEqual([
      "response_stream_start",
    ]);
    expect(state.responseStreams.size).toBe(0);
  });

  it("releases a waiting stream when the connection closes", async () => {
    const { state, request } = setup(() =>
      attachmentResponse(
        new Uint8Array(4 * RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      ),
    );
    const done = request();
    await settle();
    expect(state.responseStreams.size).toBe(1);
    cleanupConnectionState(state as ConnectionState);
    await done;
    expect(state.responseStreams.size).toBe(0);
  });

  it("ends with an error when the client stops consuming", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { received, request } = setup(() =>
      attachmentResponse(
        new Uint8Array(4 * RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      ),
    );
    const done = request();
    await vi.advanceTimersByTimeAsync(
      RELAY_RESPONSE_STREAM_IDLE_TIMEOUT_MS + 1,
    );
    await done;
    expect(messages(received).at(-1)).toMatchObject({
      type: "response_stream_end",
      error: expect.stringContaining("stopped reading"),
    });
  });

  it("answers an error status with one response even when asked to stream", async () => {
    const { received, request } = setup(() =>
      Response.json({ error: "Not found" }, { status: 404 }),
    );
    await request();
    expect(messages(received)).toEqual([
      expect.objectContaining({ type: "response", status: 404 }),
    ]);
  });
});
