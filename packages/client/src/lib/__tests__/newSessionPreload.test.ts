// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build, type Rollup } from "vite";
import { expect, it } from "vitest";
import { cspPlugin } from "../../../vite-plugin-csp";
import { newSessionPreloadPlugin } from "../../../vite-plugin-new-session-preload";

it.each(["/", "/nested/"])(
  "preloads only the new-session static graph under %s",
  async (base) => {
    const root = await mkdtemp(resolve(tmpdir(), "ya-route-preload-"));
    try {
      await mkdir(resolve(root, "src/layouts"), { recursive: true });
      await mkdir(resolve(root, "src/pages"), { recursive: true });
      await writeFile(
        resolve(root, "index.html"),
        '<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
      );
      await writeFile(
        resolve(root, "src/main.ts"),
        'window.load = () => Promise.all([import("./App"), import("./layouts"), import("./pages/NewSessionPage")]);',
      );
      await writeFile(
        resolve(root, "src/shared.ts"),
        'export const shared = "shared";',
      );
      await writeFile(
        resolve(root, "src/App.tsx"),
        'export { shared } from "./shared";',
      );
      await writeFile(
        resolve(root, "src/layouts/index.ts"),
        'export { shared } from "../shared";',
      );
      await writeFile(
        resolve(root, "src/pages/NewSessionPage.tsx"),
        'export { shared } from "../shared"; export const later = () => import("./Later");',
      );
      await writeFile(
        resolve(root, "src/pages/Later.ts"),
        'export const later = "later";',
      );
      const result = (await build({
        root,
        base,
        configFile: false,
        logLevel: "warn",
        plugins: [newSessionPreloadPlugin(), cspPlugin()],
        build: { write: false, minify: false },
      })) as Rollup.RollupOutput;
      const document = result.output.find(
        (output) => output.type === "asset" && output.fileName === "index.html",
      );
      if (!document || document.type !== "asset")
        throw new Error("Missing built HTML");
      const html = String(document.source);
      const script =
        /<script data-new-session-preload>([\s\S]*?)<\/script>/.exec(html)?.[1];
      if (!script) throw new Error("Missing preload script");
      const hash = createHash("sha256").update(script).digest("base64");
      expect(html).toContain(`'sha256-${hash}'`);
      const linksFor = (path: string) => {
        const links: { href: string; rel: string; crossOrigin: string }[] = [];
        runInNewContext(script, {
          URL,
          location: new URL(path, "https://ya.test"),
          document: {
            createElement: () => ({}),
            head: {
              appendChild: (link: (typeof links)[number]) => links.push(link),
            },
          },
        });
        return links;
      };
      for (const path of [
        `${base}new-session`,
        `${base}new-session/?projectId=one`,
      ]) {
        const links = linksFor(path);
        expect(links.length).toBeGreaterThan(0);
        expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
        expect(
          links.every(
            (link) => link.rel === "modulepreload" && link.crossOrigin === "",
          ),
        ).toBe(true);
        for (const link of links) {
          expect(link.href).toMatch(
            new RegExp(`^https://ya.test${base}assets/`),
          );
          expect(
            result.output.some((output) => link.href.endsWith(output.fileName)),
          ).toBe(true);
          expect(link.href).not.toContain("Later-");
        }
      }
      expect(linksFor(`${base}projects`)).toEqual([]);
      expect(linksFor(`${base}new-session-extra`)).toEqual([]);
      expect(linksFor(`/other${base}new-session`)).toEqual([]);
    } finally {
      await rm(root, { recursive: true });
    }
  },
);
