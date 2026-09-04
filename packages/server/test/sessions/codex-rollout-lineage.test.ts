import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogger } from "../../src/logging/logger.js";
import {
  readCodexRolloutLineageEntries,
  resolveCodexRolloutLineage,
} from "../../src/sessions/codex-rollout-lineage.js";
import { CodexSessionReader } from "../../src/sessions/codex-reader.js";
import { normalizeSession } from "../../src/sessions/normalization.js";
import { isZstdJsonlSupported } from "../../src/utils/jsonl.js";

const ROOT_ID = "11111111-1111-7111-8111-111111111111";
const CHILD_ID = "22222222-2222-7222-8222-222222222222";
const NESTED_ID = "33333333-3333-7333-8333-333333333333";
const PROJECT_ID = "lineage-project" as UrlProjectId;
const PROJECT_PATH = "/test/lineage-project";

type PersistedEntry = Record<string, unknown> & {
  ordinal: number;
  type: string;
};

const zstdCompressSync = (
  zlib as typeof zlib & {
    zstdCompressSync?: (buffer: Buffer) => Buffer;
  }
).zstdCompressSync;
const itIfNativeZstd =
  typeof zstdCompressSync === "function" && isZstdJsonlSupported()
    ? it
    : it.skip;

function sessionMeta(options: {
  id: string;
  ordinal: number;
  forkedFromId?: string;
  historyBase?: {
    thread_id: string;
    end_ordinal_exclusive: number;
    end_byte_offset: number;
  };
}): PersistedEntry {
  return {
    timestamp: `2026-09-03T00:00:${String(options.ordinal).padStart(2, "0")}.000Z`,
    ordinal: options.ordinal,
    type: "session_meta",
    payload: {
      id: options.id,
      session_id: options.id,
      timestamp: "2026-09-03T00:00:00.000Z",
      cwd: PROJECT_PATH,
      originator: "yep-anywhere",
      cli_version: "0.152.1",
      model_provider: "openai",
      history_mode: "paginated",
      ...(options.forkedFromId ? { forked_from_id: options.forkedFromId } : {}),
      ...(options.historyBase ? { history_base: options.historyBase } : {}),
    },
  };
}

function userMessage(ordinal: number, message: string): PersistedEntry {
  return {
    timestamp: `2026-09-03T00:01:${String(ordinal).padStart(2, "0")}.000Z`,
    ordinal,
    type: "event_msg",
    payload: { type: "user_message", message },
  };
}

function assistantMessage(ordinal: number, text: string): PersistedEntry {
  return {
    timestamp: `2026-09-03T00:02:${String(ordinal).padStart(2, "0")}.000Z`,
    ordinal,
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  };
}

