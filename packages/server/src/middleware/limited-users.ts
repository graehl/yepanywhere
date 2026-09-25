/**
 * Principal resolution and limited-user authorization for every API request.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Authorization.
 *
 * One middleware does both halves so no route can be reached with an
 * unresolved principal: it decides who is acting, and — when that is a
 * limited user — whether this exact operation is allowed, refusing by
 * default. List responses the user is allowed to read are then pruned of
 * projects outside their grants, so a filtered UI and an enforced API agree.
 */

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { LimitedUserGrants } from "@yep-anywhere/shared";
import {
  ACTING_USER_COOKIE,
  DIRECT_LOGIN_VARIABLE,
  type LimitedPrincipal,
  type Principal,
  PRINCIPAL_VARIABLE,
  SUPERUSER,
  verifyActingUser,
} from "../auth/principal.js";
import type { SessionAccessResolver } from "../auth/sessionAccess.js";
import {
  type FilteredListKind,
  decideLimitedRoute,
  levelFor,
  satisfies,
} from "../auth/limitedUserPolicy.js";
import {
  getAuthenticatedDirectLogin,
  getAuthenticatedSrpTransport,
} from "./authenticated-transport.js";
import { WS_INTERNAL_AUTHENTICATED } from "./internal-auth.js";

export interface LimitedUsersMiddlewareOptions {
  /**
   * Grants for a limited user who may act now: null when the feature is off
   * or the user is unknown or disabled. With the feature off no login other
   * than the superuser's resolves, so a live limited login is refused rather
   * than read as the superuser.
   */
  getActiveGrants: (username: string) => LimitedUserGrants | null;
  sessionAccess: SessionAccessResolver;
  /** The superuser's relay/SRP identity, when remote access is configured. */
  getSuperuserIdentity: () => string | null;
  /** Username recorded on the direct cookie session, when there is one. */
  getCookieSessionUsername: (
    c: Parameters<MiddlewareHandler>[0],
  ) => Promise<string | null>;
  /** Secret used to sign the acting-user cookie. */
  getCookieSecret: () => string;
}

function limitedPrincipal(
  username: string,
  grants: LimitedUserGrants,
  options: { switched: boolean; locked: boolean; via: "relay" | "direct" },
): LimitedPrincipal {
  return { kind: "limited", username, grants, ...options };
}

/**
 * The direct login's username for this request, or null for the superuser.
 * An internal request never takes its login from its own headers: a
 * trusted-local websocket carries the login it bound at upgrade, and a
 * server-originated request has none.
 */
async function resolveDirectLoginUsername(
  c: Parameters<MiddlewareHandler>[0],
  options: LimitedUsersMiddlewareOptions,
): Promise<string | null> {
  if (getAuthenticatedSrpTransport(c.env)) return null;
  const bound = getAuthenticatedDirectLogin(c.env);
  if (bound) return bound.username;
  if (c.env?.[WS_INTERNAL_AUTHENTICATED]) return null;
  return options.getCookieSessionUsername(c);
}

/** Resolve the acting principal without enforcing anything. */
export async function resolvePrincipal(
  c: Parameters<MiddlewareHandler>[0],
  options: LimitedUsersMiddlewareOptions,
  directLoginUsername: string | null,
): Promise<Principal> {
  const srp = getAuthenticatedSrpTransport(c.env);
  const superuserIdentity = options.getSuperuserIdentity();
  if (srp && srp.username !== superuserIdentity) {
    const grants = options.getActiveGrants(srp.username);
    if (!grants) return DENIED_PRINCIPAL;
    return limitedPrincipal(srp.username, grants, {
      switched: false,
      locked: true,
      via: "relay",
    });
  }

  if (directLoginUsername) {
    const grants = options.getActiveGrants(directLoginUsername);
    if (!grants) return DENIED_PRINCIPAL;
    return limitedPrincipal(directLoginUsername, grants, {
      switched: false,
      locked: true,
      via: "direct",
    });
  }

  // The login is the superuser; honor a switch into a limited user.
  const acting = verifyActingUser(
    getCookie(c, ACTING_USER_COOKIE),
    options.getCookieSecret(),
  );
  if (acting) {
    const grants = options.getActiveGrants(acting);
    if (grants) {
      return limitedPrincipal(acting, grants, {
        switched: true,
        locked: false,
        via: srp ? "relay" : "direct",
      });
    }
  }
  return SUPERUSER;
}

/**
 * A login that named a limited user who no longer exists or was disabled.
 * The middleware turns this into 401 so the client logs in again rather than
 * driving a UI in which every operation is refused.
 */
