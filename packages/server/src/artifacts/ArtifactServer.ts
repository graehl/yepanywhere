import { randomBytes, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, relative, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { AppWebSocketProxy } from "./AppWebSocketProxy.js";
import { getRequestListener } from "@hono/node-server";
import {
  ARTIFACT_SANDBOX,
  ARTIFACT_TAB_PROTOCOL,
  MCP_APP_PROXY_PATH,
} from "@yep-anywhere/shared";
import { FRAME_FIND_AGENT_SCRIPT } from "@yep-anywhere/shared/find/frameFindAgent.generated";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getMimeType } from "hono/utils/mime";
import {
  isPathInsideDirectory,
  type createLocalResourcePathPolicy,
} from "../routes/local-resource-policy.js";
import { openMutableFileSnapshot } from "../routes/mutable-file-cache.js";
import { validateArtifactConfig, type ArtifactConfig } from "./config.js";
import {
  deletableDirectory,
  GrantStore,
  type PendingDeletion,
  type StoredGrant,
} from "./GrantStore.js";
import {
  registerArtifactOrigins,
  setVhostHostnames,
} from "../middleware/allowed-hosts.js";
import { fileBytesResponse } from "./fileResponse.js";
import {
  MCP_APP_PROXY_DOCUMENT,
  mcpAppViewCsp,
  parseMcpAppCspParam,
} from "./mcpAppProxy.js";
import { proxyLoopbackVhost } from "./vhost-proxy.js";
import { linkedVhostSite, serveVhostSite } from "./VhostSiteServer.js";
import {
  configuredVhostNames,
  matchVhost,
  SESSION_APP_NAME_PREFIX,
  type ArtifactVhostSite,
  vhostHostnames,
} from "./vhosts.js";
import { VhostAccess } from "./VhostAccess.js";
import { VhostOauth } from "./VhostOauth.js";
import type { ProjectAppDelivery } from "./ProjectAppDelivery.js";
import { hostnameFromHostHeader } from "./vhosts.js";

const MAX_GRANTS = 256;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/**
 * Stand-in served to a sandboxed frame that navigated to a PDF. The frame may
 * not open popups or download, so its buttons ask the YA viewer to open this
 * same URL in a new tab; the page's own address is the fallback.
 */
function pdfInFrameDocument(name: string): string {
  const protocol = JSON.stringify(ARTIFACT_TAB_PROTOCOL);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(name)}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;color:#222;background:#fafafa}p{margin:0 0 12px}.actions{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;padding:6px 12px}code{word-break:break-all;user-select:all}</style></head><body><p><strong>${escapeHtml(name)}</strong> is a PDF. The embedded preview cannot display PDFs, so open it in its own tab.</p><p class="actions"><button type="button" id="open">Open PDF in a new tab</button><button type="button" id="download">Download</button><button type="button" onclick="history.back()">Back</button></p><p>If nothing opens, copy this address into a new tab: <code id="address"></code></p><script>(function(){var url=new URL(location.href);url.hash="";url.search="";document.getElementById("address").textContent=url.href;function send(download){var target=new URL(url.href);if(download)target.searchParams.set("download","true");parent.postMessage({protocol:${protocol},type:"open",url:target.href},"*");}document.getElementById("open").onclick=function(){send(false);};document.getElementById("download").onclick=function(){send(true);};})();</script></body></html>`;
}
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/**
 * Appended to HTML framed by a YA viewer so the viewer's find field can search
 * that document alone. Content after `</html>` still parses into the body.
 */
const FIND_AGENT_TAIL = Buffer.from(
  `\n<script data-yep-find-agent>${FRAME_FIND_AGENT_SCRIPT}</script>\n`,
);
const ARTIFACT_CSP = [
  `sandbox ${ARTIFACT_SANDBOX}`,
  "default-src 'self' data: blob: http: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
  "style-src 'self' 'unsafe-inline' data: blob: http: https:",
  "connect-src 'self' http: https: ws: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");
/**
 * The isolated-origin policy every artifact and file-vhost response carries.
 * Every feature named in the permissions policy is one browsers actually
 * recognize: an unknown name is ignored anyway, and Chromium logs it as an
 * error in the reader's console for every artifact they open. Web Bluetooth
 * is the name that costs more noise than it denies.
 */
const ARTIFACT_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": ARTIFACT_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), serial=(), display-capture=()",
};

interface Grant extends StoredGrant {
  files: Set<string>;
}

