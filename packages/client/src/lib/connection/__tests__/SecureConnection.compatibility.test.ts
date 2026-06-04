// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { SecureConnection } from "../SecureConnection";
import {
  decryptBinaryEnvelope,
  deriveSecretboxKey,
  encrypt,
  encryptToBinaryEnvelope,
  generateRandomKey,
} from "../nacl-wrapper";

function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function nonceBase64(fill: number): string {
  const bytes = new Uint8Array(24).fill(fill);
  return bytesBase64(bytes);
}

function resumeServerProof(params: {
  sessionId: string;
  serverNonce: string;
  clientNonce: string;
  resumeProtocolVersion?: number;
  key: Uint8Array;
}): string {
  return JSON.stringify(
    encrypt(
      JSON.stringify({
        type: "srp_resume_server_proof",
        sessionId: params.sessionId,
        serverNonce: params.serverNonce,
        clientNonce: params.clientNonce,
        resumeProtocolVersion: params.resumeProtocolVersion ?? 3,
      }),
      params.key,
    ),
  );
}

function srpVerifyServerInfoProof(params: {
  sessionId: string;
  transportNonce: string;
  resumeProtocolVersion?: number;
  key: Uint8Array;
}): string {
  return JSON.stringify(
    encrypt(
      JSON.stringify({
        type: "srp_verify_server_info",
        sessionId: params.sessionId,
        transportNonce: params.transportNonce,
        resumeProtocolVersion: params.resumeProtocolVersion ?? 3,
      }),
      params.key,
    ),
  );
}

