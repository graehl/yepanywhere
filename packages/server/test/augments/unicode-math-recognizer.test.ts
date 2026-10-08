import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findUnicodeMath,
  loadUnicodeMathParams,
} from "../../src/augments/unicode-math-recognizer.js";

const shipped = readFileSync(
  new URL("../../src/augments/unicode-math-params.bin", import.meta.url),
);

describe("unicode math recognizer parameters", () => {
  it("decodes the shipped binary parameters", () => {
    const params = loadUnicodeMathParams(shipped);
    expect(params.heat).toHaveLength(49);
    expect(params.left.size).toBeGreaterThan(0);
    expect(params.right.size).toBeGreaterThan(0);
    const text = "Promote the λ=.05 checkpoint.";
    expect(
      findUnicodeMath(params, text).map(([s, e]) => text.slice(s, e)),
    ).toEqual(["λ=.05"]);
  });

  it("rejects malformed parameter files", () => {
    const badMagic = Uint8Array.from(shipped);
    badMagic[0] = 0;
    expect(() => loadUnicodeMathParams(badMagic)).toThrow(/bad magic/);
    expect(() =>
      loadUnicodeMathParams(shipped.subarray(0, shipped.length - 1)),
    ).toThrow(/truncated/);
    expect(() =>
      loadUnicodeMathParams(Uint8Array.from([...shipped, 0])),
    ).toThrow(/trailing data/);
  });
});
