import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIND_PROTOCOL,
  findSeed,
  isFindReport,
  isFindRequest,
} from "../src/find/protocol.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("find protocol", () => {
  it("accepts only well-formed requests from a viewer", () => {
    expect(
      isFindRequest({
        protocol: FIND_PROTOCOL,
        type: "find",
        seq: 1,
        query: "x",
      }),
    ).toBe(true);
    expect(
      isFindRequest({
        protocol: FIND_PROTOCOL,
        type: "step",
        seq: 2,
        direction: -1,
      }),
    ).toBe(true);
    expect(
      isFindRequest({
        protocol: FIND_PROTOCOL,
        type: "step",
        seq: 2,
        direction: 2,
      }),
    ).toBe(false);
    expect(isFindRequest({ protocol: "other", type: "hello" })).toBe(false);
    expect(isFindRequest({ protocol: FIND_PROTOCOL, type: "eval" })).toBe(
      false,
    );
  });

  it("accepts only well-formed reports from a frame", () => {
    expect(
      isFindReport({
        protocol: FIND_PROTOCOL,
        type: "result",
        seq: 3,
        total: 4,
        current: 1,
        capped: false,
      }),
    ).toBe(true);
    expect(
      isFindReport({ protocol: FIND_PROTOCOL, type: "result", seq: 3 }),
    ).toBe(false);
    expect(
      isFindReport({ protocol: FIND_PROTOCOL, type: "open", selection: "a" }),
    ).toBe(true);
  });

  it("seeds a search only from a short single-line selection", () => {
    expect(findSeed("  word  ")).toBe("word");
    expect(findSeed("two\nlines")).toBe("");
    expect(findSeed("x".repeat(201))).toBe("");
    expect(findSeed(undefined)).toBe("");
  });

  it("keeps the generated frame agent in step with its sources", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [join(root, "scripts/generate-frame-find-agent.mjs"), "--check"],
        { cwd: root, stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
