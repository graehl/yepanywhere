import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPERUSER } from "../../packages/server/src/auth/principal.js";
import { createAgentApiRuntime } from "../../packages/server/src/agent-api/runtime.js";
import {
  createConversationRead,
  createConversationFollow,
} from "../../packages/server/src/core-api/conversation.js";
import { ConversationSubscriptions } from "../../packages/server/src/experimental/conversation-subscriptions.js";
import type { Message } from "../../packages/shared/src/transcript/message.js";
import { CoreApi } from "../../packages/server/src/core-api/service.js";
import {
  OWN_SESSION_ID,
  projects,
  SERVER_ID,
  sessions,
  type CaseId,
  type Trace,
} from "./cases.js";

/** Real private adapter, deterministic source functions, no app/profile/scanners. */
export async function createFixture(caseId: CaseId) {
  const runtime = await createAgentApiRuntime({ serverId: SERVER_ID });
  const noise: Message[] = Array.from({ length: 40 }, (_, i) => [
    {
      type: "assistant" as const,
      uuid: `call-${i}`,
      content: [
        {
          type: "tool_use" as const,
          id: `tool-${i}`,
          name: "Bash",
          input: { command: "diagnostic" },
        },
      ],
    },
    {
      type: "user" as const,
      uuid: `result-${i}`,
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: `tool-${i}`,
          content: `routine-noise-${i} `.repeat(500),
        },
      ],
    },
  ]).flat();
  let done = caseId === "reconnect";
  const worker = caseId === "follow" || caseId === "reconnect";
  let finishWorker!: () => void;
  const workerFinished = new Promise<void>(
    (resolve) => (finishWorker = resolve),
  );
  let notifyWorker = () => {};
  let workerTimer: ReturnType<typeof setTimeout> | undefined;
  const conversations = new ConversationSubscriptions(
    async (sessionId, invalidate) => {
      notifyWorker = invalidate;
      // The scripted worker owns progress independently of observer lifetime.
      // A finite timer starts on first observation and ends with this fixture.
      if (worker && !done && !workerTimer)
        workerTimer = setTimeout(() => {
          done = true;
          finishWorker();
          notifyWorker();
        }, 350);
      return {
        close() {},
        async read() {
          return {
            sessionId,
            messages: [
              {
                type: "user",
                uuid: "question",
                content: "Which release artifact is ready?",
              },
              ...noise,
              {
                type: "assistant",
                uuid: "answer",
                content: worker
                  ? done
                    ? "The release artifact is worker-9c4."
                    : "Working on the release."
                  : "The release artifact is orchid-7f2.",
              },
            ],
            activity:
              caseId === "evidence"
                ? "unknown"
                : worker && !done
                  ? "working"
                  : "idle",
            pendingRequests: [],
            sourceCoverage: {
              complete: caseId !== "evidence",
              earlierOutsideScope: caseId === "evidence" ? "unknown" : "no",
            },
          };
        },
      };
    },
  );
  const core = new CoreApi(SERVER_ID, {
    conversation: createConversationRead(conversations),
    followConversation: createConversationFollow(conversations, SERVER_ID),
    projects: async () => ({ items: projects }),
    sessions: async () => ({
      items: sessions,
      catalog: {
        complete: caseId !== "incomplete",
        refreshing: caseId === "incomplete",
      },
    }),
    providers: async () => [
      {
        id: "codex",
        name: "Codex",
        supportsSteering: true,
        supportsPermissionMode: true,
      },
    ],
  });
  runtime.attachController(core);
  const lease = runtime.issue({
    principal: SUPERUSER,
    sessionId: () => OWN_SESSION_ID,
  });
  const trace: Trace[] = [];
  // A test-only transparent front records actual HTTP outcomes and repeated doc
  // bytes, including failed requests. It forwards authentication to production.
  const directory = await mkdtemp(join(tmpdir(), "ya-eval-"));
  await chmod(directory, 0o700);
  const socket =
    process.platform === "win32" ? undefined : join(directory, "trace.sock");
  const front = createServer((req, res) => {
    const start = performance.now();
    let bytes = 0;
    const capture = req.url?.split("?")[0]?.endsWith("/conversation/follow");
    let captured = "";
    const upstream = request(
      new URL(req.url ?? "/", runtime.baseUrl),
      {
        method: req.method,
        headers: req.headers,
        socketPath: runtime.socketPath,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (capture && bytes <= 512 * 1024) captured += String(chunk);
        });
        response.on("end", () => {
          let follow: Trace["follow"];
          if (capture && bytes <= 512 * 1024) {
            try {
              const data = JSON.parse(captured);
              if (
                typeof data.cursor === "string" &&
                typeof data.reset === "boolean" &&
                typeof data.changed === "boolean"
              )
                follow = {
                  cursor: data.cursor,
                  reset: data.reset,
                  changed: data.changed,
                };
            } catch {
              /* Not a successful follow response. */
            }
          }
          trace.push({
            method: req.method ?? "GET",
            path: req.url ?? "/",
            status: response.statusCode ?? 502,
            bytes,
            elapsedMs: performance.now() - start,
            atMs: start,
            ...(follow ? { follow } : {}),
          });
        });
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      trace.push({
        method: req.method ?? "GET",
        path: req.url ?? "/",
        status: 502,
        bytes: 0,
        elapsedMs: performance.now() - start,
        atMs: start,
      });
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      front.once("error", reject);
      if (socket) front.listen(socket, resolve);
      else front.listen(0, "127.0.0.1", resolve);
    });
    if (socket) await chmod(socket, 0o600);
  } catch (error) {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const address = front.address();
  const url = socket
    ? "http://127.0.0.1"
    : `http://127.0.0.1:${typeof address === "object" && address ? address.port : ""}`;
  return {
    workerFinished,
    trace,
    environment: {
      ...lease.environment,
      AGENT_YA_V0_URL: url,
      ...(socket ? { AGENT_YA_V0_SOCKET: socket } : {}),
    } as Record<string, string>,
    async close() {
      front.closeAllConnections();
      await new Promise<void>((resolve) => front.close(() => resolve()));
      if (workerTimer) clearTimeout(workerTimer);
      conversations.close();
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
