import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { detectDesktopProviderApplication } from "../../src/desktop/providerDetection.js";

describe("desktop provider application detection", () => {
  it("recognizes the current ChatGPT macOS bundle as Codex", () => {
    const systemBundle = path.join("/Applications", "ChatGPT.app");
    const userBundle = path.join("/Users/test", "Applications", "ChatGPT.app");

    for (const expected of [systemBundle, userBundle]) {
      expect(
        detectDesktopProviderApplication("codex", {
          platform: "darwin",
          homeDir: "/Users/test",
          exists: (candidate) => candidate === expected,
        }),
      ).toBe(true);
    }
  });

  it("keeps recognizing the legacy Codex macOS bundle", () => {
    expect(
      detectDesktopProviderApplication("codex", {
        platform: "darwin",
        homeDir: "/Users/test",
        exists: (candidate) => candidate === "/Applications/Codex.app",
      }),
    ).toBe(true);
  });

  it("recognizes provider-owned Windows data without asserting launchability", () => {
    const expected = path.join("C:\\Users\\test", ".codex");

    expect(
      detectDesktopProviderApplication("codex", {
        platform: "win32",
        homeDir: "C:\\Users\\test",
        env: {},
        exists: (candidate) => candidate === expected,
        readDirectories: () => [],
      }),
    ).toBe(true);
  });

  it("recognizes a Claude Store package directory", () => {
    expect(
      detectDesktopProviderApplication("claude", {
        platform: "win32",
        homeDir: "C:\\Users\\test",
        env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
        exists: () => false,
        readDirectories: () => ["Claude_abc123"],
      }),
    ).toBe(true);
  });

  it("does not treat unrelated provider data as Claude or Codex", () => {
    expect(
      detectDesktopProviderApplication("gemini", {
        exists: () => true,
      }),
    ).toBe(false);
  });
});