/** How often expiry is noticed without traffic; deletions owe a deadline. */
const SWEEP_MS = 60_000;

export interface ArtifactServerOptions {
  /** Where grants and pending deletions survive a restart. */
  stateDir?: string;
  /** Directories an owning grant may never delete, whatever a caller says. */
  protectedPaths?: readonly (string | undefined)[];
  /**
   * The server user's home directory, which is always protected; defaults to
   * the host's.
   */
  homeDirectory?: string;
}

/** A loopback port of one sandboxed session, offered under a minted name. */
interface SessionApp {
  name: string;
  sessionId: string;
  port: number;
}

/**
 * The broker socket reaching `sessionId`'s current sandbox loopback, or null
 * when the session has no live firewalled process with a broker.
 */
export type SessionAppUpstream = (sessionId: string) => string | null;

const MAX_SESSION_APPS = 256;

export class ArtifactServer {
  readonly vhostAccess: VhostAccess;
  readonly vhostOauth: VhostOauth;
  readonly app = new Hono();
  /** Expired grants are deleted on access and on each new grant; revoked ones at once. */
  private readonly grants = new Map<string, Grant>();
  /** Bounded by `MAX_SESSION_APPS`. */
  private readonly sessionApps = new Map<string, SessionApp>();
  /**
   * Every name ever minted stays excluded from YA's host trust until exit,
   * as configured app hosts do, even after its session app is gone.
   */
  private readonly mintedSessionAppHosts = new Set<string>();
  private sessionAppUpstream: SessionAppUpstream = () => null;
  private projectAppDelivery?: ProjectAppDelivery;
  private fileSiteAdmitted: (site: ArtifactVhostSite) => boolean = (site) =>
    !site.ownerUsername;
  /** One host per served project. */
  private readonly projectHosts = new Set<string>();
  private listener: Server | undefined;
  private listening = false;
  private readonly appSockets = new AppWebSocketProxy();

  private readonly store: GrantStore;
  private readonly protectedPaths: readonly (string | undefined)[];
  private deletions: PendingDeletion[] = [];
  private sweepTimer?: ReturnType<typeof setInterval>;
  /** Restore runs once; every path that reads grants waits for it. */
  readonly ready: Promise<void>;

