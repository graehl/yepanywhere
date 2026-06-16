import { describe, expect, it } from "vitest";
import { resolveCompactPercent } from "../../src/routes/sessions.js";

describe("resolveCompactPercent (task 029 alias↔resolved-id bridge)", () => {
  const map = { opus: 5, sonnet: 30, default: 40 };

  it("matches the stored alias directly", () => {
    expect(resolveCompactPercent(map, ["opus"])).toBe(5);
    expect(resolveCompactPercent(map, ["sonnet"])).toBe(30);
  });

  it("falls back to family for a resolved full id (the live-process case)", () => {
    // The bug we hit live: process resolved to claude-opus-4-8, threshold under "opus".
    expect(resolveCompactPercent(map, ["claude-opus-4-8"])).toBe(5);
    expect(resolveCompactPercent(map, ["claude-sonnet-4-6"])).toBe(30);
  });

  it("prefers an earlier exact candidate over later ones", () => {
    expect(resolveCompactPercent(map, [undefined, "opus", "claude-sonnet-4-6"])).toBe(5);
  });

  it("ignores the 'default' sentinel as a model key", () => {
    expect(resolveCompactPercent(map, ["default"])).toBeUndefined();
  });

  it("does not misclassify opusplan as opus", () => {
    expect(resolveCompactPercent(map, ["opusplan"])).toBeUndefined();
  });

  it("returns undefined when nothing matches or the map is absent", () => {
    expect(resolveCompactPercent(map, ["haiku", "claude-haiku-4-5"])).toBeUndefined();
    expect(resolveCompactPercent(undefined, ["opus"])).toBeUndefined();
    expect(resolveCompactPercent(map, [undefined])).toBeUndefined();
  });
});
