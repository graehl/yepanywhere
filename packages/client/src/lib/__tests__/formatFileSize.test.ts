import { describe, expect, it } from "vitest";
import { formatFileSize } from "../formatFileSize";

describe("formatFileSize", () => {
  it.each([
    [512, "512\u202fb"],
    [1024, "1\u202fkb"],
    [1536, "2\u202fkb"],
    [1024 * 1024, "1\u202fmb"],
    [1.25 * 1024 * 1024, "1.3\u202fmb"],
    [1024 * 1024 * 1024, "1\u202fgb"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
