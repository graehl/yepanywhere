import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DiscoverySqliteService,
  DISCOVERY_MIGRATIONS,
  migrateDiscoveryDatabase,
} from "../../src/storage/discovery-sqlite.js";
import { loadSqliteDriver } from "../../src/storage/sqlite.js";
import { DEFAULT_JIRA_KEY_BLOCKLIST } from "@yep-anywhere/shared";
import { IssueStore } from "../../src/services/issues/IssueStore.js";
import {
  extractIssueReferences,
  issueUrl,
  visibleIssueText,
} from "../../src/services/issues/extract.js";
const dirs: string[] = [];
const services: DiscoverySqliteService[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ya-issues-"));
  dirs.push(dir);
  const service = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
  services.push(service);
  return {
    dir,
    store: new IssueStore(service.getDatabase()!, () => ({
      enabled: true,
      scope: "viewed",
      recentDays: 7,
      aggressiveMatching: true,
    })),
    service,
  };
}
afterEach(() => {
  for (const s of services.splice(0)) s.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("issue reference extraction", () => {
  it("discovers keys and URLs without a registry, preserving repeat occurrences", () => {
    const refs = extractIssueReferences(
      "ABC-123 then ABC-123 and [Fix the crash](https://github.com/Owner/Repo/pull/42/files?token=secret#diff)",
    );
    expect(refs.map((r) => r.key)).toEqual([
      "owner/repo#42",
      "ABC-123",
      "ABC-123",
    ]);
    expect(refs[0]).toMatchObject({
      title: "Fix the crash",
      url: "https://github.com/owner/repo/pull/42",
      kind: "pr",
    });
  });
  it("ignores prose that is shaped like a bare Jira key", () => {
    const text =
      "UTF-8 and ISO-8601 and COVID-19 and an H-1 visa, but PROJ-7 is real";
    expect(
      extractIssueReferences(text, {
        blockedJiraProjects: DEFAULT_JIRA_KEY_BLOCKLIST,
      }).map((r) => r.key),
    ).toEqual(["PROJ-7"]);
    // A one-letter key cannot exist in Jira, so no list is needed for `H-1`.
    expect(extractIssueReferences(text).map((r) => r.key)).toEqual([
      "UTF-8",
      "ISO-8601",
      "COVID-19",
      "PROJ-7",
    ]);
    // Blocking a name never hides an explicit URL for that same project.
    expect(
      extractIssueReferences("https://jira.example.test/browse/ISO-8601", {
        blockedJiraProjects: DEFAULT_JIRA_KEY_BLOCKLIST,
      }).map((r) => r.key),
    ).toEqual(["ISO-8601"]);
  });
  it("requires explicit wording and an unambiguous local repository for bare numbers", () => {
    expect(
      extractIssueReferences("https://github.com/A/B issue #7 PR #8 #9").map(
        (r) => r.key,
      ),
    ).toEqual(["a/b#7", "a/b#8"]);
    expect(extractIssueReferences("issue #7")).toEqual([]);
    expect(
      extractIssueReferences(
        "https://github.com/A/B https://github.com/C/D issue #7",
      ),
    ).toEqual([]);
  });
  it("does not double count a key enclosed by a URL or label", () => {
    expect(
      extractIssueReferences("[ABC-123](https://tracker.test/browse/ABC-123)"),
    ).toHaveLength(1);
  });
  it("keeps tenants distinct and rejects credential-bearing or nonweb URLs", () => {
    expect(issueUrl("https://a.test/browse/ABC-123")?.identity).not.toBe(
      issueUrl("https://b.test/browse/ABC-123")?.identity,
    );
    expect(issueUrl("https://user:pass@a.test/browse/ABC-123")).toBeNull();
    expect(issueUrl("javascript:ABC-123")).toBeNull();
    expect(extractIssueReferences("123 #123 helloABC-123suffix")).toHaveLength(
      0,
    );
  });
  it("reads nested normalized text and excludes tool results, reasoning and setup", () => {
    expect(
      visibleIssueText({
        uuid: "one",
        type: "user",
        message: {
          content: [
            { type: "text", text: "ABC-123" },
            { type: "tool_result", content: "SECRET-456" },
          ],
        },
      })?.text,
    ).toBe("ABC-123");
    expect(
      visibleIssueText({ uuid: "one", type: "system", content: "ABC-123" }),
    ).toBeNull();
    expect(
      visibleIssueText({
        uuid: "one",
        type: "user",
        content: "# AGENTS.md instructions ABC-123",
      }),
    ).toBeNull();
  });
});

describe("durable issue evidence", () => {
  it("starts empty, discovers many sessions, resolves a scoped key, and survives restart", () => {
    const { store, service, dir } = fixture();
    expect(store.list()).toEqual([]);
    for (const sessionId of ["one", "two"])
      store.capture(
        { sessionId, projectId: "project" },
        { id: "message", text: "Working on ABC-123" },
      );
    expect(store.list("ABC-123")[0]).toMatchObject({
      sessionCount: 2,
      unresolved: true,
    });
    store.capture(
      { sessionId: "two", projectId: "project" },
      { id: "url", text: "https://tracker.test/browse/ABC-123" },
    );
    const item = store.list("ABC-123")[0]!;
    expect(item).toMatchObject({ sessionCount: 2, unresolved: false });
    expect(store.evidence(item.id)).toHaveLength(3);
    service.close();
    const reopened = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
    services.push(reopened);
    expect(new IssueStore(reopened.getDatabase()!).list("ABC-123")).toEqual([
      item,
    ]);
  });
  it("deduplicates redelivery while retaining repeats and dismissal", () => {
    const { store } = fixture();
    const source = { sessionId: "one", projectId: "project" };
    const m = {
      id: "m",
      text: "https://github.com/a/b/pull/9 twice https://github.com/a/b/pull/9",
    };
    store.capture(source, m);
    store.capture(source, m);
    const item = store.list()[0]!;
    expect(store.evidence(item.id)).toHaveLength(2);
    store.decide(item.id, "one", "dismissed");
    store.capture(source, { ...m, id: "later" });
    expect(store.list()).toEqual([]);
    store.decide(item.id, "one", "discovered");
    expect(store.evidence(item.id)).toHaveLength(4);
  });
  it("retains unresolved suppression on resolution and separates project contexts", () => {
    const { store } = fixture();
    for (const projectId of ["a", "b"])
      store.capture(
        { sessionId: projectId, projectId },
        { id: "m", text: "ABC-123" },
      );
    expect(store.list()).toHaveLength(2);
    const item = store.list("", "a")[0]!;
    store.decide(item.id, "a", "dismissed");
    store.capture(
      { sessionId: "a", projectId: "a" },
      { id: "url", text: "https://tracker.test/browse/ABC-123" },
    );
    expect(
      store
        .evidence(store.list("", "a")[0]!.id)
        .find((e) => e.messageId === "m")?.state,
    ).toBe("dismissed");
    expect(store.list("", "b")[0]?.unresolved).toBe(false);
  });
  it("restores ambiguity when a second Jira tenant is observed in the same project", () => {
    const { store } = fixture();
    const source = { sessionId: "s", projectId: "p" };
    store.capture(source, { id: "key", text: "ABC-123" });
    store.capture(source, {
      id: "first",
      text: "https://a.test/browse/ABC-123",
    });
    expect(store.list()).toHaveLength(1);
    store.capture(source, {
      id: "second",
      text: "https://b.test/browse/ABC-123",
    });
    expect(store.list()).toHaveLength(3);
    expect(store.list().filter((x) => x.unresolved)).toHaveLength(1);
  });
  it("supports literal search, bounded pages, title overrides and deletion", () => {
    const { store } = fixture();
    store.capture(
      { sessionId: "s", projectId: "p" },
      {
        id: "m",
        text: "[Fix 100%](https://github.com/a/b/issues/1) https://github.com/a/b/issues/2",
      },
    );
    expect(store.list("%")).toHaveLength(1);
    expect(store.list("_")).toHaveLength(0);
    expect(store.list("", "", "", false, 1)).toHaveLength(1);
    const item = store.list("%")[0]!;
    expect(store.title(item.id, "New title")).toBe("New title");
    expect(store.list("New title")).toHaveLength(1);
    expect(store.title(item.id, null)).toBe("Fix 100%");
    store.delete(item.id);
    expect(store.list()).toHaveLength(1);
  });
  it("unions remapped sessions and preserves the latest decision", () => {
    const { store } = fixture();
    for (const sessionId of ["temp", "saved"])
      store.capture(
        { sessionId, projectId: "p" },
        { id: sessionId, text: "https://github.com/a/b/pull/1" },
      );
    const id = store.list()[0]!.id;
    store.decide(id, "temp", "dismissed");
    store.remap("temp", "saved");
    expect(store.list()).toHaveLength(0);
    expect(store.evidence(id)).toHaveLength(2);
    expect(store.evidence(id).every((e) => e.sessionId === "saved")).toBe(true);
  });
});

describe("append-only discovery migrations", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    "upgrades prefix %i without losing unrelated data",
    (prefix) => {
      const db = loadSqliteDriver()!.open(":memory:");
      try {
        db.exec("PRAGMA foreign_keys=ON");
        if (prefix)
          migrateDiscoveryDatabase(db, DISCOVERY_MIGRATIONS.slice(0, prefix));
        if (prefix) {
          db.exec(
            "CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES ('keep')",
          );
        }
        migrateDiscoveryDatabase(db);
        migrateDiscoveryDatabase(db);
        const store = new IssueStore(db);
        expect(store.rows("PRAGMA user_version")[0]?.user_version).toBe(
          DISCOVERY_MIGRATIONS.length,
        );
        if (prefix)
          expect(store.rows("SELECT value FROM retained")[0]?.value).toBe(
            "keep",
          );
        expect(store.list()).toEqual([]);
        expect(() =>
          migrateDiscoveryDatabase(db, DISCOVERY_MIGRATIONS.slice(0, 3)),
        ).toThrow("newer");
        expect(store.rows("PRAGMA user_version")[0]?.user_version).toBe(
          DISCOVERY_MIGRATIONS.length,
        );
      } finally {
        db.close();
      }
    },
  );
  it("rolls back an entire failing upgrade sequence", () => {
    const db = loadSqliteDriver()!.open(":memory:");
    try {
      migrateDiscoveryDatabase(db, DISCOVERY_MIGRATIONS.slice(0, 3));
      expect(() =>
        migrateDiscoveryDatabase(db, [
          ...DISCOVERY_MIGRATIONS,
          {
            version: DISCOVERY_MIGRATIONS.length + 1,
            sql: "CREATE TABLE broken (",
          },
        ]),
      ).toThrow();
      const store = new IssueStore(db);
      expect(store.rows("PRAGMA user_version")[0]?.user_version).toBe(3);
      expect(
        store.rows(
          "SELECT name FROM sqlite_schema WHERE name='external_issues'",
        ),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
});
