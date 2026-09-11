import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";
import { IssueStore } from "../../src/services/issues/IssueStore.js";
import {
  IssueIndexer,
  type IssueSettings,
} from "../../src/services/issues/IssueIndexer.js";
import { readIssueTextBatch } from "../../src/sessions/issue-text-reader.js";
import type { SessionCatalogRow } from "../../src/sessions/catalog-types.js";
import type { SqliteDatabase } from "../../src/storage/sqlite.js";
const dirs: string[] = [];
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "ya-issue-index-"));
  dirs.push(dir);
  return dir;
}
const claude = (id: string, text: string) =>
  `${JSON.stringify({
    type: "user",
    uuid: id,
    timestamp: "2026-09-10T10:00:00Z",
    message: { role: "user", content: text },
  })}\n`;

it("reads bounded batches, retains repeat IDs, continues automatically and handles oversized records", async () => {
  const file = join(directory(), "s.jsonl");
  writeFileSync(
    file,
    Array.from({ length: 2005 }, (_, i) =>
      claude(String(i), `ABC-${i + 1}`),
    ).join("") +
      claude("large", "x".repeat(2 * 1024 * 1024)) +
      claude("after", "END-42"),
  );
  const signal = new AbortController().signal;
  const first = await readIssueTextBatch("claude", [{ path: file }], {
    signal,
  });
  expect(first.done).toBe(false);
  expect(first.messages).toHaveLength(2000);
  expect(first.bytesRead).toBeLessThanOrEqual(8 * 1024 * 1024);
  const second = await readIssueTextBatch("claude", [{ path: file }], {
    signal,
    cursor: first.cursor,
  });
  expect(second.done).toBe(true);
  expect(second.partial).toBe(true);
  expect(second.messages.at(-1)?.text).toBe("END-42");
});
it("resumes appends, detects rewritten boundaries and stops on incomplete source without spinning", async () => {
  const file = join(directory(), "s.jsonl");
  writeFileSync(file, claude("one", "ABC-1"));
  const signal = new AbortController().signal;
  const one = await readIssueTextBatch("claude", [{ path: file }], { signal });
  appendFileSync(file, claude("two", "ABC-2"));
  const two = await readIssueTextBatch("claude", [{ path: file }], {
    signal,
    cursor: one.cursor,
  });
  expect(two.messages.map((m) => m.id)).toEqual(["two"]);
  writeFileSync(file, claude("new", "XYZ-3"));
  const rewrite = await readIssueTextBatch("claude", [{ path: file }], {
    signal,
    cursor: two.cursor,
  });
  expect(rewrite.messages[0]?.text).toBe("XYZ-3");
  appendFileSync(file, '{"type":');
  const partial = await readIssueTextBatch("claude", [{ path: file }], {
    signal,
    cursor: rewrite.cursor,
  });
  expect(partial.done).toBe(true);
  expect(partial.partial).toBe(true);
});
it("indexes Codex visible user/assistant text with stable source identity and excludes tools/context", async () => {
  const file = join(directory(), "s.jsonl");
  const timestamp = "2026-09-10T10:00:00Z";
  writeFileSync(
    file,
    [
      {
        type: "response_item",
        timestamp,
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "SECRET-1" }],
        },
      },
      {
        type: "response_item",
        timestamp,
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "ABC-123" }],
        },
      },
      {
        type: "event_msg",
        timestamp,
        payload: {
          type: "user_message",
          message: "ABC-123",
          client_id: "human-1",
        },
      },
      {
        type: "response_item",
        timestamp,
        payload: {
          type: "message",
          role: "assistant",
          id: "reply-1",
          content: [
            { type: "output_text", text: "https://github.com/a/b/pull/4" },
          ],
        },
      },
      {
        type: "response_item",
        timestamp,
        payload: {
          type: "function_call_output",
          call_id: "tool",
          output: "SECRET-2",
        },
      },
    ]
      .map((x) => `${JSON.stringify(x)}\n`)
      .join(""),
  );
  const batch = await readIssueTextBatch("codex", [{ path: file }], {
    signal: new AbortController().signal,
  });
  expect(batch.messages.map((m) => m.id)).toEqual(["human-1", "reply-1"]);
  expect(
    batch.messages.every((m) => m.sourceId?.startsWith("codex-byte-")),
  ).toBe(true);
});
it("automatically drains a durable recent queue larger than its in-memory batch and preserves state on restart", async () => {
  const dir = directory();
  const service = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
  const store = new IssueStore(service.getDatabase()!, () => ({
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
  }));
  let settings: IssueSettings = {
    enabled: true,
    scope: "recent",
    recentDays: 7,
  };
  const rows = Array.from(
    { length: 20 },
    (_, i) =>
      ({
        sessionId: `s${i}`,
        projectId: "p",
        sourceVersion: "one",
        updatedAt: new Date().toISOString(),
        location: { kind: "file", path: "unused" },
      }) as SessionCatalogRow,
  );
  const read: string[] = [];
  const indexer = new IssueIndexer(store, {
    settings: () => settings,
    candidates: async function* () {
      yield* rows;
      yield {
        ...rows[0]!,
        sessionId: "old",
        updatedAt: "2000-01-01T00:00:00Z",
      };
    },
    read: async (row) => {
      read.push(row.sessionId);
      return {
        messages: [{ id: "m", text: "ABC-123" }],
        cursor: "end",
        done: true,
        partial: false,
        bytesRead: 20,
      };
    },
  });
  cleanup.push(async () => {
    await indexer.close();
    service.close();
  });
  indexer.refresh();
  await indexer.settled();
  expect(read).toHaveLength(20);
  expect(store.list()[0]?.sessionCount).toBe(20);
  indexer.refresh();
  await indexer.settled();
  expect(read).toHaveLength(20);
  settings = { ...settings, enabled: false };
  indexer.configure();
  indexer.observe({ sessionId: "disabled", projectId: "p" }, [
    { type: "user", uuid: "m", content: "NOPE-9" },
  ]);
  await indexer.settled();
  expect(store.list("NOPE")).toEqual([]);
});
it("automatic viewed windows need no registered issues and disable fences delayed writes", async () => {
  const service = new DiscoverySqliteService({
    dataDir: directory(),
    mode: "auto",
  });
  const store = new IssueStore(service.getDatabase()!, () => ({
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
  }));
  let settings: IssueSettings = {
    enabled: true,
    scope: "viewed",
    recentDays: 7,
  };
  const indexer = new IssueIndexer(store, {
    settings: () => settings,
    candidates: async function* () {},
    read: async () => null,
  });
  cleanup.push(async () => {
    await indexer.close();
    service.close();
  });
  indexer.observe({ sessionId: "one", projectId: "p" }, [
    { type: "user", uuid: "m", message: { content: "ABC-123" } },
  ]);
  await indexer.settled();
  expect(store.list()[0]?.key).toBe("ABC-123");
  indexer.observe({ sessionId: "two", projectId: "p" }, [
    { type: "user", uuid: "m", message: { content: "SECRET-123" } },
  ]);
  settings = { ...settings, enabled: false };
  indexer.configure();
  await indexer.settled();
  expect(store.list("SECRET")).toEqual([]);
});