  constructor(
    public config: ArtifactConfig,
    private readonly policy: ReturnType<typeof createLocalResourcePathPolicy>,
    options: ArtifactServerOptions = {},
  ) {
    this.config = validateArtifactConfig(config);
    this.store = new GrantStore(options.stateDir);
    this.protectedPaths = [
      ...(options.protectedPaths ?? []),
      options.homeDirectory ?? homedir(),
    ];
    this.vhostAccess = new VhostAccess(options.stateDir, (row) =>
      this.appSockets.revokeApp(row.name),
    );
    this.vhostOauth = new VhostOauth(
      options.stateDir,
      () => this.config,
      (row) => this.vhostAccess.token(row),
      () => this.appSockets.close(),
    );
    this.ready = Promise.all([
      this.restore(),
      this.vhostAccess.ready,
      this.vhostOauth.ready,
    ]).then(() => {});
    // Startup restores and saves before any caller awaits readiness, so a
    // failed state write would otherwise reject with no handler attached and
    // take down the process. Report it here; `ready` still rejects for the
    // request paths that await it.
    this.ready.catch((error: unknown) =>
      console.warn("[ArtifactServer] Grant state unavailable:", error),
    );
    this.registerHosts(this.config);
    this.app.use("*", async (c, next) => {
      await this.ready;
      if (!this.matchesHost(c.req.header("Host") ?? new URL(c.req.url).host))
        return c.text("Unknown artifact host", 421);
      for (const [name, value] of Object.entries(ARTIFACT_RESPONSE_HEADERS))
        c.header(name, value);
      if (
        c.req.method !== "GET" &&
        c.req.method !== "HEAD" &&
        !c.req.path.startsWith("/p/")
      )
        return c.text("Read only", 405);
      await next();
      // Proxy and file responses carry their own Headers; enforce the
      // isolated-origin policy after dispatch so they cannot replace it.
      for (const [name, value] of Object.entries(ARTIFACT_RESPONSE_HEADERS))
        c.res.headers.set(name, value);
      if (c.req.path.startsWith("/p/"))
        c.res.headers.set(
          "Content-Security-Policy",
          ARTIFACT_CSP.replace(
            `sandbox ${ARTIFACT_SANDBOX}`,
            "sandbox allow-scripts",
          ),
        );
      // The proxy's policy is the framed view's: the spec's restrictive
      // default plus only the origins the view's resource declared.
      if (c.req.path === MCP_APP_PROXY_PATH)
        c.res.headers.set(
          "Content-Security-Policy",
          mcpAppViewCsp(parseMcpAppCspParam(c.req.query("csp"))),
        );
    });
    this.app.get("/health", (c) => {
      c.header("Access-Control-Allow-Origin", "*");
      return c.json({ artifactViewer: 1 });
    });
    this.app.get(MCP_APP_PROXY_PATH, (c) => c.html(MCP_APP_PROXY_DOCUMENT));
    this.app.all("/p/:token/*", async (c) =>
      this.projectAppDelivery
        ? this.projectAppDelivery.dispatchPath(c.req.raw, c.req.param("token"))
        : c.notFound(),
    );
    this.app.get("/a/:token/*", async (c) => {
      const grant = this.grants.get(c.req.param("token"));
      if (!grant || grant.expiresAt <= Date.now()) {
        if (grant) this.grants.delete(grant.token);
        return c.notFound();
      }
      const prefix = `/a/${grant.token}/`;
      const encoded = new URL(c.req.url).pathname.slice(prefix.length);
      let relative: string;
      try {
        relative = decodeURIComponent(encoded);
      } catch {
        return c.text("Invalid artifact path", 400);
      }
      if (
        !relative ||
        relative.includes("\\") ||
        relative.includes("\0") ||
        relative
          .split("/")
          .some((part) => part === ".." || part.startsWith("."))
      ) {
        return c.text("Invalid artifact path", 400);
      }
      const candidate = resolve(grant.root, relative);
      if (!isPathInsideDirectory(candidate, grant.root)) return c.notFound();
      let canonical: string;
      try {
        canonical = await realpath(candidate);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          return c.notFound();
        throw error;
      }
      if (!isPathInsideDirectory(canonical, grant.root)) return c.notFound();
      const allowed = await this.policy.resolveAllowedFilePath(canonical);
      if (!allowed.ok) return c.text(allowed.error, allowed.status);
      if (!grant.files.has(canonical) && grant.files.size >= 1024)
        return c.text("Artifact file limit reached", 413);
      const snapshot = await openMutableFileSnapshot(canonical);
      if (!snapshot) return c.notFound();
      const { handle, stats } = snapshot;
      if (stats.size > MAX_FILE_BYTES) {
        await handle.close();
        return c.text("Artifact file exceeds 64 MiB", 413);
      }
      grant.files.add(canonical);
      const mime = getMimeType(canonical) ?? "application/octet-stream";
      // Chromium refuses its PDF viewer inside a sandboxed frame and shows
      // "This content is blocked", so a frame navigation to a PDF gets a page
      // that opens the same URL in a top-level tab instead. Direct fetches,
      // top-level tabs, and explicit downloads still receive the bytes.
      if (
        mime === "application/pdf" &&
        c.req.header("Sec-Fetch-Dest") === "iframe" &&
        new URL(c.req.url).searchParams.get("download") !== "true"
      ) {
        await handle.close();
        return c.html(pdfInFrameDocument(basename(canonical)));
      }
      // Only a frame navigation gets the find agent: downloads, top-level
      // tabs, fetches and range reads still receive the original bytes.
      // XHTML is left alone, since an appended element would make it invalid.
      if (
        mime.startsWith("text/html") &&
        c.req.header("Sec-Fetch-Dest") === "iframe" &&
        new URL(c.req.url).searchParams.get("download") !== "true" &&
        !c.req.header("Range")
      ) {
        c.header("Content-Type", mime);
        if (c.req.method === "HEAD") {
          await handle.close();
          c.header(
            "Content-Length",
            String(stats.size + FIND_AGENT_TAIL.length),
          );
          return c.body(null, 200);
        }
        const framed = Buffer.concat([
          await handle.readFile(),
          FIND_AGENT_TAIL,
        ]);
        await handle.close();
        c.header("Content-Length", String(framed.length));
        return c.body(framed, 200);
      }
      return fileBytesResponse(c.req.raw, handle, stats, mime);
    });
  }

