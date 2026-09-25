import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import { decideLimitedRoute } from "../../src/auth/limitedUserPolicy.js";
import { SessionAccessResolver } from "../../src/auth/sessionAccess.js";
import { AUTHENTICATED_SRP_TRANSPORT } from "../../src/middleware/authenticated-transport.js";
import { createLimitedUsersMiddleware } from "../../src/middleware/limited-users.js";
import {
  actingUsername,
  applyLimitedLaunchPolicy,
} from "../../src/routes/limited-session-launch.js";
import { buildUserMessageMetadata } from "../../src/routes/session-request-helpers.js";
import {
  PRINCIPAL_VARIABLE,
  signActingUser,
} from "../../src/auth/principal.js";

/** topics/limited-users.md § Delivery v1 — Authorization. */

function decide(method: string, url: string) {
  const parsed = new URL(url, "http://127.0.0.1");
  return decideLimitedRoute({
    method,
    path: parsed.pathname,
    query: parsed.searchParams,
  });
}

describe("limited-user route policy", () => {
  it("refuses a path nobody listed, so a new route is closed by default", () => {
    expect(decide("GET", "/api/some-new-surface")).toEqual({ kind: "deny" });
    expect(decide("POST", "/api/some-new-surface")).toEqual({ kind: "deny" });
  });

  it("refuses Issues & PRs, which spend the host's ticket credentials", () => {
    expect(decide("GET", "/api/issues")).toEqual({ kind: "deny" });
    expect(decide("GET", "/api/issues/42")).toEqual({ kind: "deny" });
  });

  it("refuses bang commands and absolute-path file reads", () => {
    expect(decide("POST", "/api/bang-commands/run")).toEqual({ kind: "deny" });
    expect(decide("GET", "/api/local-file?path=/etc/passwd")).toEqual({
      kind: "deny",
    });
  });

  it("reads settings but never writes them", () => {
    expect(decide("GET", "/api/settings")).toEqual({ kind: "allow" });
    expect(decide("PATCH", "/api/settings")).toEqual({ kind: "deny" });
  });

  it("scopes a project path by method", () => {
    expect(decide("GET", "/api/projects/abc/files")).toEqual({
      kind: "project",
      projectId: "abc",
      required: "view",
    });
    expect(decide("POST", "/api/projects/abc/sessions/create")).toEqual({
      kind: "project",
      projectId: "abc",
      required: "new-session",
    });
  });

  it("treats sending a turn as a join and anything heavier as new-session", () => {
    expect(decide("POST", "/api/sessions/s1/messages")).toEqual({
      kind: "session",
      sessionId: "s1",
      required: "join",
    });
    expect(decide("POST", "/api/projects/abc/sessions/s1/fork")).toEqual({
      kind: "session",
      sessionId: "s1",
      required: "new-session",
    });
  });

  it("allows the status polls every client makes, and only as reads", () => {
    expect(decide("GET", "/api/onboarding")).toEqual({ kind: "allow" });
    expect(decide("POST", "/api/onboarding/complete")).toEqual({
      kind: "deny",
    });
    expect(decide("GET", "/api/public-shares/status")).toEqual({
      kind: "allow",
    });
    expect(decide("POST", "/api/public-shares")).toEqual({ kind: "deny" });
  });

  it("allows the websocket upgrade, which is policed per message", () => {
    expect(decide("GET", "/api/ws")).toEqual({ kind: "allow" });
  });

  it("filters the lists a limited user may read", () => {
    expect(decide("GET", "/api/projects")).toEqual({
      kind: "allow-filtered",
      filter: "projects",
    });
    expect(decide("GET", "/api/sessions")).toEqual({
      kind: "allow-filtered",
      filter: "sessions",
    });
    expect(decide("POST", "/api/sessions")).toEqual({ kind: "deny" });
  });
});

