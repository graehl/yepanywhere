/**
 * What a limited user may ask the API to do.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Authorization.
 *
 * The rule is default-deny: a request path that is not listed here is
 * refused, so a route added later is unreachable for limited users until
 * someone lists it deliberately. Listed paths are then scoped — a project or
 * session outside the user's grants answers 404 rather than 403, because
 * whether a project exists is itself not the user's business.
 *
 * This module is pure: it decides from the method and the path, and hands
 * back what the caller must still resolve (a session's project). The path
 * must be the one the router matches handlers against (Hono's `c.req.path`,
 * already percent-decoded), never the raw URL pathname: `/api/%69ssues`
 * reaches the `/api/issues` handler, so the decision has to see it as that.
 *
 * A project grant comes only from the path. No route is opened by a
 * `projectId` query parameter, because most handlers ignore one.
 */

import type {
  LimitedUserGrants,
  ProjectAccessLevel,
} from "@yep-anywhere/shared";
import { projectAccessLevel } from "@yep-anywhere/shared";

/** What the request needs from the project it touches. */
export type RequiredAccess = "view" | "join" | "new-session";

export type LimitedRouteDecision =
  | { kind: "deny" }
  /** Allowed with no project scope (identity, version, catalogs). */
  | { kind: "allow" }
  /** Allowed when the named project grants at least `required`. */
  | { kind: "project"; projectId: string; required: RequiredAccess }
  /**
   * Allowed when the session's project grants at least `required`. A `join`
   * requirement additionally needs the session to be fresh unless the user
   * started it.
   */
  | { kind: "session"; sessionId: string; required: RequiredAccess }
  /** Allowed, and the response is a list the caller must filter. */
  | { kind: "allow-filtered"; filter: FilteredListKind };

export type FilteredListKind =
  | "projects"
  | "sessions"
  | "inbox"
  | "recents"
  | "processes";

/**
 * Route families a limited user may never reach, listed ahead of the
 * allowances so a project-scoped-looking path cannot sneak one in.
 *
 * Issues & PRs spend the host's ticket-system credentials; bang commands run
 * outside the provider sandbox; file editing reads and writes any absolute
 * path in the host-wide local-file allow-set, which no project grant scopes,
 * and its rebuild route runs a registered command outside any session
 * sandbox; the rest are host administration, other people's devices, or grant
 * machinery.
 */
const DENIED_PREFIXES: readonly string[] = [
  "/api/issues",
  "/api/bang-commands",
  "/api/env-settings",
  "/api/server",
  "/api/server-admin",
  "/api/devices",
  "/api/device-bridge",
  "/api/computer-control",
  "/api/public-shares",
  "/api/public-file-shares",
  "/api/sharing",
  "/api/vhost",
  "/api/apps",
  "/api/security",
  "/api/host-agent-processes",
  "/api/agents",
  "/api/local-file",
  "/api/local-image",
  "/api/file-edit",
  "/api/artifacts",
  "/api/glossary-artifacts",
  "/api/debug",
  "/api/dev",
  "/api/remote-access",
  "/api/network-binding",
  "/api/browser-debug",
  "/api/browser-settings-backup",
  "/api/connections",
  "/api/review",
  "/api/workstreams",
  "/api/supervisor",
  "/api/desktop",
  "/api/onboarding",
  "/api/speech-vocabulary",
  "/api/experimental",
];

/** Identity and catalog reads every principal needs to render the app. */
const PUBLIC_GET_PREFIXES: readonly string[] = [
  "/api/version",
  "/api/server-info",
  "/api/providers",
  "/api/provider-catalog",
  "/api/provider-host",
  "/api/auth/status",
  "/api/users/me",
  "/api/push/vapid-public-key",
  "/api/push/settings",
  "/api/push/subscriptions",
  "/api/browser-profiles",
  "/api/client",
  // Pinned third-party renderer code; no project content.
  "/api/pdfjs",
];

