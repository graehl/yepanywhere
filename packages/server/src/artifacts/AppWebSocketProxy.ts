import { request, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { outgoingHeaders, type proxyLoopbackVhost } from "./vhost-proxy.js";
import { hostnameFromHostHeader } from "./vhosts.js";

export type AppProxy = typeof proxyLoopbackVhost;

/** Own upgrades separately from YA control sockets; dispatch retains HTTP authorization. */
export class AppWebSocketProxy {
  private readonly connections = new Map<() => void, string>();

  close(): void {
    for (const close of this.connections.keys()) close();
  }

  revokeApp(name: string): void {
    for (const [close, host] of this.connections)
      if (host.startsWith(`${name}.`)) close();
  }

  async handle(
    incoming: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    dispatch: (request: Request, proxy: AppProxy) => Promise<Response | null>,
  ): Promise<void> {
    if (this.connections.size >= 128) {
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    let upstream: Duplex | undefined;
    let pending: ReturnType<typeof request> | undefined;
    let handedOff = false;
    let expiresAt = Number.POSITIVE_INFINITY;
    const close = () => {
      clearTimeout(timer);
      pending?.destroy();
      upstream?.destroy();
      socket.destroy();
      this.connections.delete(close);
    };
    let timer = setTimeout(close, 10_000);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(
        close,
        Math.max(0, Math.min(5 * 60_000, expiresAt - Date.now())),
      );
      timer.unref();
    };
    this.connections.set(
      close,
      hostnameFromHostHeader(incoming.headers.host ?? "") ?? "",
    );
    socket.on("error", close);
    socket.on("close", close);
    const reject = (status: number) => {
      if (socket.destroyed) return;
      socket.end(
        `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    try {
      if (
        incoming.method !== "GET" ||
        incoming.headers.upgrade?.toLowerCase() !== "websocket"
      ) {
        reject(400);
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      const raw = new Request(
        new URL(incoming.url ?? "/", `http://${incoming.headers.host}`),
        { headers },
      );
      const response = await dispatch(
        raw,
        async (
          authorized,
          port,
          clientAddress,
          brokerSocket,
          authExpiresAt,
        ) => {
          expiresAt = authExpiresAt ?? Number.POSITIVE_INFINITY;
          if (socket.destroyed) return new Response(null, { status: 499 });
          handedOff = true;
          const url = new URL(authorized.url);
          pending = request({
            ...(brokerSocket
              ? {
                  createConnection: () => {
                    const target = connect(brokerSocket);
                    target.write(`${port}\n`);
                    return target;
                  },
                }
              : { hostname: "127.0.0.1", port }),
            path: `${url.pathname}${url.search}`,
            headers: {
              ...outgoingHeaders(authorized, clientAddress),
              connection: "Upgrade",
              upgrade: "websocket",
            },
          });
          pending.once("upgrade", (res, target, upstreamHead) => {
            upstream = target;
            if (socket.destroyed) {
              close();
              return;
            }
            // Only WebSocket handshake fields cross back; never upstream cookies or YA headers.
            let handshake =
              "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n";
            for (const name of [
              "sec-websocket-accept",
              "sec-websocket-protocol",
              "sec-websocket-extensions",
            ]) {
              const value = res.headers[name];
              if (typeof value === "string")
                handshake += `${name}: ${value}\r\n`;
            }
            socket.write(`${handshake}\r\n`);
            if (head.length) target.write(head);
            if (upstreamHead.length) socket.write(upstreamHead);
            target.on("error", close);
            target.on("close", close);
            target.on("data", touch);
            socket.on("data", touch);
            touch();
            target.pipe(socket).pipe(target);
          });
          pending.once("response", (res) => {
            res.resume();
            reject(res.statusCode ?? 502);
          });
          pending.once("error", () => (upstream ? close() : reject(502)));
          pending.end();
          // Internal dispatch acknowledgement; the raw socket owns the 101 response.
          return new Response(null, { status: 204 });
        },
      );
      if (!handedOff) reject(response?.status ?? 404);
    } catch {
      if (handedOff) close();
      else reject(503);
    }
  }
}