describe("SecureConnection protocol compatibility", () => {
  it("rejects full SRP when server omits the transport nonce", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "test-password",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      srpSession: {
        verifyServer: (m2: string) => Promise<boolean>;
        getSessionKey: () => Uint8Array;
      };
      connectionState: string;
      handleSrpVerify: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    const close = vi.fn();
    conn.ws = { readyState: 1, send, close };
    conn.srpSession = {
      verifyServer: vi.fn().mockResolvedValue(true),
      getSessionKey: vi.fn().mockReturnValue(generateRandomKey()),
    };

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpVerify(
      JSON.stringify({
        type: "srp_verify",
        M2: "abc123",
        sessionId: "sess-1",
      }),
      resolve,
      reject,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[0]?.message).toBe(
      "Server protocol verification failed",
    );
    expect(conn.connectionState).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("accepts protocol 2 full SRP during the grace period", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "test-password",
    ) as unknown as {
      ws: { readyState: number; send: ReturnType<typeof vi.fn> };
      srpSession: {
        verifyServer: (m2: string) => Promise<boolean>;
        getSessionKey: () => Uint8Array;
      };
      sessionKey: Uint8Array;
      storedSession: {
        sessionId: string;
        resumeProtocolVersion?: number;
      } | null;
      handleSrpVerify: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    conn.ws = { readyState: 1, send };
    const rawKey = generateRandomKey();
    const transportNonce = nonceBase64(3);
    conn.srpSession = {
      verifyServer: vi.fn().mockResolvedValue(true),
      getSessionKey: vi.fn().mockReturnValue(rawKey),
    };

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpVerify(
      JSON.stringify({
        type: "srp_verify",
        M2: "abc123",
        sessionId: "sess-v2",
        transportNonce,
      }),
      resolve,
      reject,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(conn.storedSession?.sessionId).toBe("sess-v2");
    expect(conn.storedSession?.resumeProtocolVersion).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);

    const sent = send.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(ArrayBuffer);
    const plaintext = decryptBinaryEnvelope(
      sent as ArrayBuffer,
      conn.sessionKey,
    );
    const parsed = JSON.parse(plaintext ?? "{}") as {
      seq: number;
      msg: { type: string };
    };
    expect(parsed.seq).toBe(0);
    expect(parsed.msg.type).toBe("client_capabilities");
  });

  it("uses sequenced binary encrypted envelopes on current servers", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "test-password",
    ) as unknown as {
      ws: { readyState: number; send: ReturnType<typeof vi.fn> };
      srpSession: {
        verifyServer: (m2: string) => Promise<boolean>;
        getSessionKey: () => Uint8Array;
      };
      sessionKey: Uint8Array;
      handleSrpVerify: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    conn.ws = { readyState: 1, send };
    const rawKey = generateRandomKey();
    const baseSessionKey = deriveSecretboxKey(rawKey);
    const transportNonce = nonceBase64(9);
    conn.srpSession = {
      verifyServer: vi.fn().mockResolvedValue(true),
      getSessionKey: vi.fn().mockReturnValue(rawKey),
    };

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpVerify(
      JSON.stringify({
        type: "srp_verify",
        M2: "abc123",
        sessionId: "sess-1",
        transportNonce,
        serverInfoProof: srpVerifyServerInfoProof({
          sessionId: "sess-1",
          transportNonce,
          key: baseSessionKey,
        }),
      }),
      resolve,
      reject,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);

    const sent = send.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(ArrayBuffer);
    const plaintext = decryptBinaryEnvelope(
      sent as ArrayBuffer,
      conn.sessionKey,
    );
    expect(plaintext).not.toBeNull();
    const parsed = JSON.parse(plaintext ?? "{}") as {
      seq: number;
      msg: { type: string };
    };
    expect(parsed.seq).toBe(0);
    expect(parsed.msg.type).toBe("client_capabilities");
  });

  it("pins authenticated resume protocol after full SRP", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "test-password",
      vi.fn(),
    ) as unknown as {
      ws: { readyState: number; send: ReturnType<typeof vi.fn> };
      srpSession: {
        verifyServer: (m2: string) => Promise<boolean>;
        getSessionKey: () => Uint8Array;
      };
      storedSession: {
        sessionId: string;
        resumeProtocolVersion?: number;
      } | null;
      handleSrpVerify: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    conn.ws = { readyState: 1, send };
    const rawKey = generateRandomKey();
    const baseSessionKey = deriveSecretboxKey(rawKey);
    const sessionId = "sess-full-srp";
    const transportNonce = nonceBase64(11);
    conn.srpSession = {
      verifyServer: vi.fn().mockResolvedValue(true),
      getSessionKey: vi.fn().mockReturnValue(rawKey),
    };

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpVerify(
      JSON.stringify({
        type: "srp_verify",
        M2: "abc123",
        sessionId,
        transportNonce,
        serverInfoProof: srpVerifyServerInfoProof({
          sessionId,
          transportNonce,
          resumeProtocolVersion: 3,
          key: baseSessionKey,
        }),
      }),
      resolve,
      reject,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(conn.storedSession?.sessionId).toBe(sessionId);
    expect(conn.storedSession?.resumeProtocolVersion).toBe(3);
  });

  it("rejects protocol 2 full SRP when protocol 3 is already pinned", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "test-password",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      srpSession: {
        verifyServer: (m2: string) => Promise<boolean>;
        getSessionKey: () => Uint8Array;
      };
      connectionState: string;
      minimumResumeProtocolVersion: number | null;
      handleSrpVerify: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    const close = vi.fn();
    conn.ws = { readyState: 1, send, close };
    conn.minimumResumeProtocolVersion = 3;
    conn.srpSession = {
      verifyServer: vi.fn().mockResolvedValue(true),
      getSessionKey: vi.fn().mockReturnValue(generateRandomKey()),
    };

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpVerify(
      JSON.stringify({
        type: "srp_verify",
        M2: "abc123",
        sessionId: "sess-downgrade",
        transportNonce: nonceBase64(12),
      }),
      resolve,
      reject,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[0]?.message).toBe(
      "Server protocol verification failed",
    );
    expect(conn.connectionState).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("attempts grace-period resume for protocol 2 and unstamped sessions", () => {
    const protocol2Conn = SecureConnection.forResumeOnly({
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId: "sess-v2",
      sessionKey: bytesBase64(generateRandomKey()),
      resumeProtocolVersion: 2,
    }) as unknown as {
      storedSessionSupportsCurrentResume: () => boolean;
    };

    const unstampedConn = SecureConnection.forResumeOnly({
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId: "sess-unstamped",
      sessionKey: bytesBase64(generateRandomKey()),
    }) as unknown as {
      storedSessionSupportsCurrentResume: () => boolean;
    };

    const protocol1Conn = SecureConnection.forResumeOnly({
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId: "sess-v1",
      sessionKey: bytesBase64(generateRandomKey()),
      resumeProtocolVersion: 1,
    }) as unknown as {
      storedSessionSupportsCurrentResume: () => boolean;
    };

    expect(protocol2Conn.storedSessionSupportsCurrentResume()).toBe(true);
    expect(unstampedConn.storedSessionSupportsCurrentResume()).toBe(true);
    expect(protocol1Conn.storedSessionSupportsCurrentResume()).toBe(false);
  });

  it("rejects unsequenced encrypted responses", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "test-password",
    ) as unknown as {
      ws: { close: ReturnType<typeof vi.fn> };
      sessionKey: Uint8Array;
      protocol: { routeMessage: ReturnType<typeof vi.fn> };
      handleMessage: (data: unknown) => Promise<void>;
    };

    conn.ws = { close: vi.fn() };
    const key = generateRandomKey();
    conn.sessionKey = key;
    conn.protocol = { routeMessage: vi.fn() };

    const msg = { type: "pong", id: "unsequenced-1" };
    const encrypted = encryptToBinaryEnvelope(JSON.stringify(msg), key);
    await conn.handleMessage(encrypted);

    expect(conn.protocol.routeMessage).not.toHaveBeenCalled();
    expect(conn.ws.close).toHaveBeenCalledWith(4004, "Invalid sequence");
  });

  it("accepts protocol 3 resume with encrypted server proof", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        onmessage?: unknown;
      };
      storedSession: {
        wsUrl: string;
        username: string;
        sessionId: string;
        sessionKey: string;
        resumeProtocolVersion?: number;
      };
      sessionKey: Uint8Array | null;
      pendingResumeClientNonce: string | null;
      pendingResumeServerNonce: string | null;
      handleSrpResumeResponse: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    conn.ws = { readyState: 1, send, close: vi.fn() };
    const baseSessionKey = generateRandomKey();
    const sessionId = "sess-resume";
    const clientNonce = nonceBase64(5);
    const serverNonce = nonceBase64(6);
    conn.storedSession = {
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId,
      sessionKey: bytesBase64(baseSessionKey),
      resumeProtocolVersion: 3,
    };
    conn.pendingResumeClientNonce = clientNonce;
    conn.pendingResumeServerNonce = serverNonce;

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpResumeResponse(
      JSON.stringify({
        type: "srp_resumed",
        sessionId,
        transportNonce: serverNonce,
        serverProof: resumeServerProof({
          sessionId,
          serverNonce,
          clientNonce,
          key: baseSessionKey,
        }),
      }),
      resolve,
      reject,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(conn.sessionKey).not.toBeNull();

    const sent = send.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(ArrayBuffer);
    const plaintext = decryptBinaryEnvelope(
      sent as ArrayBuffer,
      conn.sessionKey!,
    );
    const parsed = JSON.parse(plaintext ?? "{}") as {
      seq: number;
      msg: { type: string };
    };
    expect(parsed.seq).toBe(0);
    expect(parsed.msg.type).toBe("client_capabilities");
    expect(conn.storedSession.resumeProtocolVersion).toBe(3);
  });

  it("accepts protocol 2 resume during grace when transport nonce is present", async () => {
    const onSessionEstablished = vi.fn();
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "",
      onSessionEstablished,
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        onmessage?: unknown;
      };
      storedSession: {
        wsUrl: string;
        username: string;
        sessionId: string;
        sessionKey: string;
        resumeProtocolVersion?: number;
      };
      sessionKey: Uint8Array | null;
      pendingResumeClientNonce: string | null;
      pendingResumeServerNonce: string | null;
      handleSrpResumeResponse: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    conn.ws = { readyState: 1, send, close: vi.fn() };
    const baseSessionKey = generateRandomKey();
    const sessionId = "sess-v2-resume";
    const clientNonce = nonceBase64(13);
    const serverNonce = nonceBase64(14);
    conn.storedSession = {
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId,
      sessionKey: bytesBase64(baseSessionKey),
      resumeProtocolVersion: 2,
    };
    conn.pendingResumeClientNonce = clientNonce;
    conn.pendingResumeServerNonce = serverNonce;

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpResumeResponse(
      JSON.stringify({
        type: "srp_resumed",
        sessionId,
        transportNonce: serverNonce,
      }),
      resolve,
      reject,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(conn.sessionKey).not.toBeNull();
    expect(conn.storedSession.resumeProtocolVersion).toBe(2);
    expect(onSessionEstablished).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, resumeProtocolVersion: 2 }),
    );

    const sent = send.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(ArrayBuffer);
    const plaintext = decryptBinaryEnvelope(
      sent as ArrayBuffer,
      conn.sessionKey!,
    );
    const parsed = JSON.parse(plaintext ?? "{}") as {
      seq: number;
      msg: { type: string };
    };
    expect(parsed.seq).toBe(0);
    expect(parsed.msg.type).toBe("client_capabilities");
  });

  it("records unstamped stored sessions as protocol 2 after grace resume", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        onmessage?: unknown;
      };
      storedSession: {
        wsUrl: string;
        username: string;
        sessionId: string;
        sessionKey: string;
        resumeProtocolVersion?: number;
      };
      pendingResumeClientNonce: string | null;
      pendingResumeServerNonce: string | null;
      handleSrpResumeResponse: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    conn.ws = { readyState: 1, send, close: vi.fn() };
    const sessionId = "sess-unstamped-resume";
    const serverNonce = nonceBase64(16);
    conn.storedSession = {
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId,
      sessionKey: bytesBase64(generateRandomKey()),
    };
    conn.pendingResumeClientNonce = nonceBase64(15);
    conn.pendingResumeServerNonce = serverNonce;

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpResumeResponse(
      JSON.stringify({
        type: "srp_resumed",
        sessionId,
        transportNonce: serverNonce,
      }),
      resolve,
      reject,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(conn.storedSession.resumeProtocolVersion).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects protocol 2 resume when the transport nonce is missing", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      storedSession: {
        wsUrl: string;
        username: string;
        sessionId: string;
        sessionKey: string;
        resumeProtocolVersion?: number;
      };
      connectionState: string;
      pendingResumeClientNonce: string | null;
      pendingResumeServerNonce: string | null;
      handleSrpResumeResponse: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    const close = vi.fn();
    conn.ws = { readyState: 1, send, close };
    const sessionId = "sess-v2-no-nonce";
    conn.storedSession = {
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId,
      sessionKey: bytesBase64(generateRandomKey()),
      resumeProtocolVersion: 2,
    };
    conn.pendingResumeClientNonce = nonceBase64(17);
    conn.pendingResumeServerNonce = nonceBase64(18);

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpResumeResponse(
      JSON.stringify({
        type: "srp_resumed",
        sessionId,
      }),
      resolve,
      reject,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[0]?.message).toBe(
      "Resume server verification failed",
    );
    expect(conn.connectionState).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects protocol 3 resume when the server proof is missing", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      storedSession: {
        wsUrl: string;
        username: string;
        sessionId: string;
        sessionKey: string;
        resumeProtocolVersion?: number;
      };
      connectionState: string;
      minimumResumeProtocolVersion: number | null;
      pendingResumeClientNonce: string | null;
      pendingResumeServerNonce: string | null;
      handleSrpResumeResponse: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    const close = vi.fn();
    conn.ws = { readyState: 1, send, close };
    const sessionId = "sess-resume";
    conn.storedSession = {
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId,
      sessionKey: bytesBase64(generateRandomKey()),
      resumeProtocolVersion: 3,
    };
    conn.pendingResumeClientNonce = nonceBase64(7);
    conn.pendingResumeServerNonce = nonceBase64(8);

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpResumeResponse(
      JSON.stringify({
        type: "srp_resumed",
        sessionId,
        transportNonce: conn.pendingResumeServerNonce,
      }),
      resolve,
      reject,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[0]?.message).toBe(
      "Resume server verification failed",
    );
    expect(conn.connectionState).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects resume when server proof downgrades the pinned protocol", async () => {
    const conn = new SecureConnection(
      "ws://localhost:3400/api/ws",
      "test-user",
      "",
    ) as unknown as {
      ws: {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      storedSession: {
        wsUrl: string;
        username: string;
        sessionId: string;
        sessionKey: string;
        resumeProtocolVersion?: number;
      };
      connectionState: string;
      minimumResumeProtocolVersion: number | null;
      pendingResumeClientNonce: string | null;
      pendingResumeServerNonce: string | null;
      handleSrpResumeResponse: (
        data: string,
        resolve: () => void,
        reject: (err: Error) => void,
      ) => Promise<void>;
    };

    const send = vi.fn();
    const close = vi.fn();
    conn.ws = { readyState: 1, send, close };
    const baseSessionKey = generateRandomKey();
    const sessionId = "sess-resume";
    const clientNonce = nonceBase64(9);
    const serverNonce = nonceBase64(10);
    conn.storedSession = {
      wsUrl: "ws://localhost:3400/api/ws",
      username: "test-user",
      sessionId,
      sessionKey: bytesBase64(baseSessionKey),
      resumeProtocolVersion: 3,
    };
    conn.pendingResumeClientNonce = clientNonce;
    conn.pendingResumeServerNonce = serverNonce;
    conn.minimumResumeProtocolVersion = 3;

    const resolve = vi.fn();
    const reject = vi.fn();
    await conn.handleSrpResumeResponse(
      JSON.stringify({
        type: "srp_resumed",
        sessionId,
        transportNonce: serverNonce,
        serverProof: resumeServerProof({
          sessionId,
          serverNonce,
          clientNonce,
          resumeProtocolVersion: 2,
          key: baseSessionKey,
        }),
      }),
      resolve,
      reject,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[0]?.message).toBe(
      "Resume server verification failed",
    );
    expect(conn.connectionState).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
