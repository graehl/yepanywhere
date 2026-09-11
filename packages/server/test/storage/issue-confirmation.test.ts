import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IssueSettings } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";
import { IssueStore } from "../../src/services/issues/IssueStore.js";
import { IssueConfirmer } from "../../src/services/issues/confirm.js";
import { IssueCredentials } from "../../src/services/issues/credentials.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function harness(overrides: Partial<IssueSettings> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ya-issue-confirm-"));
  directories.push(dir);
  const db = new DiscoverySqliteService({ dataDir: dir, mode: "auto" });
  let settings: IssueSettings = {
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    aggressiveMatching: true,
    confirmation: {
      enabled: true,
      jiraSite: "https://example.atlassian.net",
      jiraEmail: "someone@example.com",
    },
    ...overrides,
  };
  const store = new IssueStore(db.getDatabase()!, () => settings);
  const credentials = new IssueCredentials({
    env: { GITHUB_TOKEN: "gh-secret", JIRA_API_TOKEN: "jira-secret" },
    cliToken: async () => null,
  });
  return {
    db,
    store,
    credentials,
    set: (next: Partial<IssueSettings>) => {
      settings = { ...settings, ...next };
    },
    settings: () => settings,
    capture: (text: string, sessionId = "s") =>
      store.capture(
        { sessionId, projectId: "p" },
        { id: `${sessionId}-${text.length}`, text },
      ),
    pending: () =>
      store
        .rows("SELECT ref_key,state FROM issue_confirmations ORDER BY ref_key")
        .map((row) => [String(row.ref_key), String(row.state)]),
  };
}

describe("tracker confirmation", () => {
  it("asks once per newly seen reference and never again on its own", async () => {
    const h = harness();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/issues/42"))
        return new Response(JSON.stringify({ title: "Repair cancellation" }), {
          status: 200,
        });
      return new Response("", { status: 404 });
    });
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("see https://github.com/Owner/Repo/pull/42 and MADEUP-9");
    expect(h.pending()).toEqual([
      ["MADEUP-9", "pending"],
      ["owner/repo#42", "pending"],
    ]);

    await confirmer.drain();
    expect(h.pending()).toEqual([
      ["MADEUP-9", "rejected"],
      ["owner/repo#42", "confirmed"],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Seeing the same references again, in another session, asks nothing.
    h.capture("still https://github.com/Owner/Repo/pull/42 and MADEUP-9", "s2");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(2);

    const confirmed = h.store
      .list()
      .find((item) => item.key === "owner/repo#42");
    expect(confirmed?.confirmation).toEqual({
      state: "confirmed",
      title: "Repair cancellation",
    });
    expect(
      h.store.list().find((item) => item.key === "MADEUP-9")?.confirmation,
    ).toEqual({ state: "rejected", title: null });
    await confirmer.close();
    h.db.close();
  });

  it("records an unreachable tracker once rather than retrying it", async () => {
    const h = harness();
    const fetcher = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 is the ticket");
    await confirmer.drain();
    expect(h.pending()).toEqual([["PROJ-7", "unreachable"]]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Neither a later drain nor a later sighting asks the tracker again.
    await confirmer.drain();
    h.capture("PROJ-7 again", "s2");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Only an explicit recheck does, which is a user action.
    confirmer.recheck("p", "jira", "PROJ-7");
    await confirmer.drain();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await confirmer.close();
    h.db.close();
  });

  it("queues nothing while confirmation is off, including a backlog", async () => {
    const h = harness({ confirmation: undefined });
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 and https://github.com/Owner/Repo/issues/1");
    expect(h.pending()).toEqual([]);
    await confirmer.drain();
    expect(fetcher).not.toHaveBeenCalled();

    // Turning it on does not go back over what was captured while it was off.
    h.set({
      confirmation: {
        enabled: true,
        jiraSite: "https://example.atlassian.net",
        jiraEmail: "someone@example.com",
      },
    });
    await confirmer.drain();
    expect(fetcher).not.toHaveBeenCalled();
    await confirmer.close();
    h.db.close();
  });

  it("reports a missing credential or Jira site without contacting anything", async () => {
    const h = harness({
      confirmation: {
        enabled: true,
        jiraSite: "",
        jiraEmail: "",
      },
    });
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: new IssueCredentials({
        env: {},
        cliToken: async () => null,
      }),
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 is the ticket");
    await confirmer.drain();
    expect(h.pending()).toEqual([["PROJ-7", "unreachable"]]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      h.store.rows("SELECT detail FROM issue_confirmations")[0]!.detail,
    ).toContain("No jira credential");
    await confirmer.close();
    h.db.close();
  });

  it("sends Jira basic auth to the configured site and GitHub a bearer token", async () => {
    const h = harness();
    const seen: Array<[string, string]> = [];
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seen.push([String(url), String(headers.Authorization)]);
        return new Response(
          JSON.stringify({ fields: { summary: "A ticket" } }),
          {
            status: 200,
          },
        );
      },
    );
    const confirmer = new IssueConfirmer(h.store, {
      settings: h.settings,
      credentials: h.credentials,
      fetch: fetcher as unknown as typeof fetch,
    });
    h.capture("PROJ-7 and https://github.com/Owner/Repo/issues/3");
    await confirmer.drain();
    const jira = seen.find(([url]) => url.includes("atlassian"))!;
    expect(jira[0]).toBe(
      "https://example.atlassian.net/rest/api/3/issue/PROJ-7?fields=summary",
    );
    expect(
      Buffer.from(jira[1].replace("Basic ", ""), "base64").toString(),
    ).toBe("someone@example.com:jira-secret");
    const github = seen.find(([url]) => url.includes("api.github.com"))!;
    expect(github[0]).toBe("https://api.github.com/repos/owner/repo/issues/3");
    expect(github[1]).toBe("Bearer gh-secret");
    expect(
      h.store.list().find((item) => item.key === "PROJ-7")?.confirmation?.title,
    ).toBe("A ticket");
    await confirmer.close();
    h.db.close();
  });
});
