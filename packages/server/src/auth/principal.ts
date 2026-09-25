/**
 * The acting principal for a request: the superuser, or one limited user.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Settings → Users.
 *
 * Two independent facts decide it:
 * - the *login* principal, from the SRP identity of a relay tunnel or from
 *   the username recorded on a direct cookie session; and
 * - an *acting* override, a server-signed cookie a superuser sets to test
 *   what a limited user sees. The override is honored only when the login
 *   principal is the superuser, so a limited user cannot switch out of their
 *   own identity.
 */

import * as crypto from "node:crypto";
import type { LimitedUserGrants } from "@yep-anywhere/shared";

export const ACTING_USER_COOKIE = "yep-anywhere-acting-user";

export interface SuperuserPrincipal {
  kind: "superuser";
}

export interface LimitedPrincipal {
  kind: "limited";
  username: string;
  grants: LimitedUserGrants;
  /** True when a superuser switched into this user rather than logging in. */
  switched: boolean;
  /** True when the login itself was this limited user and cannot switch. */
  locked: boolean;
  /** How this principal's login arrived, for the logout destination. */
  via: "relay" | "direct";
}

export type Principal = SuperuserPrincipal | LimitedPrincipal;

export const SUPERUSER: SuperuserPrincipal = { kind: "superuser" };

/** Hono context variable key carrying the resolved principal. */
export const PRINCIPAL_VARIABLE = "yaPrincipal";

/**
 * Hono context variable key carrying the direct login's username: the name
 * recorded on the request's cookie session, or null for a superuser login, an
 * SRP tunnel, or no login. A websocket upgrade binds it to the connection.
 */
export const DIRECT_LOGIN_VARIABLE = "yaDirectLoginUsername";

export function isLimited(principal: Principal): principal is LimitedPrincipal {
  return principal.kind === "limited";
}

/**
 * Sign an acting-user value with the server's cookie secret. The cookie is
 * `<username>.<hmac>`; a client cannot mint one without the secret.
 */
export function signActingUser(username: string, secret: string): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update("yep-anywhere-acting-user\0")
    .update(username)
    .digest("hex");
  return `${username}.${mac}`;
}

/** Recover the username from a signed acting-user cookie, or null. */
export function verifyActingUser(
  value: string | undefined,
  secret: string,
): string | null {
  if (!value || !secret) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const username = value.slice(0, separator);
  const expected = signActingUser(username, secret);
  if (expected.length !== value.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value))) {
    return null;
  }
  return username;
}
