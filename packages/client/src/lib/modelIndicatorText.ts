const DEFAULT_PROVIDER_GLYPH = "◌";

const providerGlyphMap: Record<string, string> = {
  claude: "Cl",
  "claude-ollama": "Cl↓",
  codex: "Cd",
  "codex-oss": "Cd↓",
  gemini: "✦",
  "gemini-acp": "✦",
  grok: "Gk",
  opencode: "OC",
};

type ModelGlyphMatch = {
  glyph: string;
  suffix: string;
};

type ModelGlyphRule = {
  patterns: string[];
  glyph: string;
  fixedSuffix?: string;
  match?: "contains" | "exact";
};

const modelGlyphRulesByProvider: Readonly<
  Record<string, ReadonlyArray<ModelGlyphRule>>
> = {
  claude: [
    {
      patterns: ["opus[1m]", "opus-1m"],
      glyph: "◐",
      fixedSuffix: "1m",
      match: "exact",
    },
    {
      patterns: ["opusplan"],
      glyph: "◐",
      fixedSuffix: "Plan",
      match: "exact",
    },
    { patterns: ["opus"], glyph: "◐", fixedSuffix: "", match: "exact" },
    {
      patterns: ["sonnet[1m]", "sonnet-1m"],
      glyph: "♪",
      fixedSuffix: "1m",
    },
    { patterns: ["opus"], glyph: "◐" },
    { patterns: ["sonnet"], glyph: "♪" },
    { patterns: ["haiku"], glyph: "✎" },
  ],
  codex: [
    {
      patterns: [
        "gpt-5.4-codex-spark",
        "gpt-5.4-spark",
        "gpt-5.3-codex-spark",
        "gpt-5.3-spark",
      ],
      glyph: "⚡",
      fixedSuffix: "",
    },
    { patterns: ["gpt-5.5"], glyph: "◆" },
    { patterns: ["gpt-5.4-mini"], glyph: "◇" },
    { patterns: ["gpt-5.4-nano"], glyph: "◇" },
    { patterns: ["gpt-5.4"], glyph: "◇" },
    { patterns: ["gpt-5.3"], glyph: "◆" },
    { patterns: ["gpt-5"], glyph: "◆" },
    { patterns: ["gpt-4"], glyph: "⧉" },
  ],
  "codex-oss": [
    {
      patterns: [
        "gpt-5.4-codex-spark",
        "gpt-5.4-spark",
        "gpt-5.3-codex-spark",
        "gpt-5.3-spark",
      ],
      glyph: "⚡",
      fixedSuffix: "",
    },
    { patterns: ["gpt-5.5"], glyph: "◆" },
    { patterns: ["gpt-5.4-mini"], glyph: "◇" },
    { patterns: ["gpt-5.4-nano"], glyph: "◇" },
    { patterns: ["gpt-5.4"], glyph: "◇" },
    { patterns: ["gpt-5.3"], glyph: "◆" },
    { patterns: ["gpt-5"], glyph: "◆" },
    { patterns: ["gpt-4"], glyph: "⧉" },
  ],
  gemini: [
    { patterns: ["2.5-pro"], glyph: "✹" },
    { patterns: ["2.5-flash"], glyph: "⚡" },
    { patterns: ["1.5-pro"], glyph: "✹" },
    { patterns: ["gemini"], glyph: "◗" },
  ],
  grok: [{ patterns: ["grok-build"], glyph: "Gk" }],
  opencode: [
    { patterns: ["gpt-5"], glyph: "◆" },
    { patterns: ["gpt-4"], glyph: "⧉" },
    { patterns: ["qwen"], glyph: "◌" },
    { patterns: ["llama"], glyph: "◥" },
    { patterns: ["mistral"], glyph: "◰" },
  ],
};

const anyProviderModelRules: ReadonlyArray<ModelGlyphRule> = [
  { patterns: ["thinking"], glyph: "∴" },
];

