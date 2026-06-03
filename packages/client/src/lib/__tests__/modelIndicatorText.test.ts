import { describe, expect, it } from "vitest";
import { getModelIndicatorModelLabel } from "../modelIndicatorText";

describe("getModelIndicatorModelLabel", () => {
  describe("claude models", () => {
    it("sonnet", () => {
      expect(getModelIndicatorModelLabel("claude", "claude-sonnet-4-6")).toBe(
        "Cl ♪ 4.6",
      );
    });
    it("opus", () => {
      expect(getModelIndicatorModelLabel("claude", "claude-opus-4-8")).toBe(
        "Cl ◐ 4.8",
      );
    });
    it("opus alias", () => {
      expect(getModelIndicatorModelLabel("claude", "opus")).toBe("Cl ◐");
    });
    it("opus 1m alias", () => {
      expect(getModelIndicatorModelLabel("claude", "opus[1m]")).toBe("Cl ◐ 1m");
    });
    it("opus plan alias", () => {
      expect(getModelIndicatorModelLabel("claude", "opusplan")).toBe(
        "Cl ◐ Plan",
      );
    });
    it("haiku", () => {
      expect(getModelIndicatorModelLabel("claude", "claude-haiku-3-5")).toBe(
        "Cl ✎ 3.5",
      );
    });
    it("sonnet 1m extended context", () => {
      const label = getModelIndicatorModelLabel(
        "claude",
        "claude-sonnet-4-6[1m]",
      );
      expect(label).toMatch(/^Cl ♪/);
    });
  });

  describe("codex models", () => {
    it("gpt-5.4-mini", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4-mini")).toBe(
        "Cd ◇ 5.4-mini",
      );
    });
    it("gpt-5.4-spark", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4-spark")).toBe(
        "Cd ⚡",
      );
    });
    it("gpt-5.4-codex-spark", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4-codex-spark")).toBe(
        "Cd ⚡",
      );
    });
    it("gpt-5.3-codex-spark", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.3-codex-spark")).toBe(
        "Cd ⚡",
      );
    });
    it("gpt-5.4 generic", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4")).toBe("Cd ◇ 5.4");
    });
    it("gpt-5.4-codex generic", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4-codex")).toBe(
        "Cd ◇ 5.4",
      );
    });
    it("gpt-5.5-codex generic", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.5-codex")).toBe(
        "Cd ◆ 5.5",
      );
    });
    it("gpt-4", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-4")).toBe("Cd ⧉ 4");
    });
    it("openai/ prefix stripped", () => {
      expect(getModelIndicatorModelLabel("codex", "openai/gpt-5.4-mini")).toBe(
        "Cd ◇ 5.4-mini",
      );
    });
  });

  describe("gemini models", () => {
    it("2.5-flash", () => {
      expect(getModelIndicatorModelLabel("gemini", "gemini-2.5-flash")).toBe(
        "✦ ⚡",
      );
    });
    it("2.5-pro", () => {
      expect(getModelIndicatorModelLabel("gemini", "gemini-2.5-pro")).toBe(
        "✦ ✹",
      );
    });
    it("1.5-pro", () => {
      expect(getModelIndicatorModelLabel("gemini", "gemini-1.5-pro")).toBe(
        "✦ ✹",
      );
    });
  });

  describe("fallbacks", () => {
    it("unknown model falls back to provider abbrev + raw model", () => {
      expect(
        getModelIndicatorModelLabel("claude", "some-novel-model-xyz"),
      ).toBe("Cl some-novel-model-xyz");
    });
    it("unknown provider uses fallback glyph", () => {
      expect(
        getModelIndicatorModelLabel("unknown-provider", "some-model"),
      ).toBe("◌ some-model");
    });
    it("empty model returns empty string", () => {
      expect(getModelIndicatorModelLabel("claude", "")).toBe("");
    });
    it("undefined model returns empty string", () => {
      expect(getModelIndicatorModelLabel("claude", undefined)).toBe("");
    });
  });

  describe("provider abbreviations", () => {
    it.each([
      ["claude", "Cl"],
      ["claude-ollama", "Cl↓"],
      ["codex", "Cd"],
      ["codex-oss", "Cd↓"],
      ["gemini", "✦"],
      ["gemini-acp", "✦"],
      ["opencode", "OC"],
    ])("provider %s uses abbrev %s", (provider, abbrev) => {
      const label = getModelIndicatorModelLabel(provider, "unknown-model-zzz");
      expect(label.startsWith(abbrev)).toBe(true);
    });
  });

  describe("variant provider model rules fall back to base provider", () => {
    it("claude-ollama uses claude model rules", () => {
      expect(
        getModelIndicatorModelLabel("claude-ollama", "claude-sonnet-4-6"),
      ).toBe("Cl↓ ♪ 4.6");
    });
    it("gemini-acp uses gemini model rules", () => {
      expect(
        getModelIndicatorModelLabel("gemini-acp", "gemini-2.5-flash"),
      ).toBe("✦ ⚡");
    });
    it("codex-oss uses its own explicit rules (not codex fallback)", () => {
      expect(getModelIndicatorModelLabel("codex-oss", "gpt-5.4-mini")).toBe(
        "Cd↓ ◇ 5.4-mini",
      );
    });
    it("codex-oss maps 5.3-codex-spark to spark icon", () => {
      expect(
        getModelIndicatorModelLabel("codex-oss", "gpt-5.3-codex-spark"),
      ).toBe("Cd↓ ⚡");
    });
    it("codex-oss maps 5.4-codex-spark to spark icon", () => {
      expect(
        getModelIndicatorModelLabel("codex-oss", "gpt-5.4-codex-spark"),
      ).toBe("Cd↓ ⚡");
    });
  });
});