it("keeps a Codex paired user response intact across the batch boundary", async () => {
  const file = join(directory(), "boundary.jsonl");
  const timestamp = "2026-09-10T10:00:00Z";
  const prefix = Array.from(
    { length: 1999 },
    () =>
      `${JSON.stringify({
        type: "event_msg",
        timestamp,
        payload: { type: "token_count", info: null },
      })}\n`,
  ).join("");
  writeFileSync(
    file,
    prefix +
      [
        {
          type: "response_item",
          timestamp,
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "ABC-123" }],
          },
        },
        {
          type: "event_msg",
          timestamp,
          payload: {
            type: "user_message",
            message: "ABC-123",
            client_id: "user-at-boundary",
          },
        },
      ]
        .map((x) => `${JSON.stringify(x)}\n`)
        .join(""),
  );
  const signal = new AbortController().signal;
  const first = await readIssueTextBatch("codex", [{ path: file }], { signal });
  expect(first.messages).toHaveLength(0);
  const second = await readIssueTextBatch("codex", [{ path: file }], {
    signal,
    cursor: first.cursor,
  });
  expect(second.messages.map((x) => x.id)).toEqual(["user-at-boundary"]);
});

it("retains ordinal identity across frozen Codex lineage segments", async () => {
  const dir = directory();
  const a = join(dir, "a.jsonl"),
    b = join(dir, "b.jsonl");
  const entry = (ordinal: number, text: string) =>
    `${JSON.stringify({
      type: "response_item",
      ordinal,
      timestamp: "2026-09-10T10:00:00Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    })}\n`;
  const prefix = entry(1, "ABC-123");
  writeFileSync(a, prefix + entry(2, "EXCLUDED-1"));
  writeFileSync(b, entry(3, "ABC-456"));
  const batch = await readIssueTextBatch(
    "codex",
    [
      { path: a, end: Buffer.byteLength(prefix), ordinal: true },
      { path: b, ordinal: true },
    ],
    { signal: new AbortController().signal },
  );
  expect(batch.messages.map((x) => x.sourceId)).toEqual([
    "codex-ordinal-1",
    "codex-ordinal-3",
  ]);
  expect(batch.messages.map((x) => x.text)).toEqual(["ABC-123", "ABC-456"]);
});

