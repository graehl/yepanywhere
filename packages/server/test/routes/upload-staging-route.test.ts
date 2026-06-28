import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type {
  UploadServerMessage,
  UploadStartMessage,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachUnifiedUpgradeHandler } from "../../src/frontend/index.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createUploadRoutes } from "../../src/routes/upload.js";
import { AttachmentStagingService } from "../../src/uploads/index.js";

describe("staged upload direct route", () => {
  let testDir: string;
  let server: ReturnType<typeof serve> | null;
  let port: number;
  let stagingService: AttachmentStagingService;

  beforeEach(async () => {
    testDir = join(tmpdir(), `staged-upload-route-${randomUUID()}`);
    server = null;
    stagingService = new AttachmentStagingService({
      stagingRoot: join(testDir, "staging"),
    });

    const app = new Hono();
    const { upgradeWebSocket, wss } = createNodeWebSocket({ app });
    app.route(
      "/api",
      createUploadRoutes({
        scanner: {
          getOrCreateProject: async () => null,
        } as unknown as ProjectScanner,
        upgradeWebSocket,
        attachmentStagingService: stagingService,
      }),
    );

    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
    });
    attachUnifiedUpgradeHandler(server, {
      frontendProxy: undefined,
      isApiPath: (urlPath) => urlPath.startsWith("/api"),
      app,
      wss,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterEach(async () => {
    server?.close();
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("streams draft-staged uploads and returns a staged ref", async () => {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://localhost:${port}/api/attachments/staging/drafts/upload/ws`,
      );
      socket.on("open", () => resolve(socket));
      socket.on("error", reject);
    });

    const completePromise = new Promise<UploadServerMessage>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for staged upload")),
        5000,
      );
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as UploadServerMessage;
        if (msg.type === "complete" || msg.type === "error") {
          clearTimeout(timeout);
          resolve(msg);
        }
      });
    });

    const start: UploadStartMessage = {
      type: "start",
      batchId: "batch-a",
      name: "draft.txt",
      size: 5,
      mimeType: "text/plain",
    };
    ws.send(JSON.stringify(start));
    ws.send(Buffer.from("hello"));
    ws.send(JSON.stringify({ type: "end" }));

    const complete = await completePromise;
    ws.close();

    expect(complete.type).toBe("complete");
    expect("file" in complete).toBe(false);
    if (!("stagedRef" in complete)) {
      throw new Error("Expected staged upload completion");
    }
    expect(complete.stagedRef).toMatchObject({
      batchId: "batch-a",
      originalName: "draft.txt",
      size: 5,
      mimeType: "text/plain",
    });
    await expect(stagingService.listDraftAttachments("batch-a")).resolves.toEqual(
      [complete.stagedRef],
    );
  });
});
