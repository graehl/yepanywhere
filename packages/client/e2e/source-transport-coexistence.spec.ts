import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { e2ePaths, expect, test } from "./fixtures.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..", "..");
const serverRoot = join(repoRoot, "packages", "server");

const mockProjectPath = join(e2ePaths.tempDir, "mockproject");
const projectId = Buffer.from(mockProjectPath).toString("base64url");
const sessionId = "mock-session-001";

interface SmokeResult {
  versions: Record<"local" | "secondary", string>;
  sessionMessageText: Record<"local" | "secondary", string[]>;
  sessionFailures: Record<
    "local" | "secondary",
    { status: number | null; message: string }
  >;
  pingCounts: Record<"local" | "secondary", number>;
  visibilityRestored: Record<"local" | "secondary", number>;
  statusWithStreams: Record<
    "local" | "secondary",
    { state: string; channels: Array<{ name: string; state: string }> }
  >;
  statusAfterSecondaryDispose: {
    local: { state: string };
    secondary: { state: string };
  };
  localVersionAfterSecondaryDispose: string;
}

interface SmokeWindow {
  __YA_SOURCE_TRANSPORT_COEXISTENCE_SMOKE__?: (input: {
    secondaryWsUrl: string;
    projectId: string;
    sessionId: string;
  }) => Promise<SmokeResult>;
}

interface SecondaryServer {
  port: number;
  tempDir: string;
  process: ChildProcess;
}

async function waitForPortFile(
  portFile: string,
  name: string,
  timeoutMs = 30_000,
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(portFile)) {
      const content = readFileSync(portFile, "utf-8").trim();
      const port = Number.parseInt(content, 10);
      if (port > 0) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for ${name} port file`);
}

async function waitForHealth(port: number, timeoutMs = 30_000): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Secondary server health check failed: ${url}`);
}

function writeServerSettings(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "server-settings.json"),
    JSON.stringify(
      {
        version: 1,
        settings: {
          codexUpdatePolicy: "off",
        },
      },
      null,
      2,
    ),
  );
}

function writeMockClaudeSession(
  claudeSessionsDir: string,
  content: string,
): void {
  mkdirSync(mockProjectPath, { recursive: true });
  const encodedPath = mockProjectPath.replace(/\//g, "-");
  const sessionDir = join(claudeSessionsDir, hostname(), encodedPath);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        cwd: mockProjectPath,
        message: { role: "user", content },
        timestamp: new Date().toISOString(),
        uuid: "1",
      }),
    ].join("\n"),
  );
}

async function startSecondaryServer(): Promise<SecondaryServer> {
  const tempDir = mkdtempSync(join(tmpdir(), "ya-source-t10-"));
  const profileDir = join(tempDir, "profile");
  const portFile = join(tempDir, "port");
  const claudeSessionsDir = join(profileDir, "claude", "projects");
  const codexSessionsDir = join(profileDir, "codex", "sessions");
  const geminiSessionsDir = join(profileDir, "gemini", "tmp");
  const dataDir = join(profileDir, "yep-anywhere");

  mkdirSync(claudeSessionsDir, { recursive: true });
  mkdirSync(codexSessionsDir, { recursive: true });
  mkdirSync(geminiSessionsDir, { recursive: true });
  writeServerSettings(dataDir);
  writeMockClaudeSession(claudeSessionsDir, "Second profile previous message");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: "0",
    PORT_FILE: portFile,
    MAINTENANCE_PORT: "0",
    SERVE_FRONTEND: "false",
    LOG_LEVEL: "warn",
    LOG_FILE_LEVEL: "warn",
    LOG_TO_FILE: "false",
    AUTH_DISABLED: "true",
    HTTPS_SELF_SIGNED: "",
    NODE_ENV: "production",
    OPEN_BROWSER: "false",
    CLAUDE_SESSIONS_DIR: claudeSessionsDir,
    CODEX_SESSIONS_DIR: codexSessionsDir,
    GEMINI_SESSIONS_DIR: geminiSessionsDir,
    YEP_DATA_DIR: dataDir,
  };
  if (childEnv.FORCE_COLOR) {
    delete childEnv.NO_COLOR;
  }

  const child = spawn(
    "pnpm",
    ["exec", "tsx", "--conditions", "source", "src/index.ts"],
    {
      cwd: serverRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );

  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString();
    if (!msg.includes("ExperimentalWarning")) {
      console.error("[T10 Secondary Server]", msg);
    }
  });

  try {
    const port = await waitForPortFile(portFile, "secondary server");
    await waitForHealth(port);
    child.unref();
    return { port, tempDir, process: child };
  } catch (error) {
    stopSecondaryServer({ port: 0, tempDir, process: child });
    throw error;
  }
}

function stopSecondaryServer(server: SecondaryServer | null): void {
  if (!server) return;
  const pid = server.process.pid;
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        console.error("[T10 Secondary Server] Failed to kill process:", error);
      }
    }
  }
  rmSync(server.tempDir, { recursive: true, force: true });
}

test.describe("Source transport coexistence", () => {
  let secondaryServer: SecondaryServer | null = null;

  test.beforeAll(async () => {
    secondaryServer = await startSecondaryServer();
  });

  test.afterAll(() => {
    stopSecondaryServer(secondaryServer);
  });

  test("keeps localhost and second direct WebSocket sources independent", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/projects`);
    await page.waitForLoadState("domcontentloaded");

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              typeof (window as SmokeWindow)
                .__YA_SOURCE_TRANSPORT_COEXISTENCE_SMOKE__,
          ),
        { timeout: 10_000 },
      )
      .toBe("function");

    if (!secondaryServer) {
      throw new Error("Secondary server did not start");
    }

    const result = await page.evaluate(
      async ({ port, projectId, sessionId }) => {
        const run = (window as SmokeWindow)
          .__YA_SOURCE_TRANSPORT_COEXISTENCE_SMOKE__;
        if (!run) throw new Error("Source transport smoke helper unavailable");
        return run({
          secondaryWsUrl: `ws://127.0.0.1:${port}/api/ws`,
          projectId,
          sessionId,
        });
      },
      { port: secondaryServer.port, projectId, sessionId },
    );

    expect(result.versions.local).toBeTruthy();
    expect(result.versions.secondary).toBeTruthy();
    expect(result.localVersionAfterSecondaryDispose).toBe(result.versions.local);

    expect(result.sessionMessageText.local).toContain("Previous message");
    expect(result.sessionMessageText.secondary).toContain(
      "Second profile previous message",
    );

    expect(result.statusWithStreams.local.state).toBe("ready");
    expect(result.statusWithStreams.secondary.state).toBe("ready");
    expect(
      result.statusWithStreams.local.channels.some(
        (channel) =>
          channel.name === "stream-websocket" && channel.state === "connected",
      ),
    ).toBe(true);
    expect(
      result.statusWithStreams.secondary.channels.some(
        (channel) =>
          channel.name === "multiplex-websocket" &&
          channel.state === "connected",
      ),
    ).toBe(true);

    expect(result.pingCounts.local).toBeGreaterThanOrEqual(2);
    expect(result.pingCounts.secondary).toBe(1);
    expect(result.visibilityRestored.local).toBeGreaterThanOrEqual(2);
    expect(result.visibilityRestored.secondary).toBe(1);

    expect(result.statusAfterSecondaryDispose.local.state).toBe("ready");
    expect(result.statusAfterSecondaryDispose.secondary.state).toBe(
      "disconnected",
    );
    expect(result.sessionFailures.local.status).toBe(404);
    expect(result.sessionFailures.secondary.status).toBe(404);
  });
});