it("deletion fences an in-flight batch without losing other references in the same session", async () => {
  const service = new DiscoverySqliteService({
    dataDir: directory(),
    mode: "auto",
  });
  const store = new IssueStore(service.getDatabase()!, () => ({
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
  }));
  const source = { sessionId: "s", projectId: "p", sourceVersion: "v1" };
  store.capture(source, { id: "m", text: "https://github.com/a/b/pull/42" });
  const id = store.list()[0]!.id;
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const row = {
    ...source,
    updatedAt: new Date().toISOString(),
    location: { kind: "file", path: "unused" },
  } as SessionCatalogRow;
  const indexer = new IssueIndexer(store, {
    settings: () => ({ enabled: true, scope: "recent", recentDays: 7 }),
    candidates: async function* () {
      yield row;
    },
    read: async () => {
      if (++calls === 1) {
        started();
        await waiting;
      }
      return {
        messages: [
          { id: "m", text: "https://github.com/a/b/pull/42 OTHER-123" },
        ],
        cursor: "end",
        done: true,
        partial: false,
        bytesRead: 50,
      };
    },
  });
  cleanup.push(async () => {
    release();
    await indexer.close();
    service.close();
  });
  indexer.refresh();
  await reading;
  indexer.delete(id);
  release();
  await indexer.settled();
  expect(store.list("a/b#42")).toEqual([]);
  expect(store.list("OTHER-123")).toHaveLength(1);
  store.capture(
    { ...source, sourceVersion: "v2" },
    { id: "later", text: "https://github.com/a/b/pull/42" },
  );
  expect(store.list("a/b#42")).toHaveLength(1);
});
it("sweeps a catalog for moved projects without a write transaction per session", async () => {
  const dir = directory();
  const service = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
  const database = service.getDatabase()!;
  let transactions = 0;
  // SQLite takes a file lock per transaction, and on a network data directory
  // each lock is a round trip on the event loop, so the count itself is the
  // contract: a sweep costs transactions only for sessions that really moved.
  const counted: SqliteDatabase = {
    ...database,
    transaction<T>(operation: () => T): T {
      transactions += 1;
      return database.transaction(operation);
    },
  };
  const store = new IssueStore(counted, () => ({
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
  }));
  while (store.processResolutions()) {
    /* Finish one-time schema backfill before measuring idle sweeps. */
  }
  transactions = 0;
  let project = "p";
  const rows = Array.from(
    { length: 200 },
    (_, i) =>
      ({
        sessionId: `s${i}`,
        projectId: project,
        sourceVersion: "one",
        updatedAt: new Date().toISOString(),
        location: { kind: "file", path: "unused" },
      }) as SessionCatalogRow,
  );
  const indexer = new IssueIndexer(store, {
    settings: () => ({ enabled: true, scope: "viewed", recentDays: 7 }),
    candidates: async function* () {
      yield* rows.map(
        (row) => ({ ...row, projectId: project }) as SessionCatalogRow,
      );
    },
    read: async () => null,
  });
  cleanup.push(async () => {
    await indexer.close();
    service.close();
  });

  indexer.refresh();
  await indexer.settled();
  expect(transactions).toBe(0);

  // One session gains evidence, so it is the only one a later sweep can move.
  store.capture(
    { sessionId: "s7", projectId: "p", sourceVersion: "one" },
    { id: "m", text: "ABC-123" },
  );
  transactions = 0;
  project = "moved";
  indexer.refresh();
  await indexer.settled();
  expect(transactions).toBe(1);
  expect(store.evidence(store.list()[0]!.id)[0]?.projectId).toBe("moved");

  transactions = 0;
  indexer.refresh();
  await indexer.settled();
  expect(transactions).toBe(1);
});
it("skips a republished catalog that has not changed, and still sweeps on demand", async () => {
  const dir = directory();
  const service = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
  const store = new IssueStore(service.getDatabase()!, () => ({
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
  }));
  let enumerations = 0;
  const rows = Array.from(
    { length: 5 },
    (_, i) =>
      ({
        sessionId: `s${i}`,
        projectId: "p",
        sourceVersion: "one",
        updatedAt: new Date().toISOString(),
        location: { kind: "file", path: "unused" },
      }) as SessionCatalogRow,
  );
  const indexer = new IssueIndexer(store, {
    settings: () => ({ enabled: true, scope: "viewed", recentDays: 7 }),
    candidates: async function* () {
      enumerations++;
      yield* rows;
    },
    read: async () => null,
  });
  cleanup.push(async () => {
    await indexer.close();
    service.close();
  });

  const mark = { catalogEpoch: "e1", catalogGeneration: 7 };
  indexer.refresh(mark);
  await indexer.settled();
  expect(enumerations).toBe(1);

  // The catalog republishes every few seconds; an unchanged generation must
  // cost nothing at all, not merely less than it used to.
  for (let repeat = 0; repeat < 5; repeat++) indexer.refresh(mark);
  await indexer.settled();
  expect(enumerations).toBe(1);

  indexer.refresh({ catalogEpoch: "e1", catalogGeneration: 8 });
  await indexer.settled();
  expect(enumerations).toBe(2);

  // A rebuilt catalog reuses generation numbers, so the epoch has to count.
  indexer.refresh({ catalogEpoch: "e2", catalogGeneration: 8 });
  await indexer.settled();
  expect(enumerations).toBe(3);

  // A caller with its own reason always runs, whatever the catalog says.
  indexer.refresh();
  await indexer.settled();
  expect(enumerations).toBe(4);
});