const DENIED_PRINCIPAL: LimitedPrincipal = {
  kind: "limited",
  username: "",
  grants: {
    newSessionProjects: [],
    joinProjects: [],
    viewProjects: [],
    joinStaleOffsetMinutes: 0,
    lock: {},
  },
  switched: false,
  locked: true,
  via: "direct",
};

const DROP = Symbol("drop-inaccessible");

/**
 * Remove rows for projects outside the grants. A row is anything carrying a
 * `projectId`, at any depth, which is how every list route identifies the
 * project a session, queue item, or recent entry belongs to.
 */
function pruneInaccessible(
  value: unknown,
  isAccessible: (projectId: string) => boolean,
): unknown | typeof DROP {
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const entry of value) {
      const pruned = pruneInaccessible(entry, isAccessible);
      if (pruned !== DROP) kept.push(pruned);
    }
    return kept;
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const projectId = record.projectId;
  if (typeof projectId === "string" && !isAccessible(projectId)) {
    return DROP;
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const pruned = pruneInaccessible(entry, isAccessible);
    if (pruned === DROP) {
      // A nested object naming an inaccessible project takes its row with it.
      return DROP;
    }
    next[key] = pruned;
  }
  return next;
}

/** The projects list identifies rows by `id`, not `projectId`. */
function pruneProjectsList(
  body: unknown,
  isAccessible: (projectId: string) => boolean,
): unknown {
  if (!body || typeof body !== "object") return body;
  const record = body as Record<string, unknown>;
  const projects = record.projects;
  if (!Array.isArray(projects)) return body;
  return {
    ...record,
    projects: projects.filter(
      (project) =>
        typeof (project as { id?: unknown }).id === "string" &&
        isAccessible((project as { id: string }).id),
    ),
  };
}

async function filterResponse(
  response: Response,
  filter: FilteredListKind,
  isAccessible: (projectId: string) => boolean,
): Promise<Response> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json") || !response.ok) {
    return response;
  }
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  const filtered =
    filter === "projects"
      ? pruneProjectsList(body, isAccessible)
      : pruneInaccessible(body, isAccessible);
  const payload = filtered === DROP ? {} : filtered;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(payload), {
    status: response.status,
    headers,
  });
}

export function createLimitedUsersMiddleware(
  options: LimitedUsersMiddlewareOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const directLoginUsername = await resolveDirectLoginUsername(c, options);
    c.set(DIRECT_LOGIN_VARIABLE, directLoginUsername);
    const principal = await resolvePrincipal(c, options, directLoginUsername);
    c.set(PRINCIPAL_VARIABLE, principal);
    if (principal.kind === "superuser") {
      await next();
      return;
    }
    if (principal === DENIED_PRINCIPAL) {
      // The login named a user who is gone or disabled.
      return c.json({ error: "Session expired" }, 401);
    }

    const url = new URL(c.req.url);
    const decision = decideLimitedRoute({
      method: c.req.method,
      path: url.pathname,
      query: url.searchParams,
    });

    const isAccessible = (projectId: string) =>
      levelFor(principal.grants, projectId) !== "none";

    switch (decision.kind) {
      case "deny":
        return c.json({ error: "Not permitted for this user" }, 403);
      case "allow":
        await next();
        return;
      case "allow-filtered": {
        await next();
        if (c.res) {
          c.res = await filterResponse(c.res, decision.filter, isAccessible);
        }
        return;
      }
      case "project": {
        const level = levelFor(principal.grants, decision.projectId);
        if (level === "none") {
          return c.json({ error: "Project not found" }, 404);
        }
        if (!satisfies(level, decision.required)) {
          return c.json({ error: "Not permitted for this user" }, 403);
        }
        await next();
        return;
      }
      case "session": {
        const facts = await options.sessionAccess.resolve(decision.sessionId);
        if (!facts) {
          return c.json({ error: "Session not found" }, 404);
        }
        const ownedByCaller = facts.createdByUser === principal.username;
        const level = levelFor(principal.grants, facts.projectId);
        if (level === "none" && !ownedByCaller) {
          return c.json({ error: "Session not found" }, 404);
        }
        if (decision.required === "view") {
          await next();
          return;
        }
        if (!satisfies(level, decision.required)) {
          return c.json({ error: "Not permitted for this user" }, 403);
        }
        if (
          decision.required === "join" &&
          !options.sessionAccess.canJoin(facts, {
            username: principal.username,
            offsetMinutes: principal.grants.joinStaleOffsetMinutes,
          })
        ) {
          return c.json(
            {
              error:
                "This session has gone cold; start a new session instead of resuming it",
              reason: "stale-session",
            },
            403,
          );
        }
        await next();
        return;
      }
    }
  };
}
