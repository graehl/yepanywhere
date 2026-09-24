/**
 * Vite plugin to inject Content Security Policy meta tag.
 *
 * In dev mode: Permissive CSP to allow HMR and local development
 * In prod mode: Strict CSP with hash for inline theme script
 */

import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/**
 * Compute SHA-256 hash of script content for CSP.
 */
function computeScriptHash(content: string): string {
  const hash = createHash("sha256").update(content, "utf8").digest("base64");
  return `'sha256-${hash}'`;
}

/**
 * Extract inline script content from HTML.
 * Returns the content between <script>...</script> tags (non-module scripts only).
 */
function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  // Match <script> tags that don't have type="module" or src attribute
  const scriptRegex =
    /<script(?![^>]*\btype\s*=\s*["']module["'])(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const content = match[1];
    if (content?.trim()) {
      scripts.push(content);
    }
  }
  return scripts;
}

interface CspPluginOptions {
  /**
   * Whether this is for the remote client (static hosting).
   * Remote client needs different connect-src to allow arbitrary server connections.
   */
  isRemote?: boolean;
}

/**
 * Keep fonts as same-origin files. Vite's default small-asset inlining can
 * otherwise produce data: font URLs that the deliberately strict font-src
 * policy rejects at runtime. Other asset types retain Vite's default limit.
 */
export function shouldInlineClientAsset(filePath: string): boolean | undefined {
  return /\.(?:otf|ttf|woff2?)(?:$|\?)/i.test(filePath) ? false : undefined;
}

export function cspPlugin(options: CspPluginOptions = {}): Plugin {
  const { isRemote = false } = options;
  let isDev = false;

  return {
    name: "vite-plugin-csp",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    transformIndexHtml: {
      order: "post", // Run after other transforms
      handler(html, context) {
        // play.html declares its own policy: it hosts an untrusted sandboxed
        // document whose srcdoc frame would inherit this strict one.
        if (/(?:^|\/)play\.html$/.test(context.filename ?? context.path ?? ""))
          return html;
        // Compute hashes for inline scripts
        const inlineScripts = extractInlineScripts(html);
        const scriptHashes = inlineScripts.map(computeScriptHash);

        // Build CSP directives
        const directives: string[] = [];

        // default-src: Fallback for unspecified directives
        directives.push("default-src 'self'");

        // script-src: Allow self + inline script hashes
        // In dev mode, Vite needs 'unsafe-inline' for HMR error overlay
        if (isDev) {
          directives.push("script-src 'self' 'unsafe-inline'");
        } else {
          const scriptSrc = ["'self'", ...scriptHashes].join(" ");
          directives.push(`script-src ${scriptSrc}`);
        }

        // style-src: Allow self + inline styles (Vite injects styles, plus critical CSS)
        directives.push("style-src 'self' 'unsafe-inline'");

        // connect-src: API calls and WebSocket connections
        if (isDev) {
          // Dev mode: Allow localhost WebSocket for HMR + any connections for testing
          directives.push("connect-src 'self' ws: wss: http: https:");
        } else if (isRemote) {
          // Remote client: Allow connections to any server (user specifies direct URLs)
          // This is necessary because users connect to their own servers via LAN/Tailscale
          directives.push("connect-src 'self' ws: wss: http: https:");
        } else {
          // Artifact health probes use an operator-configured separate origin.
          directives.push("connect-src 'self' ws: wss: http: https:");
        }

        // img-src: Allow self, data URIs (icons), and blob (uploads/previews)
        directives.push("img-src 'self' data: blob:");

        // font-src: self, plus blob for the file viewer's font specimens
        directives.push("font-src 'self' blob:");

        // media-src: Allow self and blob for audio/video
        directives.push("media-src 'self' blob:");

        // object-src: Block plugins (Flash, etc.)
        directives.push("object-src 'none'");

        // The preview validates the server-selected artifact origin before
        // embedding. Static hosted builds cannot know that origin at build time;
        // origins can also change while an already loaded client stays open.
        directives.push("frame-src 'self' blob: http: https:");

        // Note: frame-ancestors cannot be set via meta tag (per CSP spec).
        // It's set via HTTP header in the server instead.

        // form-action: Restrict form submissions
        directives.push("form-action 'self'");

        // base-uri: Restrict <base> tag
        directives.push("base-uri 'self'");

        // Build the CSP string
        const csp = directives.join("; ");

        // Inject CSP meta tag after <head>
        const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
        return html.replace("<head>", `<head>\n    ${metaTag}`);
      },
    },
  };
}
