import { describe, expect, it } from "vitest";
import { parseOpenCodeModelVariants } from "../../../src/sdk/providers/opencode.js";

describe("parseOpenCodeModelVariants", () => {
  it("extracts effort variant levels per model from verbose output", () => {
    const verbose = [
      "github-copilot/claude-opus-4.8",
      "{",
      '  "id": "claude-opus-4.8",',
      '  "providerID": "github-copilot",',
      '  "variants": {',
      '    "low": { "effort": "low" },',
      '    "medium": { "effort": "medium" },',
      '    "high": { "effort": "high" },',
      '    "xhigh": { "effort": "xhigh" },',
      '    "max": { "effort": "max" }',
      "  }",
      "}",
      "opencode/big-pickle",
      "{",
      '  "id": "big-pickle",',
      '  "providerID": "opencode"',
      "}",
    ].join("\n");
    const map = parseOpenCodeModelVariants(verbose);
    expect(map.get("github-copilot/claude-opus-4.8")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    // No variants -> not in the map (no effort selector advertised).
    expect(map.has("opencode/big-pickle")).toBe(false);
  });

  it("returns an empty map for empty/garbage output", () => {
    expect(parseOpenCodeModelVariants("").size).toBe(0);
    expect(parseOpenCodeModelVariants("not json\njust text\n").size).toBe(0);
  });
});
