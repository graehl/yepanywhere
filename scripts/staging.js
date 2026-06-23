#!/usr/bin/env node

/**
 * Staging server for yepanywhere.com
 *
 * Serves pre-built static assets (no dev servers, no file watchers):
 * - /         → site/dist/                      (marketing site, `astro build` output)
 * - /remote/  → packages/client/dist-remote/    (remote client app)
 *
 * This server spawns NO child processes — it is a plain static file server.
 * Rebuild the assets with scripts/deploy-staging.sh (which stops this service,
 * builds both bundles sequentially, and restarts it) whenever the source
 * changes. Running a build alongside a watcher used to swap-thrash remy, so the
 * watch/dev-server mode was intentionally removed.
 *
 * Usage:
 *   pnpm staging              # Default port 3000
 *   PORT=8080 pnpm staging    # Custom port
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { exitIfUnsafeHome } from "./safe-home.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

exitIfUnsafeHome({ entrypoint: "pnpm staging" });

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

const siteDistPath = path.join(rootDir, "site", "dist");
const remoteDistPath = path.join(rootDir, "packages/client/dist-remote");

// Content types for static files
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};

/**
 * Resolve requestPath under root, returning null if it escapes root
 * (path-traversal guard).
 */
function resolveWithin(root, requestPath) {
  const resolved = path.normalize(path.join(root, requestPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Serve a static file, always reading fresh from disk (no caching).
 * Falls back to fallbackPath (if given) on miss, otherwise 404.
 */
function serveFile(res, filePath, fallbackPath = null) {
  if (filePath === null) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const normalizedPath = path.normalize(filePath);

  fs.promises
    .stat(normalizedPath)
    .then((stat) => {
      if (stat.isFile()) {
        return fs.promises.readFile(normalizedPath);
      }
      throw new Error("Not a file");
    })
    .then((content) => {
      const ext = path.extname(normalizedPath).toLowerCase();
      const contentType = contentTypes[ext] || "application/octet-stream";

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end(content);
    })
    .catch(() => {
      if (fallbackPath) {
        serveFile(res, fallbackPath);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    });
}

/**
 * Serve the remote client app from dist-remote.
 * Unknown (extensionless) routes fall back to remote.html for SPA routing.
 */
function serveRemote(res, pathname) {
  let remotePath = pathname.slice("/remote".length) || "/";
  if (remotePath === "") remotePath = "/";

  const filePath = resolveWithin(remoteDistPath, remotePath);

  if (remotePath.endsWith("/") || !path.extname(remotePath)) {
    const indexPath = path.join(remoteDistPath, "remote.html");
    serveFile(res, filePath, indexPath);
  } else {
    serveFile(res, filePath);
  }
}

/**
 * Serve the marketing site from site/dist.
 * Astro is built with `format: "file"` + `trailingSlash: "never"`, so routes
 * map to flat files: "/" → index.html, "/news" → news.html.
 */
function serveSite(res, pathname) {
  if (pathname === "/" || pathname === "") {
    serveFile(res, resolveWithin(siteDistPath, "index.html"));
    return;
  }

  // Real files (assets, with an extension) are served directly.
  if (path.extname(pathname)) {
    serveFile(res, resolveWithin(siteDistPath, pathname));
    return;
  }

  // Clean URL → try "<path>.html", then "<path>/index.html", else 404.
  const htmlPath = resolveWithin(siteDistPath, `${pathname}.html`);
  const indexPath = resolveWithin(
    siteDistPath,
    path.join(pathname, "index.html"),
  );
  serveFile(res, htmlPath, indexPath);
}

/**
 * Handle incoming requests.
 */
function handleRequest(req, res) {
  let pathname;
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad request");
    return;
  }

  if (pathname === "/remote" || pathname.startsWith("/remote/")) {
    serveRemote(res, pathname);
    return;
  }

  serveSite(res, pathname);
}

/**
 * Verify the pre-built assets exist; exit with guidance if not. The systemd
 * unit has Restart=always, so a missing build surfaces as a clear, repeated log
 * line rather than silently serving 404s.
 */
function verifyBuilds() {
  const missing = [];
  if (!fs.existsSync(path.join(siteDistPath, "index.html"))) {
    missing.push("site/dist  (build: cd site && pnpm exec astro build)");
  }
  if (!fs.existsSync(path.join(remoteDistPath, "remote.html"))) {
    missing.push(
      "packages/client/dist-remote  (build: pnpm --filter client exec vite build --config vite.config.remote.ts --base /remote/)",
    );
  }
  if (missing.length > 0) {
    console.error("[Staging] Missing pre-built assets:");
    for (const m of missing) console.error(`  - ${m}`);
    console.error(
      "[Staging] Run scripts/deploy-staging.sh to build the assets and (re)start staging.",
    );
    process.exit(1);
  }
}

// Main
function main() {
  console.log("[Staging] Yepanywhere staging server (static)");

  verifyBuilds();

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log(`[Staging] Server running at http://localhost:${port}`);
    console.log("[Staging]   /         -> site/dist (marketing site)");
    console.log("[Staging]   /remote/  -> packages/client/dist-remote/");
  });
}

main();