/** Writes that only touch the caller's own device or identity. */
const SELF_WRITE_PATHS: readonly string[] = [
  "/api/users/logout",
  "/api/auth/logout",
  "/api/push/subscribe",
  "/api/push/unsubscribe",
  "/api/client-logs",
];

/**
 * Status reads every client polls, carrying no project content: whether
 * onboarding is done, and whether public sharing is configured at all.
 * Listed ahead of the denied families they sit under.
 */
const READ_ONLY_STATUS_PATHS: readonly string[] = [
  "/api/onboarding",
  "/api/public-shares/status",
  "/api/status/workers",
  // Dev-server-only reload signals; absent from a production build.
  "/api/dev/status",
  "/api/dev/safe-restart",
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hasPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Session-scoped mutations a joiner may perform: sending and shaping turns in
 * an existing session. Anything else about a session (terminate, rewind,
 * fork, clone, archive, move) needs the project's new-session grant.
 */
const JOIN_SESSION_ACTIONS = new Set([
  "messages",
  "input",
  "mode",
  "mark-seen",
  "deferred",
  "steering",
  "pending-input",
  "interrupt",
  "approve",
  "approvals",
  "permissions",
  "queue",
  // Attaching an image or document is part of composing that turn.
  "upload",
]);

export interface LimitedRouteRequest {
  method: string;
  /** The routed path: percent-decoded as the router matches it, no query. */
  path: string;
}

/** One path segment as the router's param decoding reads it, or null. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Decide what a limited principal's request needs, or that it is refused. */
export function decideLimitedRoute(
  request: LimitedRouteRequest,
): LimitedRouteDecision {
  const { path } = request;
  const method = request.method.toUpperCase();
  const isRead = READ_METHODS.has(method);

  if (path === "/health") return { kind: "allow" };
  if (path === "/api/ws") {
    // The websocket upgrade itself. What may be subscribed over it, and what
    // its tunneled requests may do, is decided per message and per request by
    // this same policy.
    return { kind: "allow" };
  }
  if (!path.startsWith("/api/")) {
    // Static client assets and the SPA shell; nothing principal-specific.
    return { kind: "allow" };
  }
  if (READ_ONLY_STATUS_PATHS.includes(path)) {
    // Status reads with no project content. Refusing them would only make a
    // limited user's console a stream of 403s from polls the client makes
    // for everyone.
    return isRead ? { kind: "allow" } : { kind: "deny" };
  }
  if (hasPrefix(path, DENIED_PREFIXES)) return { kind: "deny" };

  if (SELF_WRITE_PATHS.includes(path)) return { kind: "allow" };
  if (path.startsWith("/api/users")) {
    // Everything else under user administration is the superuser's.
    return path === "/api/users/me" && isRead
      ? { kind: "allow" }
      : { kind: "deny" };
  }
  if (path.startsWith("/api/auth")) {
    return path === "/api/auth/status" && isRead
      ? { kind: "allow" }
      : { kind: "deny" };
  }
  if (path === "/api/settings") {
    // Read the settings document, never write it. The route answers a
    // limited user with its projection, which withholds secrets and host
    // inventory. Every settings subpath (browser backup, remote executors,
    // cache-billing events, file-access and host-awake status) is host
    // administration and falls to the default deny below.
    return isRead ? { kind: "allow" } : { kind: "deny" };
  }
  if (hasPrefix(path, PUBLIC_GET_PREFIXES)) {
    return isRead ? { kind: "allow" } : { kind: "deny" };
  }

  const projectScoped = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
  if (projectScoped) {
    const projectId = decodeSegment(projectScoped[1] as string);
    if (projectId === null) return { kind: "deny" };
    const rest = projectScoped[2] ?? "";
    if (rest === "/sessions" || rest === "/sessions/create") {
      // Creating a session in this project. Checked before the session-scoped
      // match below, whose `[^/]+` would otherwise read "create" as an id.
      return isRead
        ? { kind: "project", projectId, required: "view" }
        : { kind: "project", projectId, required: "new-session" };
    }
    const sessionScoped = rest.match(/^\/sessions\/([^/]+)(\/(.*))?$/);
    if (sessionScoped) {
      const sessionId = decodeSegment(sessionScoped[1] as string);
      if (sessionId === null) return { kind: "deny" };
      const action = (sessionScoped[3] ?? "").split("/")[0] ?? "";
      if (isRead) {
        return { kind: "session", sessionId, required: "view" };
      }
      return {
        kind: "session",
        sessionId,
        required: JOIN_SESSION_ACTIONS.has(action) ? "join" : "new-session",
      };
    }
    return {
      kind: "project",
      projectId,
      required: isRead ? "view" : "new-session",
    };
  }

  if (path === "/api/projects") {
    if (isRead) return { kind: "allow-filtered", filter: "projects" };
    // POST adds a project. Whether this user may add one, and where, is a
    // path question this pure decision cannot see: the route holds them to
    // their configured directory and refuses when they have none
    // (routes/project-creation.ts, topics/limited-users.md § Delivery v1).
    if (method === "POST") return { kind: "allow" };
    return { kind: "deny" };
  }

  if (path === "/api/sessions") {
    // GET is the global session list; POST would start a detached session in
    // the hidden "No Project" workspace, which is the superuser's.
    return isRead
      ? { kind: "allow-filtered", filter: "sessions" }
      : { kind: "deny" };
  }

  const sessionScoped = path.match(/^\/api\/sessions\/([^/]+)(\/(.*))?$/);
  if (sessionScoped) {
    const sessionId = decodeSegment(sessionScoped[1] as string);
    if (sessionId === null) return { kind: "deny" };
    const action = (sessionScoped[3] ?? "").split("/")[0] ?? "";
    if (isRead) return { kind: "session", sessionId, required: "view" };
    return {
      kind: "session",
      sessionId,
      required: JOIN_SESSION_ACTIONS.has(action) ? "join" : "new-session",
    };
  }
  if (path === "/api/inbox" || path.startsWith("/api/inbox/")) {
    return isRead
      ? { kind: "allow-filtered", filter: "inbox" }
      : { kind: "deny" };
  }
  if (path === "/api/recents") {
    // The recents list is the install's, shared with the superuser: reading
    // it is filtered, clearing it is refused.
    return isRead
      ? { kind: "allow-filtered", filter: "recents" }
      : { kind: "deny" };
  }
  if (path === "/api/recents/visit" && method === "POST") {
    // Every session page posts its visit. The route records nothing for a
    // limited user and says so, rather than every open drawing a 403.
    return { kind: "allow" };
  }
  if (path === "/api/processes") {
    return isRead
      ? { kind: "allow-filtered", filter: "processes" }
      : { kind: "deny" };
  }
  // `/api/activity/*` is not listed: its REST reads are watcher status and
  // every connected tab and browser profile, host inventory that carries no
  // project to filter by. The activity channel itself runs over /api/ws.
  if (path === "/api/project-queue") {
    return isRead
      ? { kind: "allow-filtered", filter: "projects" }
      : { kind: "deny" };
  }
  const promoteNow = path.match(/^\/api\/project-queue\/([^/]+)\/promote-now$/);
  if (promoteNow && method === "POST") {
    const projectId = decodeSegment(promoteNow[1] as string);
    if (projectId === null) return { kind: "deny" };
    return { kind: "project", projectId, required: "new-session" };
  }
  // Pausing and resuming dispatch are host-wide, and nothing else under
  // /api/project-queue is listed.

  return { kind: "deny" };
}

/** Whether a grant level satisfies what the route needs. */
export function satisfies(
  level: ProjectAccessLevel,
  required: RequiredAccess,
): boolean {
  switch (required) {
    case "view":
      return level !== "none";
    case "join":
      return level === "join" || level === "new-session";
    case "new-session":
      return level === "new-session";
  }
}

/** Access a limited user has to one project, from their grants. */
export function levelFor(
  grants: LimitedUserGrants,
  projectId: string,
): ProjectAccessLevel {
  return projectAccessLevel(grants, projectId);
}