describe("LimitedUsersService", () => {
  let dir: string;
  let service: LimitedUsersService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "limited-users-test-"));
    service = new LimitedUsersService({ dataDir: dir });
    await service.initialize();
  });

  afterEach(async () => {
    await service.flushPendingWrites();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stores both credential forms and returns neither", async () => {
    const summary = await service.create({
      username: "alice",
      password: "correct-horse",
      newSessionProjects: ["p1"],
    });
    expect(summary).not.toHaveProperty("passwordHash");
    expect(summary).not.toHaveProperty("srp");
    expect(summary.newSessionProjects).toEqual(["p1"]);

    const record = service.get("alice");
    expect(record?.passwordHash).toBeTypeOf("string");
    expect(record?.srp.verifier).toBeTypeOf("string");
    expect(record?.srp.salt).toBeTypeOf("string");
  });

  it("verifies the right password and refuses the wrong one", async () => {
    await service.create({ username: "alice", password: "correct-horse" });
    expect(await service.verifyPassword("alice", "correct-horse")).toBe(true);
    expect(await service.verifyPassword("alice", "wrong-horse")).toBe(false);
    expect(await service.verifyPassword("nobody", "correct-horse")).toBe(false);
  });

  it("answers an unknown SRP identity with an indistinguishable decoy", async () => {
    await service.create({ username: "alice", password: "correct-horse" });
    const known = service.getSrpChallengeInputs("alice");
    const unknown = service.getSrpChallengeInputs("mallory");
    expect(known.known).toBe(true);
    expect(unknown.known).toBe(false);
    expect(unknown.salt).toBeTypeOf("string");
    expect(unknown.verifier).toBeTypeOf("string");
    // The decoy is stable, so repeated probing cannot distinguish it by
    // watching the challenge change.
    expect(service.getSrpChallengeInputs("mallory")).toEqual(unknown);
  });

  it("refuses a disabled user's login and grants", async () => {
    await service.create({ username: "alice", password: "correct-horse" });
    await service.update("alice", { disabled: true });
    expect(await service.verifyPassword("alice", "correct-horse")).toBe(false);
    expect(service.getActiveGrants("alice")).toBeNull();
  });
});

describe("limited-user launch policy", () => {
  const contextFor = (principal: unknown) =>
    ({ get: () => principal }) as unknown as Parameters<
      typeof applyLimitedLaunchPolicy
    >[0];

  const alice = {
    kind: "limited",
    username: "alice",
    switched: false,
    locked: true,
    via: "direct",
    grants: {
      newSessionProjects: ["p1"],
      joinProjects: [],
      viewProjects: [],
      joinStaleOffsetMinutes: 0,
      lock: { provider: "codex", model: "gpt-5" },
    },
  };

  it("leaves the superuser's request untouched", () => {
    const body = { sandboxLevel: "none" as string | undefined };
    expect(
      applyLimitedLaunchPolicy(contextFor({ kind: "superuser" }), body),
    ).toEqual({ kind: "superuser" });
    expect(body.sandboxLevel).toBe("none");
  });

  it("forces the sandbox on and fills in the locked values", () => {
    const body: {
      sandboxLevel?: string;
      provider?: string;
      model?: string;
    } = { sandboxLevel: "none" };
    expect(applyLimitedLaunchPolicy(contextFor(alice), body)).toEqual({
      kind: "applied",
      username: "alice",
    });
    expect(body.sandboxLevel).toBe("project-write");
    expect(body.provider).toBe("codex");
    expect(body.model).toBe("gpt-5");
  });

  it("refuses a request that names a value outside the lock", () => {
    const outcome = applyLimitedLaunchPolicy(contextFor(alice), {
      provider: "claude",
    });
    expect(outcome.kind).toBe("error");
  });

  describe("a locked effort against the request's thinking option", () => {
    const withEffort = {
      ...alice,
      grants: { ...alice.grants, lock: { effort: "medium" } },
    };

    it("accepts the same effort written as a thinking option", () => {
      const body: { thinking?: string } = { thinking: "on:medium" };
      expect(applyLimitedLaunchPolicy(contextFor(withEffort), body).kind).toBe(
        "applied",
      );
      expect(body.thinking).toBe("on:medium");
    });

    it("fills in the locked effort when the request names none", () => {
      for (const thinking of [undefined, "off", "auto"]) {
        const body: { thinking?: string } = { thinking };
        expect(
          applyLimitedLaunchPolicy(contextFor(withEffort), body).kind,
        ).toBe("applied");
        expect(body.thinking).toBe("on:medium");
      }
    });

    it("refuses a different effort", () => {
      const outcome = applyLimitedLaunchPolicy(contextFor(withEffort), {
        thinking: "on:max",
      });
      expect(outcome).toEqual({
        kind: "error",
        error: 'This user is limited to effort "medium"',
      });
    });
  });
});