  /**
   * Adopt saved grants, drop the ones that expired while the server was down,
   * and settle anything they owed. A grant that expired unnoticed still owes
   * its deletion, so the queue is read before the first request is served.
   */
  private async restore(): Promise<void> {
    const state = await this.store.load();
    const now = Date.now();
    this.deletions = state.deletions;
    for (const stored of state.grants) {
      if (stored.expiresAt > now) {
        this.grants.set(stored.token, { ...stored, files: new Set() });
        continue;
      }
      if (stored.owned)
        this.owe(stored.root, stored.ownedFiles ?? [], stored.expiresAt);
    }
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref?.();
    await this.sweep();
  }

  private owe(root: string, files: readonly string[], dueAt: number): void {
    const existing = this.deletions.find((pending) => pending.root === root);
    // Two grants over one directory own the union of what each froze.
    if (existing) existing.files = [...new Set([...existing.files, ...files])];
    else this.deletions.push({ root, files: [...files], dueAt });
  }

  private persist(): Promise<void> {
    return this.store.save(
      [...this.grants.values()].map(({ files: _files, ...stored }) => stored),
      this.deletions,
    );
  }

  /** Expire grants, pay the deletions they owe, and save what remains. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt > now) continue;
      this.grants.delete(token);
      if (grant.owned)
        this.owe(grant.root, grant.ownedFiles ?? [], grant.expiresAt);
    }
    const due = this.deletions.filter((pending) => pending.dueAt <= now);
    if (due.length) {
      // A directory that failed to delete is dropped rather than retried
      // forever; the grant is gone either way and nothing is served from it.
      for (const pending of due)
        await GrantStore.deleteFrozen(pending.root, pending.files);
      this.deletions = this.deletions.filter((pending) => pending.dueAt > now);
    }
    await this.persist();
  }

  /** Awaitable sweep for callers that must observe the result. */
  async settleExpired(): Promise<void> {
    await this.ready;
    await this.sweep();
    await this.store.settled();
  }

  get available(): boolean {
    return (
      Boolean(this.config.localOrigin) || Boolean(this.config.publicOrigin)
    );
  }

  private shouldListen(config = this.config): boolean {
    return Boolean(config.publicOrigin) || Boolean(config.vhostPublicRoot);
  }

  private registerHosts(config: ArtifactConfig): void {
    registerArtifactOrigins([config.localOrigin, config.publicOrigin]);
    const minted = [...this.mintedSessionAppHosts].map((name) => ({
      name,
      port: 1,
    }));
    setVhostHostnames([
      ...this.projectHosts,
      ...vhostHostnames(
        [...(config.vhosts ?? []), ...(config.vhostSites ?? []), ...minted],
        config.vhostPublicRoot,
      ),
    ]);
  }

  /** Where session app upstreams resolve; set once the supervisor exists. */
  setSessionAppUpstream(resolve: SessionAppUpstream): void {
    this.sessionAppUpstream = resolve;
  }

  setProjectAppDelivery(delivery: ProjectAppDelivery): void {
    this.projectAppDelivery = delivery;
  }

  registerProjectHosts(hosts: readonly string[]): void {
    for (const host of hosts) this.projectHosts.add(host.toLowerCase());
    this.registerHosts(this.config);
  }

  /**
   * The minted app name offering `sessionId`'s loopback `port`, reusing the
   * name already minted for that pair. The name is private: its bearer comes
   * from `vhostAccess.token`, like any private app row's.
   */
  mintSessionApp(sessionId: string, port: number): SessionApp {
    for (const app of this.sessionApps.values()) {
      if (app.sessionId === sessionId && app.port === port) return app;
    }
    if (this.sessionApps.size >= MAX_SESSION_APPS) {
      // Oldest first: a Map iterates in insertion order.
      const oldest = this.sessionApps.keys().next().value;
      if (oldest !== undefined) this.sessionApps.delete(oldest);
    }
    const staticNames = new Set(configuredVhostNames(this.config));
    let name: string;
    do {
      name = `${SESSION_APP_NAME_PREFIX}${randomBytes(8).toString("hex")}`;
    } while (staticNames.has(name) || this.sessionApps.has(name));
    const app = { name, sessionId, port };
    this.sessionApps.set(name, app);
    this.mintedSessionAppHosts.add(name);
    this.registerHosts(this.config);
    return app;
  }

  /** What a file vhost rooted at the file `path` serves now. */
  async linkedSite(path: string, projectRoot?: string) {
    return linkedVhostSite(await realpath(path), this.policy, projectRoot);
  }

