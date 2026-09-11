import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";
import { IssueStore } from "../../src/services/issues/IssueStore.js";
import {
  IssueIndexer,
  DEFAULT_ISSUE_SETTINGS,
} from "../../src/services/issues/IssueIndexer.js";
import { createIssueRoutes } from "../../src/routes/issues.js";
import { getServerCapabilities } from "../../src/routes/version.js";

it("gates all data routes, validates settings, saves through the shared settings service, and resolves Jira references", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-issue-routes-"));
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  const db = new DiscoverySqliteService({ dataDir, mode: "auto" });
  const store = new IssueStore(
    db.getDatabase()!,
    () => settings.getSetting("issueAssociations") ?? DEFAULT_ISSUE_SETTINGS,
  );
  const indexer = new IssueIndexer(store, {
    settings: () =>
      settings.getSetting("issueAssociations") ?? DEFAULT_ISSUE_SETTINGS,
    candidates: async function* () {},
    read: async () => null,
  });
  const unsub = settings.onSettingsChanged(() => indexer.configure());
  const app = createIssueRoutes(indexer, settings, async (p, s) => ({
    available: p === "p" && s === "s",
    title: "Source conversation",
  }));
  const request = (path: string, method = "GET", body?: unknown) =>
    app.request(`/issues${path.replace(/^\/(?=\?|$)/, "")}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    expect((await request("/")).status).toBe(403);
    expect((await request("/evidence?id=anything")).status).toBe(403);
    expect((await request("/settings")).status).toBe(200);
    expect(
      (
        await request("/settings", "PUT", {
          enabled: true,
          scope: "recent",
          recentDays: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/settings", "PUT", {
          enabled: true,
          scope: "viewed",
          recentDays: 7,
          aggressiveMatching: true,
        })
      ).status,
    ).toBe(200);
    indexer.observe({ sessionId: "s", projectId: "p" }, [
      { type: "user", uuid: "m", content: "ABC-123" },
    ]);
    await indexer.settled();
    const found = await (await request("/?q=ABC-123")).json();
    expect(found.items[0].unresolved).toBe(true);
    // Resolution must continue beyond one SQL batch without another session view.
    for (let i = 0; i < 55; i++)
      store.capture(
        { sessionId: "s", projectId: "p" },
        { id: `extra-${i}`, text: "ABC-123" },
      );
    expect(
      (
        await request("/resolve", "POST", {
          url: "https://jira.test/browse/ABC-123",
          projectId: "p",
          sessionId: "wrong",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request("/resolve", "POST", {
          url: "https://jira.test/browse/ABC-123",
          projectId: "p",
          sessionId: "s",
        })
      ).status,
    ).toBe(200);
    await indexer.settled();
    const resolved = await (await request("/?q=ABC-123")).json();
    expect(resolved.items).toHaveLength(1);
    expect(
      store.rows("SELECT 1 FROM session_issue_evidence WHERE link_id IS NULL"),
    ).toHaveLength(0);
    expect(resolved.items[0].unresolved).toBe(false);
    const proof = await (
      await request(
        `/evidence?id=${encodeURIComponent(resolved.items[0].id)}&limit=100`,
      )
    ).json();
    expect(
      proof.evidence.every(
        (entry: { sourceAvailable: boolean }) => entry.sourceAvailable,
      ),
    ).toBe(true);
    store.capture(
      { sessionId: "missing", projectId: "p" },
      { id: "historic", text: "https://jira.test/browse/ABC-123" },
    );
    const retained = await (
      await request(
        `/evidence?id=${encodeURIComponent(resolved.items[0].id)}&limit=100`,
      )
    ).json();
    expect(
      retained.evidence.find(
        (entry: { sessionId: string }) => entry.sessionId === "missing",
      ).sourceAvailable,
    ).toBe(false);
    store.decide(resolved.items[0].id, "missing", "dismissed");
    expect((await request("/?limit=101")).status).toBe(400);
    expect(
      (
        await request("/decision", "POST", {
          id: resolved.items[0].id,
          sessionId: "s",
          state: "dismissed",
        })
      ).status,
    ).toBe(200);
    expect((await (await request("/")).json()).items).toHaveLength(0);
    expect((await (await request("/?dismissed=1")).json()).items).toHaveLength(
      1,
    );
    const second = new ServerSettingsService({ dataDir });
    await second.initialize();
    expect(second.getSetting("issueAssociations")?.enabled).toBe(true);
  } finally {
    unsub();
    await indexer.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
it("advertises only when SQLite and the implementation are both available", () => {
  const capability = "issue-session-associations-v1";
  expect(
    getServerCapabilities({ getSqliteStatus: () => ({ state: "ready" }) }),
  ).not.toContain(capability);
  expect(
    getServerCapabilities({
      getSqliteStatus: () => ({ state: "ready" }),
      getIssueAssociationsAvailable: () => true,
    }),
  ).toContain(capability);
  expect(
    getServerCapabilities({
      getSqliteStatus: () => ({ state: "error" }),
      getIssueAssociationsAvailable: () => true,
    }),
  ).not.toContain(capability);
});

it("paginates distinct sessions by catalog activity before loading their first mention", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-issue-sessions-"));
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  await settings.updateSettings({
    issueAssociations: { enabled: true, scope: "viewed", recentDays: 7 },
  });
  const db = new DiscoverySqliteService({ dataDir, mode: "auto" });
  const store = new IssueStore(db.getDatabase()!);
  const indexer = new IssueIndexer(store, {
    settings: () => settings.getSetting("issueAssociations")!,
    candidates: async function* () {},
    read: async () => null,
  });
  const catalog = [
    { sessionId: "old", updatedAt: "2026-09-01T00:00:00Z" },
    { sessionId: "recent", updatedAt: "2026-09-11T00:00:00Z" },
  ];
  const app = createIssueRoutes(
    indexer,
    settings,
    async (_, id) => ({ available: true, title: id }),
    undefined,
    undefined,
    async () => catalog,
  );
  try {
    for (const sessionId of ["recent", "old", "missing-time"])
      for (let i = 0; i < 55; i++)
        store.capture(
          { projectId: "p", sessionId },
          {
            id: `m${i}`,
            text: `Mention ${i}: https://github.com/a/b/issues/1`,
            timestamp: `2026-09-01T00:${String(i).padStart(2, "0")}:00Z`,
          },
        );
    const id = store.list()[0]!.id;
    const read = async (suffix = "") =>
      (
        await app.request(
          `/issues/sessions?id=${encodeURIComponent(id)}&limit=1${suffix}`,
        )
      ).json();
    const first = await read();
    expect(
      first.sessions.map((s: { sessionId: string }) => s.sessionId),
    ).toEqual(["recent"]);
    expect(first.sessions[0].evidenceCount).toBe(55);
    expect(first.sessions[0].evidence).toHaveLength(1);
    expect(first.sessions[0].evidence[0].excerpt).toContain("Mention 0:");
    expect(first.nextOffset).toBe(1);
    expect((await read("&offset=1")).sessions[0].sessionId).toBe("old");
    expect((await read("&offset=2")).sessions[0].sessionId).toBe(
      "missing-time",
    );
    expect((await read("&sort=oldest")).sessions[0].sessionId).toBe("old");
    const mentions = await (
      await app.request(
        `/issues/evidence?id=${encodeURIComponent(id)}&sessionId=recent&offset=1`,
      )
    ).json();
    expect(mentions.evidence).toHaveLength(50);
    expect(
      mentions.evidence.every(
        (e: { sessionId: string }) => e.sessionId === "recent",
      ),
    ).toBe(true);
    store.decide(id, "recent", "dismissed");
    expect((await read()).sessions[0].sessionId).toBe("old");
    expect((await read("&dismissed=1")).sessions[0].sessionId).toBe("recent");
  } finally {
    await indexer.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

it("sorts issues across pages by session activity, source mention time, and namespace/number", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-issue-sort-"));
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  await settings.updateSettings({
    issueAssociations: {
      enabled: true,
      scope: "viewed",
      recentDays: 7,
      aggressiveMatching: true,
    },
  });
  const db = new DiscoverySqliteService({ dataDir, mode: "auto" });
  const store = new IssueStore(
    db.getDatabase()!,
    () => settings.getSetting("issueAssociations")!,
  );
  const indexer = new IssueIndexer(store, {
    settings: () => settings.getSetting("issueAssociations")!,
    candidates: async function* () {},
    read: async () => null,
  });
  const catalog = [
    { sessionId: "active", updatedAt: "2026-09-11T10:00:00Z" },
    { sessionId: "older", updatedAt: "2026-09-10T10:00:00Z" },
    { sessionId: "invalid", updatedAt: "not-a-date" },
  ];
  let sourceReads = 0;
  const app = createIssueRoutes(
    indexer,
    settings,
    async () => {
      sourceReads++;
      return { available: true };
    },
    undefined,
    undefined,
    async () => catalog,
  );
  const capture = (
    key: string,
    sessionId: string,
    timestamp?: string,
    projectId = "p",
  ) =>
    store.capture(
      { projectId, sessionId },
      { id: `${key}-${sessionId}-${timestamp}`, text: key, timestamp },
    );
  const read = async (query: string) =>
    (await app.request(`/issues?${query}`)).json();
  try {
    // Discover the old mention last: discovery time must never replace source time.
    capture("https://jira.test/browse/TF-10", "older", "2026-09-11T09:00:00Z");
    capture("https://jira.test/browse/TF-9", "active", "2026-09-01T10:00:00Z");
    capture("https://jira.test/browse/TF-100", "missing");
    capture("https://jira.test/browse/TF-101", "invalid", "invalid");
    const first = await read("sort=activity&limit=1");
    expect(first.supportedSorts).toEqual(["activity", "mentioned", "number"]);
    expect(first.sort).toBe("activity");
    expect(first.items[0]).toMatchObject({
      key: "TF-9",
      lastSessionActivityAt: "2026-09-11T10:00:00.000Z",
      lastMentionAt: "2026-09-01T10:00:00.000Z",
    });
    expect(first.nextOffset).toBe(1);
    expect((await read("sort=activity&limit=1&offset=1")).items[0].key).toBe(
      "TF-10",
    );
    expect(
      (await read("sort=activity&offset=2")).items.map(
        (x: { key: string }) => x.key,
      ),
    ).toEqual(["TF-100", "TF-101"]);
    expect((await read("sort=mentioned&limit=1")).items[0].key).toBe("TF-10");
    expect(
      (await read("sort=number")).items.map((x: { key: string }) => x.key),
    ).toEqual(["TF-9", "TF-10", "TF-100", "TF-101"]);
    // Omitted sort retains the old experimental wire order.
    expect((await read("")).items[0].key).toBe("TF-10");
    capture(
      "https://jira.test/browse/TF-10",
      "active",
      "2026-09-12T10:00:00+02:00",
      "other",
    );
    const ten = (await read("q=TF-10&sort=activity")).items.find(
      (x: { key: string }) => x.key === "TF-10",
    );
    expect(ten.sessionCount).toBe(2);
    expect(ten.lastMentionAt).toBe("2026-09-12T08:00:00.000Z");
    expect((await read("sort=activity&projectId=p&limit=1")).items[0].key).toBe(
      "TF-9",
    );
    expect((await read("sort=mentioned&sessionId=older")).items).toHaveLength(
      1,
    );
    store.decide(ten.id, "active", "dismissed");
    expect(
      (await read("q=TF-10&sort=activity")).items[0].lastSessionActivityAt,
    ).toBe("2026-09-10T10:00:00.000Z");
    expect(
      (await read("q=TF-10&sort=activity&dismissed=1")).items[0]
        .lastSessionActivityAt,
    ).toBe("2026-09-11T10:00:00.000Z");
    // Retained catalog changes affect ordering without another capture.
    catalog[1]!.updatedAt = "2026-09-13T00:00:00Z";
    expect((await read("sort=activity&limit=1")).items[0].key).toBe("TF-10");
    capture("UNKNOWN-7", "older", "2026-09-14T00:00:00Z");
    expect((await read("sort=mentioned&limit=1")).items[0]).toMatchObject({
      key: "UNKNOWN-7",
      unresolved: true,
    });
    for (const repo of ["a/b", "a/c"])
      for (const n of [100, 10, 9])
        capture(`https://github.com/${repo}/pull/${n}`, "older");
    expect(
      (await read("sort=number&q=github.com")).items.map(
        (x: { key: string }) => x.key,
      ),
    ).toEqual(["a/b#9", "a/b#10", "a/b#100", "a/c#9", "a/c#10", "a/c#100"]);
    expect((await app.request("/issues?sort=garbage")).status).toBe(400);
    expect(sourceReads).toBe(0);
  } finally {
    await indexer.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
