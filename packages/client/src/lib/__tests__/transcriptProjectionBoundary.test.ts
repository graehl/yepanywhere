import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectionDirectory = resolve(
  process.cwd(),
  "src/lib/transcriptProjection",
);
const sessionDetailRenderItemsFile = resolve(
  process.cwd(),
  "src/lib/sessionDetail/renderItems.ts",
);

const forbiddenDependencies = [
  {
    label: "React runtime",
    pattern: /from\s+["'](?:react|react-dom)(?:\/[^"']*)?["']/u,
  },
  {
    label: "browser global",
    pattern:
      /\b(?:window|document|navigator|localStorage|sessionStorage)(?:\.|\[)/u,
  },
  {
    label: "web lifecycle scheduler",
    pattern: /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/u,
  },
  {
    label: "web application layer",
    pattern:
      /from\s+["'][^"']*\/(?:components|contexts|hooks|pages|stores?|transport)(?:\/|["'])/u,
  },
  {
    label: "legacy compatibility façade",
    pattern: /from\s+["'][^"']*preprocessMessages(?:\.[^"']*)?["']/u,
  },
];

describe("transcript projection module boundary", () => {
  it("stays independent of React, browser state, and the legacy façade", () => {
    const moduleFiles = readdirSync(projectionDirectory)
      .filter((fileName) => fileName.endsWith(".ts"))
      .sort();

    expect(moduleFiles).toContain("compiler.ts");
    expect(moduleFiles).toContain("messageProjection.ts");

    for (const fileName of moduleFiles) {
      const source = readFileSync(`${projectionDirectory}/${fileName}`, "utf8");
      for (const forbidden of forbiddenDependencies) {
        expect(
          source,
          `${fileName} imports or uses ${forbidden.label}`,
        ).not.toMatch(forbidden.pattern);
      }
    }
  });

  it("keeps session detail on the explicit compiler and cache path", () => {
    const source = readFileSync(sessionDetailRenderItemsFile, "utf8");

    expect(source).toContain("getCachedTranscriptProjection");
    expect(source).toContain("compileWebTranscriptProjection");
    expect(source).not.toContain("preprocessMessages");
  });
});
