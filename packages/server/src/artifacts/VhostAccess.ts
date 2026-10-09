import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import {
  VHOST_OAUTH_FLOW_COOKIE,
  VHOST_OAUTH_SESSION_COOKIE,
} from "./VhostOauth.js";
import {
  vhostExternalProtocol,
  vhostPasswordMatches,
  type ArtifactVhost,
  type ArtifactVhostSite,
} from "./vhosts.js";

const COOKIE = "ya_app_access";
export const APP_ACCESS_QUERY = "ya_access";

export type AppAccessTarget =
  | ArtifactVhost
  | ArtifactVhostSite
  | { name: string; projectId: string; generation?: string; public?: boolean };

/** The password of a Basic `Authorization` header; the user name is ignored. */
function basicPassword(request: Request): string | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) return;
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon < 0 ? undefined : decoded.slice(colon + 1);
}

/** Durable, app-scoped bearer links. Restart never rotates credentials. */
export class VhostAccess {
  readonly ready: Promise<void>;
  private secret = randomBytes(32);
  private generations: Record<string, number> = {};
  private writing = Promise.resolve();
  constructor(
    private readonly directory?: string,
    private readonly onRevoke?: (row: AppAccessTarget) => void,
  ) {
    this.ready = this.load();
  }
  private async load() {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "app-access.key");
    const staging = `${path}.${randomUUID()}`;
    await writeFile(staging, this.secret, { flag: "wx", mode: 0o600 });
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await unlink(staging);
    }
    this.secret = await readFile(path);
    if (this.secret.length !== 32)
      throw new Error("Invalid persisted app access key");
    try {
      const value: unknown = JSON.parse(
        await readFile(join(this.directory, "app-access.json"), "utf8"),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.values(value).every(
          (entry) => Number.isSafeInteger(entry) && Number(entry) >= 0,
        )
      )
        throw new Error("Invalid persisted app access generations");
      this.generations = value as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private generation(name: string): number {
    return Object.hasOwn(this.generations, name) ? this.generations[name]! : 0;
  }
  token(row: AppAccessTarget): string {
    return createHmac("sha256", this.secret)
      .update(
        JSON.stringify(
          "projectId" in row && !("path" in row)
            ? [
                "project-app-access-v1",
                row.name,
                row.projectId,
                row.generation ?? null,
                this.generation(row.name),
              ]
            : "path" in row
              ? [
                  "vhost-site-access-v1",
                  row.name,
                  row.path,
                  this.generation(row.name),
                ]
              : [
                  "vhost-access-v1",
                  row.name,
                  row.port,
                  this.generation(row.name),
                ],
        ),
      )
      .digest("base64url");
  }
  async rotate(row: AppAccessTarget) {
    await this.ready;
    const operation = this.writing.then(async () => {
      const next = {
        ...this.generations,
        [row.name]: this.generation(row.name) + 1,
      };
      if (this.directory) {
        const file = join(this.directory, "app-access.json");
        await writeFileAtomically(file, JSON.stringify(next));
      }
      this.generations = next;
      this.onRevoke?.(row);
    });
    this.writing = operation;
    await operation;
  }
  /**
   * Whether a password-protected public row admits this request by its Basic
   * password. False without a password to check or when the app link or
   * cookie already admits it, so the slow hash runs only when it decides.
   */
  async passwordAdmits(
    request: Request,
    row: ArtifactVhostSite,
  ): Promise<boolean> {
    if (!row.public || !row.passwordHash) return false;
    const url = new URL(request.url);
    const cookie = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const supplied = url.searchParams.get(APP_ACCESS_QUERY) ?? cookie;
    const expected = this.token(row);
    if (
      supplied &&
      Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return false;
    const password = basicPassword(request);
    return (
      password !== undefined &&
      (await vhostPasswordMatches(row.passwordHash, password))
    );
  }
  /** Validate the URL bearer or a host-only cookie; never pass either upstream. */
  authorize(
    request: Request,
    row: AppAccessTarget,
    passwordVerified = false,
    identityAdmitted = false,
  ): { request: Request; cookie?: string } | null {
    const url = new URL(request.url);
    const bearer = url.searchParams.get(APP_ACCESS_QUERY);
    const cookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim());
    const cookie = cookies
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const supplied = bearer ?? cookie;
    const expected = this.token(row);
    const linked =
      !!supplied &&
      Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    // A password gates the visitors a public row would admit without a link;
    // an app link still works on its own. The caller checks the password
    // (`passwordAdmits`), which is slow by design.
    const passwordHash = "passwordHash" in row ? row.passwordHash : undefined;
    const open = row.public === true && (!passwordHash || passwordVerified);
    if (!linked && !open && !identityAdmitted) return null;
    const browserOrigin = `${vhostExternalProtocol(url.hostname)}://${url.host}`;
    if (
      !open &&
      !bearer &&
      (!["GET", "HEAD", "OPTIONS"].includes(request.method) ||
        request.headers.has("upgrade")) &&
      request.headers.get("origin") !== browserOrigin
    )
      return null;
    url.searchParams.delete(APP_ACCESS_QUERY);
    const headers = new Headers(request.headers);
    const otherCookies = cookies.filter(
      (part) =>
        part &&
        ![
          COOKIE,
          VHOST_OAUTH_FLOW_COOKIE,
          VHOST_OAUTH_SESSION_COOKIE,
          "yep-anywhere-session",
          "yep-anywhere-desktop-session",
        ].some((name) => part.startsWith(`${name}=`)),
    );
    if (otherCookies.length) headers.set("cookie", otherCookies.join("; "));
    else headers.delete("cookie");
    headers.delete("referer");
    headers.delete("x-desktop-token");
    headers.delete("authorization");
    return {
      request: new Request(url, {
        method: request.method,
        headers,
        body: request.body,
        ...(request.body ? { duplex: "half" } : {}),
      }),
      // The cookie spares a password visitor a check on every asset.
      ...(!identityAdmitted &&
      (bearer || passwordVerified) &&
      !(row.public && !passwordHash)
        ? {
            cookie: `${COOKIE}=${expected}; Path=/; HttpOnly; SameSite=None; Secure`,
          }
        : {}),
    };
  }
}
