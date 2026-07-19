import { describe, expect, it } from "vitest";
import {
  compareReports,
  parseArgs,
  validateManifest,
} from "./transcript-artifact-smoke.mjs";

describe("transcript artifact smoke", () => {
  it("parses comparison and timing options", () => {
    const options = parseArgs([
      "--manifest",
      "manifest.json",
      "--out-dir",
      "out",
      "--compare",
      "baseline",
      "--timeout-ms",
      "1200",
      "--settle-ms",
      "300",
      "--headed",
    ]);

    expect(options).toMatchObject({
      headed: true,
      settleMs: 300,
      timeoutMs: 1200,
    });
    expect(options.manifestPath).toMatch(/manifest\.json$/);
    expect(options.outDir).toMatch(/out$/);
    expect(options.comparePath).toMatch(/baseline$/);
  });

  it("normalizes and validates local session entries", () => {
    expect(
      validateManifest({
        schemaVersion: 1,
        sessions: [
          {
            name: "Claude Long Session",
            url: "https://127.0.0.1:3400/projects/p/sessions/s",
            minimumRenderRows: 3,
          },
        ],
      }),
    ).toEqual({
      schemaVersion: 1,
      sessions: [
        {
          name: "claude-long-session",
          url: "https://127.0.0.1:3400/projects/p/sessions/s",
          minimumRenderRows: 3,
          theme: "verydark",
          viewports: ["desktop", "mobile"],
        },
      ],
    });
  });

  it("rejects duplicate path-safe names", () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        sessions: [
          { name: "Same Name", url: "https://localhost/one" },
          { name: "same-name", url: "https://localhost/two" },
        ],
      }),
    ).toThrow("Duplicate session artifact name");
  });

  it("reports semantic and screenshot parity differences", () => {
    const baseline = {
      cases: [
        {
          name: "claude",
          viewport: "desktop",
          status: "passed",
          rowCount: 4,
          renderSignature: "semantic-a",
          screenshots: {
            top: { sha256: "top-a" },
            tail: { sha256: "tail-a" },
          },
        },
      ],
    };
    const changed = {
      cases: [
        {
          name: "claude",
          viewport: "desktop",
          status: "passed",
          rowCount: 5,
          renderSignature: "semantic-b",
          screenshots: {
            top: { sha256: "top-a" },
            tail: { sha256: "tail-b" },
          },
        },
      ],
    };

    expect(compareReports(baseline, baseline)).toEqual([]);
    expect(compareReports(baseline, changed)).toEqual([
      "claude/desktop: rowCount changed (4 -> 5)",
      'claude/desktop: renderSignature changed ("semantic-a" -> "semantic-b")',
      "claude/desktop: tail screenshot hash changed",
    ]);
  });
});
