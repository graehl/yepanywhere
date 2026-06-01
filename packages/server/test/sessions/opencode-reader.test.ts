import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSession } from "../../src/sessions/normalization.js";

const projectId = "test-project" as UrlProjectId;

describe("OpenCodeSessionReader", () => {
  let testDir: string;
  let projectPath: string;
  let databasePath: string;
  let execFileMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `opencode-reader-test-${randomUUID()}`);
    projectPath = join(testDir, "project");
    databasePath = join(testDir, "opencode.db");
    await mkdir(projectPath, { recursive: true });
    await writeFile(databasePath, "sqlite placeholder");

    execFileMock = vi.fn(
      (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        if (args[0] === "export") {
          callback(
            null,
            `Exporting session: ${args[1]}\n${JSON.stringify(
              makeExport(args[1] ?? "ses_cli", projectPath),
            )}`,
            "",
          );
          return {} as ChildProcess;
        }
        if (args.join(" ") === "session list --format json --max-count 200") {
          callback(
            null,
            JSON.stringify([
              {
                id: "ses_cli",
                title: "Yep Anywhere Session",
                directory: projectPath,
                created: 1000,
                updated: 4000,
              },
            ]),
            "",
          );
          return {} as ChildProcess;
        }
        callback(new Error(`unexpected opencode args: ${args.join(" ")}`));
        return {} as ChildProcess;
      },
    );

    vi.doMock("node:child_process", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        execFile: execFileMock,
      };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads OpenCode 1.15 CLI exports when file storage is absent", async () => {
    const { OpenCodeSessionReader } = await import(
      "../../src/sessions/opencode-reader.js"
    );
    const reader = new OpenCodeSessionReader({
      storageDir: join(testDir, "missing-storage"),
      databasePath,
      opencodePath: "/fake/opencode",
      projectPath,
    });

    const loaded = await reader.getSession("ses_cli", projectId);
    expect(loaded?.summary).toMatchObject({
      id: "ses_cli",
      provider: "opencode",
      model: "Qwen/Qwen3.6-27B",
      fullTitle: "present?",
      messageCount: 2,
    });

    const normalized = normalizeSession(loaded!);
    expect(normalized.messages).toHaveLength(2);
    expect(normalized.messages[0]).toMatchObject({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "present?" }] },
    });
    expect(normalized.messages[1]).toMatchObject({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Present." }],
      },
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "/fake/opencode",
      ["export", "ses_cli"],
      expect.objectContaining({ cwd: projectPath, timeout: 10_000 }),
      expect.any(Function),
    );
  });

  it("enumerates CLI sessions with the OpenCode database as index anchor", async () => {
    const { OpenCodeSessionReader } = await import(
      "../../src/sessions/opencode-reader.js"
    );
    const reader = new OpenCodeSessionReader({
      storageDir: join(testDir, "missing-storage"),
      databasePath,
      opencodePath: "/fake/opencode",
      projectPath,
    });

    await expect(reader.listSessionFiles("/unused")).resolves.toEqual([
      { sessionId: "ses_cli", filePath: databasePath },
    ]);
  });

  it("does not load an exported session from a different project", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        callback(
          null,
          JSON.stringify(makeExport(args[1] ?? "ses_cli", join(testDir, "other"))),
          "",
        );
        return {} as ChildProcess;
      },
    );

    const { OpenCodeSessionReader } = await import(
      "../../src/sessions/opencode-reader.js"
    );
    const reader = new OpenCodeSessionReader({
      storageDir: join(testDir, "missing-storage"),
      databasePath,
      opencodePath: "/fake/opencode",
      projectPath,
    });

    await expect(reader.getSession("ses_cli", projectId)).resolves.toBeNull();
  });
});

function makeExport(sessionId: string, directory: string) {
  return {
    info: {
      id: sessionId,
      directory,
      title: "Yep Anywhere Session",
      model: {
        id: "Qwen/Qwen3.6-27B",
        providerID: "local-glm",
        variant: "default",
      },
      time: {
        created: 1000,
        updated: 4000,
      },
    },
    messages: [
      {
        info: {
          id: "msg_user",
          sessionID: sessionId,
          role: "user",
          time: { created: 1000 },
        },
        parts: [
          {
            id: "part_user",
            sessionID: sessionId,
            messageID: "msg_user",
            type: "text",
            text: "present?",
          },
        ],
      },
      {
        info: {
          id: "msg_assistant",
          sessionID: sessionId,
          role: "assistant",
          modelID: "Qwen/Qwen3.6-27B",
          time: { created: 2000, completed: 4000 },
          tokens: {
            input: 128,
            output: 12,
            cache: { read: 32 },
          },
        },
        parts: [
          {
            id: "part_assistant",
            sessionID: sessionId,
            messageID: "msg_assistant",
            type: "text",
            text: "Present.",
          },
        ],
      },
    ],
  };
}
