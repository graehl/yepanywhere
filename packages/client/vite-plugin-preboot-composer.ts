/**
 * Inline the pre-boot new-session composer into the app HTML.
 *
 * The script must run during parse, before any module request, so it is
 * inlined rather than referenced. It is read from one source file so the
 * local and remote entry documents cannot drift, and injected before the CSP
 * plugin's post-order pass so the production policy hashes it like any other
 * inline script.
 */

import { buildSync } from "esbuild";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const SOURCE = resolve(__dirname, "preboot/new-session-composer.js");
const ROOT_ELEMENT = '<div id="root"></div>';
const ENTRY_DOCUMENT = /(?:^|\/)(?:index|remote)\.html$/;

export function prebootComposerPlugin(): Plugin {
  return {
    name: "vite-plugin-preboot-composer",
    transformIndexHtml(html, context) {
      if (!ENTRY_DOCUMENT.test(context.filename ?? context.path ?? "")) {
        return html;
      }
      if (!html.includes(ROOT_ELEMENT)) {
        throw new Error(
          `preboot composer: ${context.filename} has no ${ROOT_ELEMENT}`,
        );
      }
      const script = buildSync({
        entryPoints: [SOURCE],
        bundle: true,
        write: false,
        format: "iife",
        minify: true,
        define: {
          "import.meta.env.VITE_IS_REMOTE_CLIENT": JSON.stringify(
            /(?:^|\/)remote\.html$/.test(context.filename),
          ),
        },
      }).outputFiles[0]!.text.trim();
      return html.replace(
        ROOT_ELEMENT,
        `${ROOT_ELEMENT}\n    <script>\n${script}\n    </script>`,
      );
    },
  };
}
