import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { HttpBindings } from "@hono/node-server";
import type { RelayResponse, YepMessage } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalFileRoutes } from "../../src/routes/local-file.js";
import {
  createConnectionState,
  handleRequest,
} from "../../src/routes/ws-relay-handlers.js";

describe("WebSocket relay local-file requests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "yep-relay-local-file-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns local-file route responses through an authenticated relay", async () => {
    const allowedDir = path.join(tempDir, "allowed");
    await mkdir(allowedDir, { recursive: true });

    const filePath = path.join(allowedDir, "probe.json");
    await writeFile(filePath, '{"ok":true}');

    const app = new Hono<{ Bindings: HttpBindings }>();
    app.route(
      "/api/local-file",
      createLocalFileRoutes({
        allowedPaths: [allowedDir],
      }),
    );

    const sent: YepMessage[] = [];
    const connState = createConnectionState();
    connState.authState = "authenticated";
    connState.sessionKey = new Uint8Array(32);

    await handleRequest(
      {
        type: "request",
        id: "local-file-1",
        method: "GET",
        path: `/api/local-file?path=${encodeURIComponent(filePath)}`,
      },
      (message) => sent.push(message),
      app,
      "http://localhost",
      connState,
    );

    expect(sent).toHaveLength(1);
    const response = sent[0] as RelayResponse;
    expect(response).toMatchObject({
      body: { ok: true },
      id: "local-file-1",
      status: 200,
      type: "response",
    });
    expect(response.headers?.["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
  });
});