function jsonl(entries: PersistedEntry[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function prefixPosition(
  rolloutId: string,
  entries: PersistedEntry[],
): {
  thread_id: string;
  end_ordinal_exclusive: number;
  end_byte_offset: number;
} {
  const last = entries.at(-1);
  if (!last) throw new Error("A lineage prefix cannot be empty");
  return {
    thread_id: rolloutId,
    end_ordinal_exclusive: last.ordinal + 1,
    end_byte_offset: Buffer.byteLength(jsonl(entries), "utf8"),
  };
}

function rolloutPath(root: string, rolloutId: string, suffix = ".jsonl") {
  return join(root, `rollout-2026-09-03T00-00-00-${rolloutId}${suffix}`);
}

describe("Codex reference-backed rollout lineage", () => {
  let codexHome: string;
  let sessionsDir: string;

  beforeEach(async () => {
    codexHome = join(tmpdir(), `codex-lineage-${randomUUID()}`);
    sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(codexHome, { recursive: true, force: true });
  });

  it("lists and loads a native reference-backed clone at its frozen prefix", async () => {
    const rootPrefix = [
      sessionMeta({ id: ROOT_ID, ordinal: 0 }),
      userMessage(1, "Inherited root prompt"),
      assistantMessage(2, "Inherited root answer"),
    ];
    const rootPath = rolloutPath(sessionsDir, ROOT_ID);
    await writeFile(rootPath, jsonl(rootPrefix));

    const childPath = rolloutPath(sessionsDir, CHILD_ID);
    await writeFile(
      childPath,
      jsonl([
        sessionMeta({
          id: CHILD_ID,
          ordinal: 3,
          forkedFromId: ROOT_ID,
          historyBase: prefixPosition(ROOT_ID, rootPrefix),
        }),
      ]),
    );

    const reader = new CodexSessionReader({
      sessionsDir,
      projectPath: PROJECT_PATH,
    });
    const summaries = await reader.listSessions(PROJECT_ID);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: CHILD_ID,
          title: "Inherited root prompt",
          messageCount: 2,
          forkedFromSessionId: ROOT_ID,
        }),
      ]),
    );

    const loaded = await reader.getSession(CHILD_ID, PROJECT_ID);
    expect(loaded?.data.session.entries.map((entry) => entry.ordinal)).toEqual([
      3, 1, 2,
    ]);
    expect(
      loaded?.data.session.entries.filter(
        (entry) => entry.type === "session_meta",
      ),
    ).toHaveLength(1);
    expect(
      loaded
        ? normalizeSession(loaded).messages.map((message) => message.type)
        : [],
    ).toEqual(["user", "assistant"]);

    const compactFallback = await reader.getSession(
      CHILD_ID,
      PROJECT_ID,
      undefined,
      {
        tailCompactions: 2,
        summaryHint: loaded?.summary,
      },
    );
    expect(compactFallback?.readWindow).toBeUndefined();
    expect(compactFallback?.data.session.entries).toHaveLength(3);

    await appendFile(
      rootPath,
      jsonl([
        userMessage(3, "Later parent prompt must stay out"),
        assistantMessage(4, "Later parent answer must stay out"),
      ]),
    );
    const coldReader = new CodexSessionReader({
      sessionsDir,
      projectPath: PROJECT_PATH,
    });
    const coldLoaded = await coldReader.getSession(CHILD_ID, PROJECT_ID);
    expect(JSON.stringify(coldLoaded?.data.session.entries)).not.toContain(
      "Later parent prompt",
    );

    await appendFile(childPath, jsonl([userMessage(4, "Child-local prompt")]));
    const appended = await reader.getSession(CHILD_ID, PROJECT_ID);
    expect(
      appended?.data.session.entries.map((entry) => entry.ordinal),
    ).toEqual([3, 1, 2, 4]);
    expect(appended?.summary.messageCount).toBe(3);
  });

  it("retains an in-progress leaf record across incremental reads", async () => {
    const rootPrefix = [
      sessionMeta({ id: ROOT_ID, ordinal: 0 }),
      userMessage(1, "Inherited root prompt"),
      assistantMessage(2, "Inherited root answer"),
    ];
    await writeFile(rolloutPath(sessionsDir, ROOT_ID), jsonl(rootPrefix));

    const childPath = rolloutPath(sessionsDir, CHILD_ID);
    const meta = sessionMeta({
      id: CHILD_ID,
      ordinal: 3,
      historyBase: prefixPosition(ROOT_ID, rootPrefix),
    });
    const localLine = JSON.stringify(userMessage(4, "Completed local prompt"));
    const splitAt = Math.floor(localLine.length / 2);
    await writeFile(
      childPath,
      `${JSON.stringify(meta)}\n${localLine.slice(0, splitAt)}`,
    );

    const reader = new CodexSessionReader({
      sessionsDir,
      projectPath: PROJECT_PATH,
    });
    const summaryDuringAppend = await reader.getSessionSummary(
      CHILD_ID,
      PROJECT_ID,
    );
    expect(summaryDuringAppend?.messageCount).toBe(2);
    const duringAppend = await reader.getSession(CHILD_ID, PROJECT_ID);
    expect(duringAppend?.summary.messageCount).toBe(2);

    await appendFile(childPath, `${localLine.slice(splitAt)}\n`);
    const afterAppend = await reader.getSession(CHILD_ID, PROJECT_ID);
    expect(afterAppend?.summary.messageCount).toBe(3);
    expect(JSON.stringify(afterAppend?.data.session.entries)).toContain(
      "Completed local prompt",
    );
  });

  it("rejects a non-contiguous ordinal appended to a warm lineage cache", async () => {
    const rootPrefix = [
      sessionMeta({ id: ROOT_ID, ordinal: 0 }),
      userMessage(1, "Inherited root prompt"),
      assistantMessage(2, "Inherited root answer"),
    ];
    await writeFile(rolloutPath(sessionsDir, ROOT_ID), jsonl(rootPrefix));

    const childPath = rolloutPath(sessionsDir, CHILD_ID);
    await writeFile(
      childPath,
      jsonl([
        sessionMeta({
          id: CHILD_ID,
          ordinal: 3,
          historyBase: prefixPosition(ROOT_ID, rootPrefix),
        }),
        userMessage(4, "Valid child prompt"),
      ]),
    );

    const reader = new CodexSessionReader({ sessionsDir });
    await expect(
      reader.getSession(CHILD_ID, PROJECT_ID),
    ).resolves.not.toBeNull();

    await appendFile(childPath, jsonl([assistantMessage(99, "Invalid gap")]));
    const errorLog = vi
      .spyOn(getLogger(), "error")
      .mockImplementation(() => undefined);

    await expect(reader.getSession(CHILD_ID, PROJECT_ID)).rejects.toThrow(
      "non-contiguous leaf ordinal",
    );
    await expect(
      new CodexSessionReader({ sessionsDir }).getSession(CHILD_ID, PROJECT_ID),
    ).rejects.toThrow("non-contiguous leaf ordinal");
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("follows nested lineage through an archived ancestor", async () => {
    const archivedDir = join(codexHome, "archived_sessions");
    await mkdir(archivedDir, { recursive: true });
    const rootPrefix = [
      sessionMeta({ id: ROOT_ID, ordinal: 0 }),
      userMessage(1, "Archived root prompt"),
      assistantMessage(2, "Archived root answer"),
    ];
    await writeFile(rolloutPath(archivedDir, ROOT_ID), jsonl(rootPrefix));

    const childEntries = [
      sessionMeta({
        id: CHILD_ID,
        ordinal: 3,
        forkedFromId: ROOT_ID,
        historyBase: prefixPosition(ROOT_ID, rootPrefix),
      }),
      userMessage(4, "Intermediate prompt"),
      assistantMessage(5, "Intermediate answer"),
    ];
    await writeFile(rolloutPath(sessionsDir, CHILD_ID), jsonl(childEntries));
    await writeFile(
      rolloutPath(sessionsDir, NESTED_ID),
      jsonl([
        sessionMeta({
          id: NESTED_ID,
          ordinal: 6,
          forkedFromId: CHILD_ID,
          historyBase: prefixPosition(CHILD_ID, childEntries),
        }),
      ]),
    );

    const reader = new CodexSessionReader({
      sessionsDir,
      projectPath: PROJECT_PATH,
    });
    const loaded = await reader.getSession(NESTED_ID, PROJECT_ID);
    expect(loaded?.summary).toMatchObject({
      title: "Archived root prompt",
      messageCount: 4,
      forkedFromSessionId: CHILD_ID,
    });
    expect(loaded?.data.session.entries.map((entry) => entry.ordinal)).toEqual([
      6, 1, 2, 4, 5,
    ]);
  });

  it("fails closed for missing, cyclic, and mismatched lineage", async () => {
    const missingId = "44444444-4444-7444-8444-444444444444";
    const childPath = rolloutPath(sessionsDir, CHILD_ID);
    await writeFile(
      childPath,
      jsonl([
        sessionMeta({
          id: CHILD_ID,
          ordinal: 3,
          historyBase: {
            thread_id: missingId,
            end_ordinal_exclusive: 3,
            end_byte_offset: 100,
          },
        }),
      ]),
    );
    await expect(
      resolveCodexRolloutLineage({
        requestedSessionId: CHILD_ID,
        leafFilePath: childPath,
        resolveRolloutPath: async () => null,
      }),
    ).rejects.toThrow(`missing source rollout ${missingId}`);

    const rootEntries = [
      sessionMeta({ id: ROOT_ID, ordinal: 0 }),
      userMessage(1, "Root"),
      assistantMessage(2, "Answer"),
    ];
    const rootPath = rolloutPath(sessionsDir, ROOT_ID);
    await writeFile(
      rootPath,
      jsonl([sessionMeta({ id: NESTED_ID, ordinal: 0 })]),
    );
    await writeFile(
      childPath,
      jsonl([
        sessionMeta({
          id: CHILD_ID,
          ordinal: 3,
          historyBase: prefixPosition(ROOT_ID, rootEntries),
        }),
      ]),
    );
    await expect(
      resolveCodexRolloutLineage({
        requestedSessionId: CHILD_ID,
        leafFilePath: childPath,
        resolveRolloutPath: async () => rootPath,
      }),
    ).rejects.toThrow(`rollout ${ROOT_ID} metadata belongs to ${NESTED_ID}`);

    await writeFile(rootPath, jsonl(rootEntries));
    await writeFile(
      childPath,
      jsonl([
        sessionMeta({
          id: CHILD_ID,
          ordinal: 4,
          historyBase: {
            ...prefixPosition(ROOT_ID, rootEntries),
            end_ordinal_exclusive: 4,
          },
        }),
      ]),
    );
    const mismatched = await resolveCodexRolloutLineage({
      requestedSessionId: CHILD_ID,
      leafFilePath: childPath,
      resolveRolloutPath: async (rolloutId) =>
        rolloutId === ROOT_ID ? rootPath : null,
    });
    await expect(readCodexRolloutLineageEntries(mismatched)).rejects.toThrow(
      "cutoff ordinal does not match",
    );

    const rootCycleMeta = sessionMeta({
      id: ROOT_ID,
      ordinal: 0,
      historyBase: {
        thread_id: CHILD_ID,
        end_ordinal_exclusive: 1,
        end_byte_offset: 1,
      },
    });
    await writeFile(rootPath, jsonl([rootCycleMeta]));
    const childCycleMeta = sessionMeta({
      id: CHILD_ID,
      ordinal: 1,
      historyBase: prefixPosition(ROOT_ID, [rootCycleMeta]),
    });
    await writeFile(childPath, jsonl([childCycleMeta]));
    await expect(
      resolveCodexRolloutLineage({
        requestedSessionId: CHILD_ID,
        leafFilePath: childPath,
        resolveRolloutPath: async (rolloutId) =>
          rolloutId === ROOT_ID
            ? rootPath
            : rolloutId === CHILD_ID
              ? childPath
              : null,
      }),
    ).rejects.toThrow("cycle detected");
  });

  itIfNativeZstd("reads a compressed lineage ancestor", async () => {
    if (!zstdCompressSync) throw new Error("zstd compression is unavailable");
    const rootPrefix = [
      sessionMeta({ id: ROOT_ID, ordinal: 0 }),
      userMessage(1, "Compressed root prompt"),
      assistantMessage(2, "Compressed root answer"),
    ];
    await writeFile(
      rolloutPath(sessionsDir, ROOT_ID, ".jsonl.zst"),
      zstdCompressSync(Buffer.from(jsonl(rootPrefix), "utf8")),
    );
    await writeFile(
      rolloutPath(sessionsDir, CHILD_ID),
      jsonl([
        sessionMeta({
          id: CHILD_ID,
          ordinal: 3,
          forkedFromId: ROOT_ID,
          historyBase: prefixPosition(ROOT_ID, rootPrefix),
        }),
      ]),
    );

    const reader = new CodexSessionReader({ sessionsDir });
    const loaded = await reader.getSession(CHILD_ID, PROJECT_ID);
    expect(loaded?.summary.title).toBe("Compressed root prompt");
    expect(loaded?.summary.messageCount).toBe(2);
  });
});
