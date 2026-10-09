// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { describe, expect, it, vi } from "vitest";

describe("shared package bundle boundaries", () => {
  it("loads validators with their consumer instead of a helper import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ya-shared-bundle-"));
    try {
      const result = await build({
        configFile: false,
        logLevel: "silent",
        resolve: { conditions: ["source"] },
        plugins: [
          {
            name: "shared-bundle-fixture",
            resolveId(id) {
              if (id === "fixture-entry" || id === "fixture-schema")
                return `\0${id}`;
            },
            load(id) {
              if (id === "\0fixture-entry")
                return `
              import { toUrlProjectId } from '@yep-anywhere/shared';
              export const projectId = toUrlProjectId('/example');
              export const loadSchema = () => import('fixture-schema');
            `;
              if (id === "\0fixture-schema")
                return `
              export { BashResultSchema as schema } from '@yep-anywhere/shared';
            `;
            },
          },
        ],
        build: {
          outDir: directory,
          emptyOutDir: false,
          minify: false,
          rollupOptions: {
            input: "fixture-entry",
            preserveEntrySignatures: "strict",
            output: {
              entryFileNames: "entry.mjs",
              chunkFileNames: "[name].mjs",
            },
          },
        },
      });
      if (!("output" in result))
        throw new Error("Expected one completed build");
      const chunks = result.output.filter((item) => item.type === "chunk");
      const entry = chunks.find((chunk) => chunk.isEntry)!;
      const pending = [entry.fileName];
      const visited = new Set<string>();
      const initialModules: string[] = [];
      while (pending.length) {
        const file = pending.pop()!;
        if (visited.has(file)) continue;
        visited.add(file);
        const chunk = chunks.find((candidate) => candidate.fileName === file)!;
        initialModules.push(...Object.keys(chunk.modules));
        pending.push(...chunk.imports);
      }
      expect(initialModules.some((id) => id.includes("/zod/"))).toBe(false);
      expect(initialModules.some((id) => id.includes("-schema/"))).toBe(false);
      const module = await import(
        /* @vite-ignore */ pathToFileURL(join(directory, entry.fileName)).href
      );
      expect(module.projectId).toBe("L2V4YW1wbGU");
      const { schema } = await module.loadSchema();
      expect(
        schema.safeParse({ stdout: "command output", stderr: "" }).success,
      ).toBe(true);
      expect(schema.safeParse(42).success).toBe(false);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("preserves the frame find agent's import-time installation", async () => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      resolve: { conditions: ["source"] },
      plugins: [
        {
          name: "frame-agent-fixture",
          resolveId(id) {
            if (id === "fixture") return "\0fixture";
          },
          load(id) {
            if (id === "\0fixture")
              return "import '@yep-anywhere/shared/find/frameFindAgent';";
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: "fixture", output: { format: "iife" } },
      },
    });
    if (!("output" in result)) throw new Error("Expected one completed build");
    const chunk = result.output.find((item) => item.type === "chunk")!;
    const postMessage = vi.fn();
    const addEventListener = vi.fn();
    new Function("window", "document", chunk.code)(
      { parent: { postMessage }, addEventListener },
      { nodeType: 9 },
    );
    expect(postMessage).toHaveBeenCalledWith(
      { protocol: "yep-find/1", type: "ready" },
      "*",
    );
    expect(addEventListener.mock.calls.map(([event]) => event)).toEqual([
      "message",
      "keydown",
    ]);
  });
});
