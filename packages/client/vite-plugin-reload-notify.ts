import { randomUUID } from "node:crypto";
import type { Plugin, ViteDevServer } from "vite";

const guardId = "virtual:ya-manual-reload";
const resolvedGuardId = `\0${guardId}`;
const generationPath = "/@ya/dev-generation";

function dynamicImports(
  node: unknown,
  positions: { offset: number; text: string }[] = [],
): { offset: number; text: string }[] {
  if (!node || typeof node !== "object") return positions;
  if (Array.isArray(node)) {
    for (const child of node) dynamicImports(child, positions);
    return positions;
  }
  const syntax = node as { type?: string; start: number; end: number };
  if (syntax.type === "ImportExpression") {
    positions.push(
      { offset: syntax.start, text: "__yaImportFresh(() => " },
      { offset: syntax.end, text: ")" },
    );
  }
  for (const child of Object.values(node)) dynamicImports(child, positions);
  return positions;
}

interface ReloadNotifyOptions {
  /** API endpoint to notify (default: /api/dev/frontend-changed) */
  endpoint?: string;
  /** Whether notifications are enabled (default: true) */
  enabled?: boolean;
}

/**
 * Vite plugin that notifies the backend when frontend files change.
 * Used in manual reload mode (NO_FRONTEND_RELOAD=true) to show a banner
 * instead of auto-reloading.
 */
export function reloadNotify(options: ReloadNotifyOptions = {}): Plugin {
  const { endpoint = "/api/dev/frontend-changed", enabled = true } = options;

  let server: ViteDevServer | null = null;
  let generation = randomUUID();

  return {
    name: "reload-notify",
    apply: "serve",
    enforce: "post",

    resolveId(id) {
      if (enabled && id === guardId) return resolvedGuardId;
    },

    load(id) {
      if (!enabled || id !== resolvedGuardId) return;
      // The guard has two possible answers and they are not the same event.
      // "The source generation moved" means a new import cannot safely join
      // this page's loaded graph. Reject that import with a manual-refresh
      // instruction; source edits must never navigate an existing tab.
      // "I could not ask" means the dev server is restarting or
      // busy, which says nothing about the source at all. Throwing on the
      // second one failed the whole route through Suspense and showed the
      // fatal client error screen, so a dev-server restart looked like a code
      // defect. Ask again a few times, then let the import proceed: a
      // possibly-stale chunk in development is a smaller harm than a dead
      // route, and the post-import check still catches a real move once the
      // server answers again.
      return `
const generation = ${JSON.stringify(generation)};
const ASK_TIMEOUT_MS = 2000;
const ASK_ATTEMPTS = 3;
const ASK_RETRY_MS = 250;
let warnedUnreachable = false;

async function askGeneration() {
  const response = await fetch(${JSON.stringify(generationPath)}, {
    cache: "no-store",
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("dev source version endpoint returned " + response.status);
  const current = await response.json();
  if (typeof current.generation !== "string") {
    throw new Error("dev source version endpoint returned no generation");
  }
  return current.generation;
}

async function checkGeneration() {
  let lastError;
  for (let attempt = 0; attempt < ASK_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, ASK_RETRY_MS));
    let current;
    try {
      current = await askGeneration();
    } catch (error) {
      lastError = error;
      continue;
    }
    warnedUnreachable = false;
    if (current !== generation) {
      throw new Error("Frontend source changed. Reload this tab when ready to load the updated page.");
    }
    return;
  }
  if (!warnedUnreachable) {
    warnedUnreachable = true;
    console.warn(
      "[reload-notify] The dev server did not answer the source-version check, so this module loaded unverified. " +
        "This is a dev-server availability problem, not a version mismatch: " +
        (lastError && lastError.message ? lastError.message : lastError),
    );
  }
}

export async function importFresh(load) {
  await checkGeneration();
  try {
    const result = await load();
    await checkGeneration();
    return result;
  } catch (error) {
    await checkGeneration();
    throw error;
  }
}`;
    },

    transform(code, id) {
      if (
        !enabled ||
        id.includes("node_modules") ||
        !/\.[cm]?[jt]sx?(?:\?|$)/.test(id)
      )
        return;
      // Guard acquisition itself: catching a render error is already too late.
      const positions = dynamicImports(this.parse(code));
      if (positions.length === 0) return;
      for (const { offset, text } of positions.sort(
        (a, b) => b.offset - a.offset,
      )) {
        code = code.slice(0, offset) + text + code.slice(offset);
      }
      return {
        code: `import { importFresh as __yaImportFresh } from "${guardId}";\n${code}`,
        map: null,
      };
    },

    configureServer(_server) {
      server = _server;
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== generationPath) return next();
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({ generation }));
      });
    },

    handleHotUpdate({ file, modules }) {
      if (!enabled || !server) {
        // Let Vite handle normally (HMR)
        return;
      }
      // A file no page has loaded (a test, a scratch file, a doc under the
      // client root) cannot leave any page running stale code, so it does
      // not move the generation. Moving it anyway made every loading tab
      // reload at its next lazy import, restarting the load while peers
      // wrote unrelated files.
      if (modules.length === 0) return [];

      // Get relative path from project root
      const relativePath = file.replace(`${server.config.root}/`, "");

      // Only notify for source files, not node_modules or dist
      if (
        relativePath.includes("node_modules") ||
        relativePath.includes("dist")
      ) {
        return;
      }

      generation = randomUUID();
      const guard = server.moduleGraph.getModuleById(resolvedGuardId);
      if (guard) server.moduleGraph.invalidateModule(guard);

      // Notify the backend about the file change
      const apiPort = process.env.VITE_API_PORT || process.env.PORT || "3400";
      const url = `http://localhost:${apiPort}${endpoint}`;

      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Yep-Anywhere": "true",
        },
        body: JSON.stringify({ files: [relativePath] }),
      }).catch((err) => {
        // Don't crash if backend is down
        console.warn(
          `[reload-notify] Failed to notify backend: ${err.message}`,
        );
      });

      // Return empty array to prevent HMR from updating
      // The user will manually reload instead
      return [];
    },
  };
}
