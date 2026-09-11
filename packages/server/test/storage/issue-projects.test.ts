import { afterEach, expect, it } from "vitest";
import type { IssueSettings } from "@yep-anywhere/shared";
import {
  loadSqliteDriver,
  type SqliteDatabase,
} from "../../src/storage/sqlite.js";
import {
  migrateDiscoveryDatabase,
  discoveryMigrationPrefix,
} from "../../src/storage/discovery-sqlite.js";
import { IssueStore } from "../../src/services/issues/IssueStore.js";

const databases: SqliteDatabase[] = [];
function fixture() {
  const db = loadSqliteDriver()!.open(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  migrateDiscoveryDatabase(db);
  const settings: IssueSettings = {
    enabled: true,
    scope: "viewed",
    recentDays: 7,
  };
  const store = new IssueStore(db, () => settings);
  let message = 0;
  const capture = (text: string, projectId = "p", sessionId = projectId) =>
    store.capture({ projectId, sessionId }, { id: String(++message), text });
  const settle = () => {
    let count = 0;
    while (store.processResolutions()) {
      if (++count > 100) throw new Error("Reconciliation did not quiesce");
    }
  };
  return { db, store, settings, capture, settle };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it("requires known prefixes by default, learns from absolute URLs, and resolves earlier cross-project mentions", () => {
  const { store, capture, settle } = fixture();
  capture("COVID-19 UNKNOWN-123 TF-42", "other", "older");
  expect(store.list()).toEqual([]);
  expect(store.rows("SELECT * FROM session_issue_links")).toEqual([]);
  capture("https://tomfit.atlassian.net/browse/TF-3996?token=hidden#details");
  settle();
  expect(store.knownJiraProjects()).toEqual([
    { prefix: "TF", site: "https://tomfit.atlassian.net" },
  ]);
  expect(store.list("TF-42")[0]).toMatchObject({
    url: "https://tomfit.atlassian.net/browse/TF-42",
    sessionCount: 1,
    unresolved: false,
  });
  capture("TF-42", "third");
  expect(store.list("TF-42")[0]?.sessionCount).toBe(2);
  expect(store.list("COVID")).toEqual([]);
  expect(store.list("UNKNOWN")).toEqual([]);
  expect(new IssueStore(store.database).knownJiraProjects()).toEqual(
    store.knownJiraProjects(),
  );
});

it("applies aggressive matching and exclusions retroactively without erasing evidence", () => {
  const { store, settings, capture, settle } = fixture();
  capture("UNKNOWN-12 COVID-19");
  settings.aggressiveMatching = true;
  expect(store.list().map((item) => item.key)).toEqual(["UNKNOWN-12"]);
  settings.jiraKeyBlocklist = [];
  expect(store.list().map((item) => item.key)).toEqual([
    "COVID-19",
    "UNKNOWN-12",
  ]);
  settings.aggressiveMatching = false;
  expect(store.list()).toEqual([]);
  capture("https://tomfit.atlassian.net/browse/TF-1");
  capture("TF-2");
  expect(store.list("TF-2")).toHaveLength(1);
  const before = store.rows(
    "SELECT COUNT(*) AS count FROM session_issue_evidence",
  )[0]?.count;
  settings.jiraKeyBlocklist = ["TF"];
  store.reconcileJira();
  settle();
  expect(store.list("TF-2")).toEqual([]);
  expect(store.list("TF-1")).toHaveLength(1);
  settings.jiraKeyBlocklist = [];
  store.reconcileJira();
  settle();
  expect(store.list("TF-2")).toHaveLength(1);
  expect(
    store.rows("SELECT COUNT(*) AS count FROM session_issue_evidence")[0]
      ?.count,
  ).toBe(before);
});

it("retains conflicting mappings and resolves only an unambiguous local site", () => {
  const { store, capture, settle } = fixture();
  capture("https://first.atlassian.net/browse/TF-1", "a");
  capture("TF-2", "c");
  capture("https://second.atlassian.net/browse/TF-3", "b");
  settle();
  expect(store.knownJiraProjects()).toHaveLength(2);
  expect(store.list("TF-2")).toEqual([]);
  capture("TF-2", "a");
  expect(store.list("TF-2")[0]).toMatchObject({
    url: "https://first.atlassian.net/browse/TF-2",
    sessionCount: 1,
  });
  capture("TF-2", "b");
  expect(store.list("TF-2")).toHaveLength(2);
});

it("preserves confirmed and dismissed decisions through reconciliation and allows explicit restore", () => {
  const { store, capture, settle, settings } = fixture();
  capture("https://tomfit.atlassian.net/browse/TF-1");
  capture("TF-2", "confirmed");
  capture("TF-3", "dismissed");
  const confirmed = store.list("TF-2")[0]!.id;
  const dismissed = store.list("TF-3")[0]!.id;
  store.decide(confirmed, "confirmed", "confirmed");
  store.decide(dismissed, "dismissed", "dismissed");
  settings.jiraKeyBlocklist = ["TF"];
  store.reconcileJira();
  settle();
  settings.jiraKeyBlocklist = [];
  store.reconcileJira();
  settle();
  expect(store.list("TF-2")).toHaveLength(1);
  expect(store.list("TF-3")).toHaveLength(0);
  store.decide(dismissed, "dismissed", "discovered");
  expect(store.list("TF-3")).toHaveLength(1);
});

it("upgrades v6 without changing decisions or titles, then backfills URLs in bounded resumable work", () => {
  const db = loadSqliteDriver()!.open(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  migrateDiscoveryDatabase(db, discoveryMigrationPrefix(6));
  db.exec(`INSERT INTO external_issues VALUES ('jira:tomfit.atlassian.net:TF-1','TF-1','https://tomfit.atlassian.net/browse/TF-1','jira','issue','Observed','Custom',1);
    INSERT INTO session_issue_links VALUES (1,'jira:tomfit.atlassian.net:TF-1','source','confirmed',9);
    INSERT INTO session_issue_evidence(session_id,project_id,occurrence,ref_key,provider,link_id,kind,observed_value,excerpt,message_id,observed_at)
    VALUES ('source','p','url','TF-1','jira',1,'message-url','https://tomfit.atlassian.net/browse/TF-1','','m',1);`);
  for (let i = 0; i < 60; i++) {
    const q = db.prepare(
      `INSERT INTO session_issue_evidence(session_id,project_id,occurrence,ref_key,provider,kind,observed_value,excerpt,message_id,observed_at) VALUES (?,'other',?,'TF-2','jira','ticket-key','TF-2','','m',1)`,
    );
    try {
      q.run(`s${i}`, `m${i}`);
    } finally {
      q.finalize();
    }
  }
  migrateDiscoveryDatabase(db);
  let store = new IssueStore(db);
  expect(store.knownJiraProjects()).toEqual([]);
  expect(store.list()[0]?.title).toBe("Custom");
  store.processResolutions(); // learns stored explicit URLs
  store.processResolutions(); // resolves at most 25 candidates
  expect(store.list("TF-2")[0]?.sessionCount).toBe(25);
  store = new IssueStore(db); // resume with a new owner using durable progress
  while (store.processResolutions()) {
    /* bounded batches */
  }
  expect(store.list("TF-2")[0]?.sessionCount).toBe(60);
  expect(
    store.rows(
      "SELECT state,decision_at FROM session_issue_links WHERE id=1",
    )[0],
  ).toMatchObject({ state: "confirmed", decision_at: 9 });
  expect(store.list("TF-1")[0]?.title).toBe("Custom");
});

it("never queues blocked or unknown candidates for tracker lookup under conservative rules", () => {
  const { store, settings, capture } = fixture();
  settings.confirmation = {
    enabled: true,
    jiraSite: "https://tomfit.atlassian.net",
    jiraEmail: "user@example.test",
  };
  capture("COVID-19 UNKNOWN-1");
  expect(store.rows("SELECT * FROM issue_confirmations")).toEqual([]);
  settings.aggressiveMatching = true;
  capture("COVID-19 UNKNOWN-1");
  expect(
    store
      .rows("SELECT ref_key FROM issue_confirmations")
      .map((row) => row.ref_key),
  ).toEqual(["UNKNOWN-1"]);
});