export function normalizeProviderKey(provider?: string): string {
  return provider?.trim().toLowerCase() ?? "unknown";
}

export function normalizeForModelGlyphMatching(value: string): string {
  let normalized = value.trim().toLowerCase();
  normalized = normalized.replace(/^openai\//u, "");
  normalized = normalized.replace(/^opencode\//u, "");
  normalized = normalized.replace(/^gemini-/u, "");
  return normalized;
}

function normalizeForCodexModelAliasMatching(
  normalizedModel: string,
  providerKey: string,
): string {
  if (!["codex", "codex-oss"].includes(providerKey)) {
    return normalizedModel;
  }

  // Some Codex model identifiers now include `-codex-` as a transport/alias
  // marker; remove it so stable rendering rules can still map to the same icon
  // buckets.
  return normalizedModel.replace(/-codex(?=-|$)/gu, "");
}

function normalizeModelSuffixTail(raw: string): string {
  const suffix = raw.replace(/^[-._\s]+/u, "");
  if (!suffix) {
    return "";
  }

  const versionWithExtendedContext = suffix.match(
    /^(\d+(?:-\d+)+(?:\.\d+)?)(\[1m\])?$/u,
  );
  if (versionWithExtendedContext) {
    const version = versionWithExtendedContext[1]?.replace(/-/gu, ".");
    return `${version}${versionWithExtendedContext[2] ? " 1m" : ""}`;
  }

  return suffix;
}

function deriveModelGlyphMatch(
  providerKey: string,
  normalizedModel: string,
): ModelGlyphMatch | null {
  const baseProviderKey = providerKey.replace(/-(?:ollama|oss|acp)$/u, "");
  const providerRules =
    modelGlyphRulesByProvider[providerKey] ??
    modelGlyphRulesByProvider[baseProviderKey] ??
    [];
  const findMatch = (ruleList: ReadonlyArray<ModelGlyphRule>) => {
    for (const rule of ruleList) {
      const patterns = [...rule.patterns].sort((a, b) => b.length - a.length);
      for (const pattern of patterns) {
        const matchStart =
          rule.match === "exact"
            ? normalizedModel === pattern
              ? 0
              : -1
            : normalizedModel.indexOf(pattern);
        if (matchStart === -1) {
          continue;
        }

        const suffix = normalizeModelSuffixTail(
          normalizedModel.slice(matchStart + pattern.length),
        );

        if (rule.fixedSuffix !== undefined) {
          return { glyph: rule.glyph, suffix: rule.fixedSuffix };
        }

        if (pattern.startsWith("gpt-")) {
          const base = pattern.slice(4);
          return {
            glyph: rule.glyph,
            suffix: suffix ? `${base}-${suffix}` : base,
          };
        }

        if (suffix) {
          return { glyph: rule.glyph, suffix };
        }

        return { glyph: rule.glyph, suffix: "" };
      }
    }

    return null;
  };

  return findMatch(providerRules) ?? findMatch(anyProviderModelRules);
}

export function getModelIndicatorModelLabel(
  provider?: string,
  model?: string,
): string {
  const trimmedModel = model?.trim();
  if (!trimmedModel) {
    return "";
  }

  const providerKey = normalizeProviderKey(provider);
  const providerGlyph = providerGlyphMap[providerKey] ?? DEFAULT_PROVIDER_GLYPH;
  const normalizedModel = normalizeForModelGlyphMatching(trimmedModel);
  const normalizedForMatching = normalizeForCodexModelAliasMatching(
    normalizedModel,
    providerKey,
  );
  const match = deriveModelGlyphMatch(providerKey, normalizedForMatching);

  if (!match) {
    return `${providerGlyph} ${normalizedForMatching}`;
  }

  const suffix = match.suffix ? ` ${match.suffix}` : "";
  return `${providerGlyph} ${match.glyph}${suffix}`;
}
