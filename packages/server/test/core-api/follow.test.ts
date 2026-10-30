import { Hono } from "hono";
import { get, type IncomingMessage } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "@yep-anywhere/shared/transcript/message";
import { SUPERUSER } from "../../src/auth/principal.js";
import { createAgentApiRuntime } from "../../src/agent-api/runtime.js";
import { CoreApi } from "../../src/core-api/service.js";
import { createConversationFollow } from "../../src/core-api/conversation.js";
import { ConversationSubscriptions } from "../../src/experimental/conversation-subscriptions.js";
import { createV0Routes } from "../../src/routes/v0/index.js";

function fixture() {
  let messages: Message[] = [
    { type: "user", uuid: "q", content: "Work" },
    { type: "assistant", uuid: "a", content: "First answer" },
  ];
  let invalidate = () => {};
  let opened = 0,
    closed = 0,
    reads = 0;
  let onOpen = () => {};
  let onClose = () => {};
  const subscriptions = new ConversationSubscriptions(
    async (sessionId, notify) => {
      opened++;
      invalidate = notify;
      onOpen();
      return {
        close() {
          closed++;
          onClose();
        },
        async read() {
          reads++;
          return {
            sessionId,
            messages,
            activity: "working",
            pendingRequests: [],
            sourceCoverage: { complete: true, earlierOutsideScope: "no" },
          };
        },
      };
    },
  );
  const core = (serverId = "A") =>
    new CoreApi(serverId, {
      projects: async () => ({ items: [] }),
      providers: async () => [],
      sessions: async () => ({
        items: [
          {
            id: "s",
            projectId: "p",
            provider: "claude",
            title: null,
            updatedAt: "",
            state: "in-turn",
          },
        ],
      }),
      followConversation: createConversationFollow(subscriptions, serverId),
    });
  const app = new Hono<{ Variables: { yaPrincipal: typeof SUPERUSER } }>();
  app.use("*", async (c, next) => {
    c.set("yaPrincipal", SUPERUSER);
    await next();
  });
  app.route("/v0", createV0Routes(core()));
  return {
    app,
    core,
    subscriptions,
    setOnClose(fn: () => void) {
      onClose = fn;
    },
    setOnOpen(fn: () => void) {
      onOpen = fn;
    },
    change(next: Message[]) {
      messages = next;
      invalidate();
    },
    messages: () => messages,
    stats: () => ({ opened, closed, reads }),
  };
}
const path = "/v0/servers/A/sessions/s/conversation/follow";
afterEach(() => vi.useRealTimers());

async function json(request: Response | Promise<Response>) {
  await vi.advanceTimersByTimeAsync(1);
  return (await request).json();
}

it("shares bounded waits, emits replacement state after invalidation, and scopes reconnect cursors", async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    const initial = await json(f.app.request(path));
    expect(initial).toMatchObject({
      changed: true,
      reset: true,
      conversation: { activity: "working" },
    });
    const wait = f.app.request(`${path}?after=${initial.cursor}&waitMs=4000`);
    const second = f.app.request(`${path}?after=${initial.cursor}&waitMs=4000`);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.stats()).toEqual({ opened: 2, closed: 1, reads: 2 });
    f.change([
      ...f.messages(),
      { type: "assistant", uuid: "b", content: "Final answer" },
    ]);
    await vi.advanceTimersByTimeAsync(201);
    const changed = await (await wait).json();
    expect(changed).toMatchObject({ changed: true, reset: true });
    expect(JSON.stringify(changed.conversation)).toContain("Final answer");
    expect((await (await second).json()).cursor).toBe(changed.cursor);
    expect(f.stats()).toEqual({ opened: 2, closed: 2, reads: 3 });
    const unchanged = f.app.request(`${path}?after=${changed.cursor}&waitMs=0`);
    await vi.advanceTimersByTimeAsync(0);
    expect(await json(unchanged)).toEqual({
      cursor: changed.cursor,
      changed: false,
      reset: false,
      conversation: null,
    });
    const foreignRequest = f.core("B").read("followConversation", SUPERUSER, {
      serverId: "B",
      sessionId: "s",
      query: { after: changed.cursor, waitMs: "0" },
    });
    await vi.advanceTimersByTimeAsync(1);
    const foreign = await foreignRequest;
    expect(foreign).toMatchObject({ changed: true, reset: true });
    const otherWindow = f.app.request(
      `${path}?after=${changed.cursor}&waitMs=0&maxMessages=1`,
    );
    expect(await json(otherWindow)).toMatchObject({
      changed: true,
      reset: true,
    });
    f.change([{ type: "user", uuid: "new", content: "Rewound" }]);
    const rewound = f.app.request(`${path}?after=${changed.cursor}&waitMs=0`);
    expect(await json(rewound)).toMatchObject({ changed: true, reset: true });
    expect((await f.app.request(path + "?waitMs=4001")).status).toBe(400);
    expect((await f.app.request(path + "?after=invalid")).status).toBe(400);
  } finally {
    f.subscriptions.close();
  }
});

