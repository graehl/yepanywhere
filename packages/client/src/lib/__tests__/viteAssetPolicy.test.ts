import { describe, expect, it } from "vitest";
import { shouldInlineClientAsset } from "../../../vite-plugin-csp";

describe("client Vite asset policy", () => {
  it("keeps fonts on the same origin required by the CSP", () => {
    expect(shouldInlineClientAsset("KaTeX_Size3-Regular.woff2")).toBe(false);
    expect(shouldInlineClientAsset("font.ttf?url")).toBe(false);
  });

  it("leaves non-font inlining at Vite's default", () => {
    expect(shouldInlineClientAsset("small-icon.png")).toBeUndefined();
  });
});
