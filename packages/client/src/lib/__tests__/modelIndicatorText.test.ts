import { describe, expect, it } from "vitest";
import {
  getModelIndicatorModelLabel,
  getModelIndicatorTextVariants,
  getModelIndicatorTooltip,
} from "../modelIndicatorText";

describe("getModelIndicatorModelLabel", () => {
  describe("claude models", () => {
    it("sonnet", () => {
      expect(getModelIndicatorModelLabel("claude", "claude-sonnet-4-6")).toBe(
        "◉ ♪ 4.6",
      );
    });
    it("opus", () => {
      expect(getModelIndicatorModelLabel("claude", "claude-opus-4-1")).toBe(
        "◉ ◐ 4.1",
      );
    });
    it("haiku", () => {
      expect(getModelIndicatorModelLabel("claude", "claude-haiku-3-5")).toBe(
        "◉ ✎ 3.5",
      );
    });
    it("sonnet 1m extended context", () => {
      // 1m suffix doesn't match 'sonnet[1m]' pattern (version separates them)
      // so falls through to plain 'sonnet' rule; suffix preserved as-is
      const label = getModelIndicatorModelLabel(
        "claude",
        "claude-sonnet-4-6[1m]",
      );
      expect(label).toMatch(/^◉ ♪/);
    });
  });

  describe("codex models", () => {
    it("gpt-5.4-mini", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4-mini")).toBe(
        "⌬ ◇ 5.4-mini",
      );
    });
    it("gpt-5.4-spark", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4-spark")).toBe(
        "⌬ ⚡ 5.4-spark",
      );
    });
    it("gpt-5.4 generic", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-5.4")).toBe("⌬ ◇ 5.4");
    });
    it("gpt-4", () => {
      expect(getModelIndicatorModelLabel("codex", "gpt-4")).toBe("⌬ ⧉ 4");
    });
    it("openai/ prefix stripped", () => {
      expect(getModelIndicatorModelLabel("codex", "openai/gpt-5.4-mini")).toBe(
        "⌬ ◇ 5.4-mini",
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
    it("unknown model falls back to provider glyph + raw model", () => {
      expect(
        getModelIndicatorModelLabel("claude", "some-novel-model-xyz"),
      ).toBe("◉ some-novel-model-xyz");
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

  describe("provider glyphs", () => {
    it.each([
      ["claude", "◉"],
      ["claude-ollama", "◎"],
      ["codex", "⌬"],
      ["codex-oss", "◈"],
      ["gemini", "✦"],
      ["gemini-acp", "✶"],
      ["opencode", "⧉"],
    ])("provider %s uses glyph %s", (provider, glyph) => {
      const label = getModelIndicatorModelLabel(provider, "unknown-model-zzz");
      expect(label.startsWith(glyph)).toBe(true);
    });
  });
});

describe("getModelIndicatorTooltip", () => {
  it("combines status and readable model", () => {
    expect(
      getModelIndicatorTooltip("claude", "claude-sonnet-4-6", "Thinking"),
    ).toBe("Thinking - ◉ Sonnet 4.6");
  });
  it("status-only without model", () => {
    expect(getModelIndicatorTooltip("claude", "", "Thinking")).toBe("Thinking");
  });
  it("no status: just provider glyph + readable model", () => {
    expect(
      getModelIndicatorTooltip("claude", "claude-opus-4-1", undefined),
    ).toBe("◉ Opus 4.1");
  });
  it("codex model", () => {
    expect(
      getModelIndicatorTooltip("codex", "gpt-5.4-mini", "Thinking"),
    ).toBe("Thinking - ⌬ 5.4-mini");
  });
  it("gemini model", () => {
    expect(
      getModelIndicatorTooltip("gemini", "gemini-2.5-flash", undefined),
    ).toBe("✦ 2.5-flash");
  });
  it("non-status title falls back to model label", () => {
    expect(
      getModelIndicatorTooltip("claude", "claude-haiku-3-5", "4-6 · Thinking off"),
    ).toBe("◉ Haiku 3.5");
  });
});

describe("getModelIndicatorTextVariants", () => {
  it("full is raw title, glyph is compact, compact includes extras", () => {
    const variants = getModelIndicatorTextVariants(
      "claude",
      "claude-sonnet-4-6",
      "4-6 · Thinking off",
    );
    expect(variants.full).toBe("4-6 · Thinking off");
    expect(variants.glyph).toBe("◉ ♪ 4.6");
    expect(variants.compact).toBe("◉ ♪ 4.6 · Thinking off");
  });

  it("status-only titles pass through unchanged", () => {
    for (const title of [
      "Thinking",
      "Compacting",
      "Slash commands",
      "Waiting for input",
      "On hold",
    ]) {
      const variants = getModelIndicatorTextVariants(
        "claude",
        "claude-sonnet-4-6",
        title,
      );
      expect(variants.full).toBe(title);
      expect(variants.compact).toBe(title);
      expect(variants.glyph).toBe(title);
    }
  });

  it("no title falls back to glyph label", () => {
    const variants = getModelIndicatorTextVariants(
      "claude",
      "claude-sonnet-4-6",
    );
    expect(variants.full).toBe("model");
    expect(variants.glyph).toBe("◉ ♪ 4.6");
    expect(variants.compact).toBe("◉ ♪ 4.6");
  });
});