describe("limited-user middleware", () => {
  let dir: string;
  let service: LimitedUsersService;

  const buildApp = async (options?: { now?: () => number }) => {
    const app = new Hono();
    const sessions = new Map<
      string,
      { projectId: string; provider: string; lastActivityMs: number }
    >([
      [
        "fresh",
        { projectId: "join-project", provider: "codex", lastActivityMs: 0 },
      ],
    ]);
    const now = options?.now ?? (() => 0);
    const resolver = new SessionAccessResolver({
      getLiveSession: () => undefined,
      readCatalogRows: async () =>
        [...sessions].map(([sessionId, row]) => ({
          sessionId,
          projectId: row.projectId,
          catalogFamily: row.provider,
          updatedAt: new Date(row.lastActivityMs).toISOString(),
        })),
      getSessionMetadata: () => undefined,
      now,
    });
    app.use(
      "/api/*",
      createLimitedUsersMiddleware({
        getActiveGrants: (username) => service.getActiveGrants(username),
        sessionAccess: resolver,
        getSuperuserIdentity: () => "owner",
        getCookieSessionUsername: async () => "alice",
        getCookieSecret: () => "secret",
      }),
    );
    app.get("/api/projects", (c) =>
      c.json({
        projects: [{ id: "view-project" }, { id: "secret-project" }],
      }),
    );
    app.get("/api/sessions", (c) =>
      c.json({
        sessions: [
          { id: "a", projectId: "view-project" },
          { id: "b", projectId: "secret-project" },
        ],
      }),
    );
    app.get("/api/projects/:projectId/files", (c) => c.json({ ok: true }));
    app.post("/api/sessions/:sessionId/messages", (c) => c.json({ ok: true }));
    app.get("/api/issues", (c) => c.json({ issues: [] }));
    return app;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "limited-users-mw-"));
    service = new LimitedUsersService({ dataDir: dir });
    await service.initialize();
    await service.create({
      username: "alice",
      password: "correct-horse",
      viewProjects: ["view-project"],
      joinProjects: ["join-project"],
      joinStaleOffsetMinutes: 0,
    });
  });

  afterEach(async () => {
    await service.flushPendingWrites();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("answers 404, not 403, for a project outside the grants", async () => {
    const app = await buildApp();
    const denied = await app.request("/api/projects/secret-project/files");
    expect(denied.status).toBe(404);
    const allowed = await app.request("/api/projects/view-project/files");
    expect(allowed.status).toBe(200);
  });

  it("removes inaccessible rows from lists it does serve", async () => {
    const app = await buildApp();
    const projects = (await (await app.request("/api/projects")).json()) as {
      projects: Array<{ id: string }>;
    };
    expect(projects.projects.map((p) => p.id)).toEqual(["view-project"]);

    const sessions = (await (await app.request("/api/sessions")).json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(sessions.sessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("refuses Issues & PRs at the operation, not only in the nav", async () => {
    const app = await buildApp();
    expect((await app.request("/api/issues")).status).toBe(403);
  });

  it("allows a turn in a fresh joinable session and refuses a cold one", async () => {
    const fresh = await buildApp({ now: () => 5 * 60 * 1000 });
    expect(
      (await fresh.request("/api/sessions/fresh/messages", { method: "POST" }))
        .status,
    ).toBe(200);

    // Codex's believed cache-warm window is ten minutes; past it the session
    // is read-only for this user.
    const cold = await buildApp({ now: () => 30 * 60 * 1000 });
    const response = await cold.request("/api/sessions/fresh/messages", {
      method: "POST",
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { reason?: string }).reason).toBe(
      "stale-session",
    );
  });

  it("answers 401 once the logged-in user is disabled", async () => {
    await service.update("alice", { disabled: true });
    const app = await buildApp();
    const response = await app.request("/api/projects");
    expect(response.status).toBe(401);
  });

  it("refuses a limited relay login that has no active grants", async () => {
    // With the feature off no limited user has active grants.
    const app = new Hono();
    app.use(
      "/api/*",
      createLimitedUsersMiddleware({
        getActiveGrants: () => null,
        sessionAccess: new SessionAccessResolver({
          getLiveSession: () => undefined,
          readCatalogRows: async () => [],
          getSessionMetadata: () => undefined,
        }),
        getSuperuserIdentity: () => "owner",
        getCookieSessionUsername: async () => null,
        getCookieSecret: () => "secret",
      }),
    );
    app.get("/api/issues", (c) => c.json({ ok: true }));
    const relayLogin = (username: string) => ({
      [AUTHENTICATED_SRP_TRANSPORT]: { kind: "srp", username },
    });

    expect(
      (await app.request("/api/issues", {}, relayLogin("alice"))).status,
    ).toBe(401);
    expect(
      (await app.request("/api/issues", {}, relayLogin("owner"))).status,
    ).toBe(200);
  });

  it("acts as the superuser when the acting cookie names nobody", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      createLimitedUsersMiddleware({
        getActiveGrants: (username) => service.getActiveGrants(username),
        sessionAccess: new SessionAccessResolver({
          getLiveSession: () => undefined,
          readCatalogRows: async () => [],
          getSessionMetadata: () => undefined,
        }),
        getSuperuserIdentity: () => "owner",
        getCookieSessionUsername: async () => null,
        getCookieSecret: () => "secret",
      }),
    );
    app.get("/api/issues", (c) =>
      c.json({
        principal: (c as unknown as { get: (key: string) => unknown }).get(
          PRINCIPAL_VARIABLE,
        ),
      }),
    );
    const response = await app.request("/api/issues");
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { principal: { kind: string } }).principal,
    ).toEqual({ kind: "superuser" });
  });

  it("honors a signed acting-user cookie for a superuser login", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      createLimitedUsersMiddleware({
        getActiveGrants: (username) => service.getActiveGrants(username),
        sessionAccess: new SessionAccessResolver({
          getLiveSession: () => undefined,
          readCatalogRows: async () => [],
          getSessionMetadata: () => undefined,
        }),
        getSuperuserIdentity: () => "owner",
        getCookieSessionUsername: async () => null,
        getCookieSecret: () => "secret",
      }),
    );
    app.get("/api/issues", (c) => c.json({ ok: true }));

    const switched = await app.request("/api/issues", {
      headers: {
        Cookie: `yep-anywhere-acting-user=${signActingUser("alice", "secret")}`,
      },
    });
    expect(switched.status).toBe(403);

    // A forged cookie is not a switch; the request stays the superuser's.
    const forged = await app.request("/api/issues", {
      headers: { Cookie: "yep-anywhere-acting-user=alice.deadbeef" },
    });
    expect(forged.status).toBe(200);
  });
});

