import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type {
  RelayRequest,
  RelayResponse,
  RelaySubscribe,
  YepMessage,
} from "@yep-anywhere/shared";
import { decodeJsonFrame, encodeJsonFrame } from "@yep-anywhere/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../setup/create-app.js";
import { AuthService } from "../../src/auth/AuthService.js";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/routes.js";
import { attachUnifiedUpgradeHandler } from "../../src/frontend/index.js";
import { RemoteAccessService } from "../../src/remote-access/index.js";
import { createWsRelayRoutes } from "../../src/routes/ws-relay.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { UploadManager } from "../../src/uploads/manager.js";
import { EventBus } from "../../src/watcher/index.js";

/**
 * A limited user who logs in directly and opens `/api/ws` keeps their own
 * authority: the socket's login decides who acts, not the headers a client
 * puts on a tunneled request. topics/limited-users.md § Delivery v1 —
 * Authorization.
 */
describe("WebSocket limited-user login E2E", () => {
  let testDir: string;
  let server: ReturnType<typeof serve>;
  let serverPort: number;
  let limitedCookie: string;
  let superuserCookie: string;
  let serverSettingsService: ServerSettingsService;

  beforeAll(async () => {
    testDir = join(tmpdir(), `ws-limited-user-test-${randomUUID()}`);
    const dataDir = join(testDir, "data");
    await mkdir(dataDir, { recursive: true });

    const authService = new AuthService({
      dataDir,
      cookieSecret: "ws-limited-user-cookie-secret",
    });
    await authService.initialize();
    await authService.enableAuth("superuser-password");
    superuserCookie = `${SESSION_COOKIE_NAME}=${await authService.createSession("superuser")}`;
    limitedCookie = `${SESSION_COOKIE_NAME}=${await authService.createSession("bob", "bob")}`;

    const limitedUsersService = new LimitedUsersService({ dataDir });
    await limitedUsersService.initialize();
    await limitedUsersService.create({
      username: "bob",
      password: "correct-horse-battery",
      viewProjects: ["granted-project"],
      joinProjects: [],
      joinStaleOffsetMinutes: 0,
    });

    serverSettingsService = new ServerSettingsService({ dataDir });
    await serverSettingsService.initialize();
    await serverSettingsService.updateSettings({ limitedUsersEnabled: true });

    const remoteAccessService = new RemoteAccessService({ dataDir });
    await remoteAccessService.initialize();
    await remoteAccessService.setRelayConfig({
      url: "wss://test-relay.example.com/ws",
      username: "owner",
    });
    await remoteAccessService.configure("owner-remote-password");

    const eventBus = new EventBus();
    const { app, supervisor, authorizeSubscription, isActivityEventVisible } =
      createApp({
        sdk: new MockClaudeSDK(),
        projectsDir: testDir,
        eventBus,
        authService,
        authDisabled: false,
        limitedUsersService,
        serverSettingsService,
        remoteAccessService,
      });

    const { upgradeWebSocket, wss } = createNodeWebSocket({ app });
    const wsRelayHandler = createWsRelayRoutes({
      upgradeWebSocket,
      app,
      baseUrl: "http://localhost:0",
      supervisor,
      eventBus,
      uploadManager: new UploadManager({
        uploadsDir: join(testDir, "uploads"),
      }),
      remoteAccessService,
      authorizeSubscription,
      isActivityEventVisible,
    });
    app.get("/api/ws", wsRelayHandler);

    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      serverPort = info.port;
    });
    attachUnifiedUpgradeHandler(server, {
      frontendProxy: undefined,
      isApiPath: (urlPath) => urlPath.startsWith("/api"),
      app,
      wss,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    server?.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function connectWebSocket(cookie: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/api/ws`, {
        headers: { Cookie: cookie },
      });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000);
    });
  }

  function awaitResponse(
    ws: WebSocket,
    id: string,
    frame: RelayRequest | RelaySubscribe,
  ): Promise<RelayResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for WS response")),
        5000,
      );
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const msg: YepMessage =
            typeof data === "string"
              ? (JSON.parse(data) as YepMessage)
              : decodeJsonFrame<YepMessage>(data as Buffer);
          if (msg.type === "response" && msg.id === id) {
            clearTimeout(timeout);
            ws.off("message", onMessage);
            resolve(msg);
          }
        } catch {
          // Ignore unrelated frames
        }
      };
      ws.on("message", onMessage);
      ws.send(encodeJsonFrame(frame));
    });
  }

  function tunnel(
    ws: WebSocket,
    path: string,
    headers?: Record<string, string>,
  ): Promise<RelayResponse> {
    const request: RelayRequest = {
      type: "request",
      id: randomUUID(),
      method: "GET",
      path,
      ...(headers ? { headers } : {}),
    };
    return awaitResponse(ws, request.id, request);
  }

  it("keeps a tunneled request that sends no cookie within the limited login", async () => {
    const ws = await connectWebSocket(limitedCookie);
    try {
      // User administration is the superuser's alone.
      expect((await tunnel(ws, "/api/users")).status).toBe(403);
    } finally {
      ws.close();
    }
  });

  it("ignores a superuser session cookie a limited socket puts on a request", async () => {
    const ws = await connectWebSocket(limitedCookie);
    try {
      const response = await tunnel(ws, "/api/users", {
        Cookie: superuserCookie,
      });
      expect(response.status).toBe(403);
    } finally {
      ws.close();
    }
  });

  it("refuses a session subscription outside the limited login's grants", async () => {
    const ws = await connectWebSocket(limitedCookie);
    try {
      const subscriptionId = randomUUID();
      const response = await awaitResponse(ws, subscriptionId, {
        type: "subscribe",
        subscriptionId,
        channel: "session",
        sessionId: "some-other-users-session",
      });
      expect(response.status).toBe(403);
    } finally {
      ws.close();
    }
  });

  it("leaves a superuser login's socket unrestricted", async () => {
    const ws = await connectWebSocket(superuserCookie);
    try {
      expect((await tunnel(ws, "/api/users")).status).toBe(200);
    } finally {
      ws.close();
    }
  });

  it("refuses a live limited login once the feature is turned off", async () => {
    const ws = await connectWebSocket(limitedCookie);
    await serverSettingsService.updateSettings({ limitedUsersEnabled: false });
    try {
      // Turning the feature off must lock bob out, not make him the superuser.
      expect((await tunnel(ws, "/api/users")).status).toBe(401);
      const subscriptionId = randomUUID();
      const subscription = await awaitResponse(ws, subscriptionId, {
        type: "subscribe",
        subscriptionId,
        channel: "activity",
      });
      expect(subscription.status).toBe(403);

      const direct = await fetch(`http://localhost:${serverPort}/api/users`, {
        headers: { Cookie: limitedCookie, "X-Yep-Anywhere": "true" },
      });
      expect(direct.status).toBe(401);
      await expect(connectWebSocket(limitedCookie)).rejects.toThrow();

      const owner = await fetch(`http://localhost:${serverPort}/api/users`, {
        headers: { Cookie: superuserCookie, "X-Yep-Anywhere": "true" },
      });
      expect(owner.status).toBe(200);
    } finally {
      ws.close();
      await serverSettingsService.updateSettings({ limitedUsersEnabled: true });
    }
  });
});