  setFileSiteAdmission(admitted: (site: ArtifactVhostSite) => boolean) {
    this.fileSiteAdmitted = admitted;
  }

  /** Whether the local file policy admits `path`, a file or directory. */
  async allowsPath(
    path: string,
  ): Promise<
    { ok: true } | { ok: false; error: string; status: 400 | 403 | 404 }
  > {
    const result = await this.policy.resolveAllowedDirectory(path);
    return result.ok
      ? { ok: true }
      : { ok: false, error: result.error, status: result.status };
  }

  matchesHost(host: string): boolean {
    return [this.config.localOrigin, this.config.publicOrigin].some(
      (origin) => origin && new URL(origin).host === host.toLowerCase(),
    );
  }

  matchesVhost(host: string | undefined) {
    return matchVhost(
      host,
      this.config.vhosts ?? [],
      this.config.vhostPublicRoot,
    );
  }

  /** A session app named by `host`; operator rows always match first. */
  private matchesSessionApp(host: string | undefined): SessionApp | undefined {
    const matched = matchVhost(
      host,
      [...this.sessionApps.values()].map(({ name, port }) => ({ name, port })),
      this.config.vhostPublicRoot,
    );
    return matched ? this.sessionApps.get(matched.name) : undefined;
  }

  async dispatchHost(
    request: Request,
    clientAddress?: string,
    proxy = proxyLoopbackVhost,
  ): Promise<Response | null> {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const callback = await this.vhostOauth.callback(request);
    if (callback) return callback;
    if (this.projectAppDelivery) {
      await this.projectAppDelivery.ready;
      if (this.projectHosts.has(hostnameFromHostHeader(host) ?? ""))
        return this.projectAppDelivery.dispatchHost(
          request,
          clientAddress,
          proxy,
        );
    }
    const site = matchVhost(
      host,
      this.config.vhostSites ?? [],
      this.config.vhostPublicRoot,
    );
    if (site) {
      await this.ready;
      if (!this.fileSiteAdmitted(site))
        return new Response("File address is not allowed", { status: 403 });
      const admission = await this.vhostOauth.admit(
        request,
        site,
        clientAddress,
      );
      if (admission instanceof Response) return admission;
      const authorized = this.vhostAccess.authorize(
        request,
        site,
        admission
          ? false
          : await this.vhostAccess.passwordAdmits(request, site),
        !!admission,
      );
      const response = authorized
        ? await serveVhostSite(authorized.request, site, this.policy)
        : site.public && site.passwordHash
          ? new Response("Password required", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Basic realm="${site.name}", charset="UTF-8"`,
              },
            })
          : new Response("App link required", { status: 401 });
      for (const [name, value] of Object.entries(ARTIFACT_RESPONSE_HEADERS))
        response.headers.set(name, value);
      if (authorized?.cookie)
        response.headers.append("Set-Cookie", authorized.cookie);
      return response;
    }
    const sessionApp = this.matchesVhost(host)
      ? undefined
      : this.matchesSessionApp(host);
    const vhost =
      this.matchesVhost(host) ??
      (sessionApp && { name: sessionApp.name, port: sessionApp.port });
    if (vhost) {
      await this.ready;
      const admission = await this.vhostOauth.admit(
        request,
        vhost,
        clientAddress,
      );
      if (admission instanceof Response) return admission;
      const authorized = this.vhostAccess.authorize(
        request,
        vhost,
        false,
        !!admission,
      );
      if (!authorized)
        return new Response("App link required", {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      let brokerSocket: string | undefined;
      if (sessionApp) {
        const upstream = this.sessionAppUpstream(sessionApp.sessionId);
        if (!upstream)
          return new Response(
            "This session's sandbox is not running, so its app is unavailable",
            {
              status: 503,
              headers: {
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
              },
            },
          );
        brokerSocket = upstream;
      }
      const response = await proxy(
        authorized.request,
        vhost.port,
        clientAddress,
        brokerSocket,
        admission?.expiresAt,
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      if (authorized.cookie)
        response.headers.append("Set-Cookie", authorized.cookie);
      return response;
    }
    if (this.matchesHost(host)) {
      if (request.headers.has("upgrade")) {
        const token = /^\/p\/([a-f0-9]{48})\//.exec(
          new URL(request.url).pathname,
        )?.[1];
        return token && this.projectAppDelivery
          ? this.projectAppDelivery.dispatchPath(request, token, proxy)
          : new Response("No app WebSocket target", { status: 404 });
      }
      return this.app.fetch(request);
    }
    return null;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    void this.appSockets.handle(request, socket, head, (incoming, proxy) =>
      this.dispatchHost(incoming, request.socket.remoteAddress, proxy),
    );
  }

  async configure(config: ArtifactConfig): Promise<void> {
    config = validateArtifactConfig(config, this.config.expiryDays, {
      ...this.config,
      vhostSites:
        config.vhostSites === undefined ? this.config.vhostSites : undefined,
    });
    const previous = this.config;
    await this.projectAppDelivery?.validateConfig(config);
    this.vhostOauth.validateConfig(config);
    this.vhostOauth.invalidate();
    this.appSockets.close();
    const deliveryChanged =
      config.port !== previous.port ||
      config.localOrigin !== previous.localOrigin ||
      config.publicOrigin !== previous.publicOrigin;
    const wasListening = this.listening;
    if (
      config.port !== previous.port ||
      (this.listening && !this.shouldListen(config))
    )
      await this.close();
    this.config = config;
    this.registerHosts(config);
    try {
      if (!this.listening && this.shouldListen(config)) await this.start();
      if (deliveryChanged) {
        // Changing where artifacts are served revokes outstanding links, and
        // an owning grant pays its deletion on revocation.
        for (const [token, grant] of this.grants) {
          this.grants.delete(token);
          if (grant.owned)
            this.owe(grant.root, grant.ownedFiles ?? [], Date.now());
        }
        void this.sweep();
      }
    } catch (error) {
      this.listener = undefined;
      this.config = previous;
      if (wasListening && !this.listening) await this.start();
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.listener) throw new Error("Artifact server already started");
    await new Promise<void>((resolveReady, reject) => {
      const listener = createServer(
        getRequestListener(async (request, env) => {
          return (
            (await this.dispatchHost(
              request,
              env.incoming.socket.remoteAddress,
            )) ?? this.app.fetch(request)
          );
        }),
      );
      this.listener = listener;
      listener.on("upgrade", (request, socket, head) =>
        this.handleUpgrade(request, socket, head),
      );
      listener.once("error", reject);
      listener.listen(this.config.port, "127.0.0.1", () => {
        listener.removeListener("error", reject);
        this.listening = true;
        resolveReady();
      });
    });
  }

  async close(): Promise<void> {
    this.appSockets.close();
    // Startup restores and writes state under stateDir; closing before that
    // settles lets a caller remove the directory mid-write. Its failure is
    // already reported by the constructor.
    await this.ready.catch(() => {});
    this.vhostOauth.invalidate();
    await this.vhostOauth.settled();
    this.listening = false;
    // Persisted grants outlive the process; only this listener stops here.
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    // A half-written state file would lose grants a caller already holds.
    await this.store.settled();
    this.grants.clear();
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>((resolveClosed, reject) =>
        listener.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
  }

  async createGrant(
    filePath: string,
    audience: "local" | "public",
    owned?: boolean,
    declaredRoot?: string,
  ) {
    await this.ready;
    const origin =
      audience === "local" ? this.config.localOrigin : this.config.publicOrigin;
    if (!origin)
      throw new HTTPException(409, {
        message: `No ${audience} artifact origin configured`,
      });
    const allowed = await this.policy.resolveAllowedFilePath(filePath);
    if (!allowed.ok)
      throw new HTTPException(allowed.status, { message: allowed.error });
    if (
      ![".html", ".htm"].includes(
        extname(allowed.file.resolvedPath).toLowerCase(),
      )
    ) {
      throw new HTTPException(400, {
        message: "Artifact entry must be an HTML file",
      });
    }
    const now = Date.now();
    for (const [token, grant] of this.grants)
      if (grant.expiresAt <= now) this.grants.delete(token);
    // Project callers supply the canonical, containment-checked root. Resolving
    // symlinks again here could accept a replacement pointing outside it.
    const root = declaredRoot
      ? resolve(declaredRoot)
      : dirname(allowed.file.resolvedPath);
    if (!isPathInsideDirectory(allowed.file.resolvedPath, root))
      throw new HTTPException(403, {
        message: "Artifact entry escapes declared root",
      });
    const entry = relative(root, allowed.file.resolvedPath)
      .split("\\")
      .join("/");
    const lifetimeMs = this.config.expiryDays! * 24 * 60 * 60 * 1000;
    // Ownership is refused rather than honoured for a directory that is
    // plainly not a disposable bundle; the grant is still created, borrowing.
    // Ownership is never inherited from configuration: a preview of a file
    // the user already had must not delete it when the viewer closes. Only a
    // caller that produced the directory says so, by asking.
    const wants = owned === true;
    // Borrowed grants outlive their viewers, so reopening a file must not
    // mint another one each time or the grant cap fills with duplicates.
    const live = wants
      ? undefined
      : this.reusableGrant(root, entry, now, lifetimeMs);
    if (live) return this.issue(live, origin, true);
    if (this.grants.size >= MAX_GRANTS) {
      const nextExpiry = Math.min(
        ...[...this.grants.values()].map((grant) => grant.expiresAt),
      );
      throw new HTTPException(429, {
        message: `Too many live artifact links (${MAX_GRANTS}); the next one expires at ${new Date(nextExpiry).toISOString()}`,
      });
    }
    const token = randomBytes(32).toString("base64url");
    // Ownership freezes the fileset: what is here now and is not the working
    // tree's own is what this grant may remove later, whatever else the
    // directory collects. Nothing left to own means nothing to own it.
    const frozen =
      wants && (await deletableDirectory(root, this.protectedPaths))
        ? await GrantStore.freeze(root)
        : null;
    const grant: Grant = {
      id: randomUUID(),
      token,
      root,
      entry,
      expiresAt: now + lifetimeMs,
      owned: frozen !== null,
      ...(frozen ? { ownedFiles: frozen } : {}),
      files: new Set(),
    };
    this.grants.set(token, grant);
    // The caller is handed a URL, so the grant must already be durable.
    await this.persist();
    return this.issue(grant, origin, false);
  }

  /**
   * A live borrowed grant for the same entry file, if one still has at least
   * half the configured lifetime left and no more than all of it: a viewer
   * opened on it is not cut off soon after, and shortening the expiry setting
   * is not undone by handing out an older, longer-lived link.
   */
  private reusableGrant(
    root: string,
    entry: string,
    now: number,
    lifetimeMs: number,
  ): Grant | undefined {
    let best: Grant | undefined;
    for (const grant of this.grants.values()) {
      if (grant.owned || grant.root !== root || grant.entry !== entry) continue;
      if (grant.expiresAt < now + lifetimeMs / 2) continue;
      if (grant.expiresAt > now + lifetimeMs) continue;
      if (!best || grant.expiresAt > best.expiresAt) best = grant;
    }
    return best;
  }

  private issue(grant: Grant, origin: string, reused: boolean) {
    return {
      id: grant.id,
      url: `${origin}/a/${grant.token}/${grant.entry.split("/").map(encodeURIComponent).join("/")}`,
      expiresAt: grant.expiresAt,
      owned: grant.owned,
      reused,
    };
  }

  /** Resolve an artifact URL for the authenticated source editor only. */
  async resolveSourceUrl(rawUrl: string): Promise<string> {
    await this.ready;
    const url = new URL(rawUrl);
    if (
      ![this.config.localOrigin, this.config.publicOrigin].includes(url.origin)
    )
      throw new HTTPException(403, { message: "Not an artifact origin" });
    const match = /^\/a\/([^/]+)\/(.+)$/.exec(url.pathname);
    const grant = match && this.grants.get(match[1]!);
    if (!match || !grant || grant.expiresAt <= Date.now())
      throw new HTTPException(404, {
        message: "Artifact grant expired or unavailable",
      });
    const relative = decodeURIComponent(match[2]!);
    if (
      relative.includes("\\") ||
      relative.includes("\0") ||
      relative.split("/").some((part) => part.startsWith("."))
    )
      throw new HTTPException(400, { message: "Invalid artifact path" });
    const path = await realpath(resolve(grant.root, relative));
    if (!isPathInsideDirectory(path, grant.root))
      throw new HTTPException(403, {
        message: "Artifact source outside granted directory",
      });
    return path;
  }

  /** Revoking an owning grant pays its deletion now, not at its old deadline. */
  async revoke(id: string): Promise<void> {
    await this.ready;
    for (const [token, grant] of this.grants)
      if (grant.id === id) {
        this.grants.delete(token);
        if (grant.owned)
          this.owe(grant.root, grant.ownedFiles ?? [], Date.now());
      }
    await this.sweep();
  }
}