it("does not wake a wait for tool-count-only updates and abort releases the final source", async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    const base: Message[] = [
      { type: "user", uuid: "q", content: "Work" },
      {
        type: "assistant",
        uuid: "a",
        content: [{ type: "tool_use", id: "t0", name: "Bash", input: {} }],
      },
      {
        type: "user",
        uuid: "r0",
        content: [{ type: "tool_result", tool_use_id: "t0", content: "ok" }],
      },
    ];
    f.change(base);
    const initial = await json(f.app.request(path));
    const abort = new AbortController();
    let settled = false;
    const waiting = Promise.resolve(
      f.app.request(`${path}?after=${initial.cursor}`, {
        signal: abort.signal,
      }),
    ).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(0);
    f.change([
      ...base,
      {
        type: "assistant",
        uuid: "a1",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
      },
      {
        type: "user",
        uuid: "r1",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    ]);
    await vi.advanceTimersByTimeAsync(201);
    expect(settled).toBe(false);
    abort.abort();
    await waiting;
    expect(f.stats().closed).toBe(f.stats().opened);
  } finally {
    f.subscriptions.close();
  }
});

it.skipIf(process.platform === "win32")(
  "revokes an active Unix HTTP wait and releases demand",
  async () => {
    const f = fixture();
    const runtime = await createAgentApiRuntime({
      serverId: "A",
      transport: "unix",
    });
    try {
      runtime.attachController(f.core());
      const lease = runtime.issue({
        principal: SUPERUSER,
        sessionId: () => "owner",
      });
      const request = (suffix: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = get(
            new URL(path + suffix, runtime.baseUrl),
            {
              socketPath: runtime.socketPath,
              headers: {
                Authorization: lease.environment.AGENT_YA_V0_AUTHORIZATION,
              },
            },
            (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () => resolve({ status: res.statusCode!, body }));
            },
          );
          req.on("error", reject);
        });
      const paused = await new Promise<IncomingMessage>((resolve, reject) => {
        const req = get(
          new URL(path, runtime.baseUrl),
          {
            socketPath: runtime.socketPath,
            headers: {
              Authorization: lease.environment.AGENT_YA_V0_AUTHORIZATION,
            },
          },
          (res) => {
            res.pause();
            resolve(res);
          },
        );
        req.on("error", reject);
      });
      expect(f.stats().closed).toBe(f.stats().opened);
      paused.destroy();
      const initial = await request("");
      const cursor = JSON.parse(initial.body).cursor;
      let opened!: () => void;
      const started = new Promise<void>((resolve) => (opened = resolve));
      f.setOnOpen(opened);
      let disconnected!: () => void;
      const closedByDisconnect = new Promise<void>(
        (resolve) => (disconnected = resolve),
      );
      f.setOnClose(disconnected);
      const disconnectedRequest = get(
        new URL(path + `?after=${cursor}&waitMs=4000`, runtime.baseUrl),
        {
          socketPath: runtime.socketPath,
          headers: {
            Authorization: lease.environment.AGENT_YA_V0_AUTHORIZATION,
          },
        },
      );
      disconnectedRequest.on("error", () => {});
      await started;
      disconnectedRequest.destroy();
      await closedByDisconnect;
      f.setOnClose(() => {});
      let reopened!: () => void;
      const active = new Promise<void>((resolve) => (reopened = resolve));
      f.setOnOpen(reopened);
      const waiting = request(`?after=${cursor}&waitMs=4000`);
      await active;
      lease.dispose();
      expect((await waiting).status).toBe(503);
      expect(f.stats().closed).toBe(f.stats().opened);
      expect((await request("")).status).toBe(401);
    } finally {
      f.subscriptions.close();
      await runtime.close();
    }
  },
);
