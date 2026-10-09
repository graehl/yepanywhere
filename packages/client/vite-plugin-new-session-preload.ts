import { resolve } from "node:path";
import { normalizePath, type Plugin } from "vite";

/** Start the local new-session route's existing chunks during HTML parsing. */
export function newSessionPreloadPlugin(): Plugin {
  let root: string;
  let base: string;
  return {
    name: "vite-plugin-new-session-preload",
    apply: "build",
    configResolved(config) {
      root = config.root;
      base = config.base;
    },
    transformIndexHtml(html, context) {
      if (!/(?:^|\/)index\.html$/.test(context.filename) || !context.bundle) {
        return html;
      }
      const bundle = context.bundle;
      const modules = [
        "src/App.tsx",
        "src/layouts/index.ts",
        "src/pages/NewSessionPage.tsx",
      ];
      const files = new Set<string>();
      const visit = (file: string) => {
        if (files.has(file)) return;
        const chunk = bundle[file];
        if (chunk?.type !== "chunk") return;
        files.add(file);
        for (const dependency of chunk.imports) visit(dependency);
      };
      for (const module of modules) {
        const id = normalizePath(resolve(root, module));
        const chunk = Object.values(bundle).find(
          (output) =>
            output.type === "chunk" && Object.hasOwn(output.modules, id),
        );
        if (!chunk)
          throw new Error(
            `New-session preload has no built chunk for ${module}`,
          );
        visit(chunk.fileName);
      }
      const script = `(() => {
        const base = new URL(${JSON.stringify(base)}, location.href);
        if (!location.pathname.startsWith(base.pathname)) return;
        const route = location.pathname.slice(base.pathname.replace(/\\/$/, "").length);
        if (!/^\\/new-session\\/?$/.test(route)) return;
        for (const file of ${JSON.stringify([...files])}) {
          const link = document.createElement("link");
          link.rel = "modulepreload";
          link.crossOrigin = "";
          link.href = new URL(file, base).href;
          document.head.appendChild(link);
        }
      })();`;
      return html.replace(
        "</head>",
        `<script data-new-session-preload>${script}</script>\n</head>`,
      );
    },
  };
}