describe("user turn attribution", () => {
  /** topics/limited-users.md § Delivery v1 — Usage. */
  const contextFor = (principal: unknown) =>
    ({ get: () => principal }) as unknown as Parameters<
      typeof actingUsername
    >[0];

  it("names the acting limited user, including a switched superuser", () => {
    expect(
      actingUsername(
        contextFor({ kind: "limited", username: "archer", switched: false }),
      ),
    ).toBe("archer");
    expect(
      actingUsername(
        contextFor({ kind: "limited", username: "archer", switched: true }),
      ),
    ).toBe("archer");
  });

  it("leaves the superuser unnamed, which is what absent means", () => {
    expect(actingUsername(contextFor({ kind: "superuser" }))).toBe(undefined);
    expect(actingUsername(contextFor(undefined))).toBe(undefined);
  });

  it("stamps the sender from the principal, never from the request body", () => {
    const metadata = buildUserMessageMetadata(
      // A client claiming to be somebody else.
      { messageMetadata: { sentByUser: "lana" } } as never,
      1000,
      "direct",
      "archer",
    );
    expect(metadata.sentByUser).toBe("archer");
  });

  it("omits the sender for the superuser rather than writing a name", () => {
    const metadata = buildUserMessageMetadata({}, 1000, "direct");
    expect(metadata.sentByUser).toBe(undefined);
  });
});
