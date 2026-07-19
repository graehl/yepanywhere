import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectionDirectory = resolve(
  process.cwd(),
  "src/lib/transcriptProjection",
);
const canonicalWebConsumerFiles = [
  "src/components/renderers/tools/TaskRenderer.tsx",
  "src/lib/sessionDetail/renderItems.ts",
  "src/pages/SessionPage.tsx",
];

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

  it("routes production web consumers through the canonical adapter", () => {
    for (const relativePath of canonicalWebConsumerFiles) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");

      expect(source, relativePath).toContain(
        "getCachedWebTranscriptProjection",
      );
      expect(source, relativePath).not.toContain("preprocessMessages");
      expect(source, relativePath).not.toContain(
        "getCachedTranscriptProjection",
      );
      expect(source, relativePath).not.toContain(
        "compileWebTranscriptProjection",
      );
    }
  });
});
