import { describe, expect, it } from "vitest";
import {
  CODEX_CLI_GPT55_MIN_VERSION,
  compareSemver,
  getFallbackCodexModelsForCliVersion,
  normalizeCodexModelList,
  normalizeSemver,
} from "../../../src/sdk/providers/codex-model-catalog.js";

describe("Codex model catalog", () => {
  it("normalizes Codex CLI version output and compares prereleases", () => {
    expect(normalizeSemver("codex-cli 0.123.9")).toBe("0.123.9");
    expect(normalizeSemver("0.124.0-beta.1")).toBe("0.124.0-beta.1");
    expect(normalizeSemver("not a version")).toBeNull();

    expect(compareSemver("0.123.9", CODEX_CLI_GPT55_MIN_VERSION)).toBeLessThan(
      0,
    );
    expect(compareSemver("0.124.0-beta.1", "0.124.0")).toBeLessThan(0);
    expect(compareSemver("0.124.0", "0.124.0-beta.1")).toBeGreaterThan(0);
    expect(compareSemver("0.124.0", CODEX_CLI_GPT55_MIN_VERSION)).toBe(0);
  });

  it("selects legacy fallback models only before GPT-5.5 support", () => {
    expect(
      getFallbackCodexModelsForCliVersion("0.123.9").map(
        (model) => model.id,
      ),
    ).toEqual([
      "gpt-5.3-codex",
      "gpt-5.2-codex",
      "gpt-5.1-codex-max",
      "gpt-5.2",
      "gpt-5.1-codex-mini",
    ]);
    expect(
      getFallbackCodexModelsForCliVersion(CODEX_CLI_GPT55_MIN_VERSION).map(
        (model) => model.id,
      ),
    ).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2",
    ]);
    expect(getFallbackCodexModelsForCliVersion(null)[0]?.id).toBe("gpt-5.5");
  });

  it("prefers GPT-5.5 over Codex's model/list default when available", () => {
    const models = normalizeCodexModelList([
      {
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "gpt-5.4",
        description: "Strong model for everyday coding.",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          {
            reasoningEffort: "low",
            description: "Fast responses with lighter reasoning",
          },
          {
            reasoningEffort: "medium",
            description: "Balanced speed and reasoning",
          },
        ],
        inputModalities: ["text", "image"],
        supportsPersonality: true,
        serviceTiers: [
          {
            id: "priority",
            name: "Fast",
            description: "1.5x speed, increased usage",
          },
        ],
      },
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Frontier model.",
        isDefault: false,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          {
            reasoningEffort: "high",
            description: "Greater reasoning depth",
          },
        ],
        inputModalities: ["text", "image"],
        supportsPersonality: true,
        serviceTiers: [
          {
            id: "priority",
            name: "Fast",
            description: "1.5x speed, increased usage",
          },
        ],
      },
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        upgrade: "gpt-5.4",
        hidden: false,
      },
      {
        id: "internal-hidden",
        model: "internal-hidden",
        hidden: true,
      },
    ]);

    expect(models.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.3-codex",
    ]);
    expect(models[0]).toMatchObject({
      name: "GPT-5.5",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        {
          reasoningEffort: "high",
          description: "Greater reasoning depth",
        },
      ],
      inputModalities: ["text", "image"],
      supportsPersonality: true,
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
    });
    expect(models[1]).toMatchObject({
      isDefault: true,
      inputModalities: ["text", "image"],
    });
  });
});
