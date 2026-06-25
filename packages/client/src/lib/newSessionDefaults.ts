import type {
  EffortLevel,
  NewSessionDefaults,
  ProviderName,
  ProviderSessionDefaults,
  ThinkingMode,
} from "@yep-anywhere/shared";

export interface ProviderDefaultSeed {
  model?: string | null;
  serviceTier?: string | null;
  thinkingMode?: ThinkingMode | null;
  effortLevel?: EffortLevel | null;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function compactProviderDefaults(
  defaults: ProviderSessionDefaults,
): ProviderSessionDefaults {
  const compacted: ProviderSessionDefaults = {};
  const model = nonEmpty(defaults.model);
  const serviceTier = nonEmpty(defaults.serviceTier);
  const helperSideModel = nonEmpty(defaults.helperSideModel);
  if (model) compacted.model = model;
  if (serviceTier) compacted.serviceTier = serviceTier;
  if (defaults.thinkingMode) compacted.thinkingMode = defaults.thinkingMode;
  if (defaults.effortLevel) compacted.effortLevel = defaults.effortLevel;
  if (helperSideModel) compacted.helperSideModel = helperSideModel;
  return compacted;
}

export function getProviderSessionDefaults(
  defaults: NewSessionDefaults | null | undefined,
  providerName: ProviderName,
  seed: ProviderDefaultSeed = {},
): ProviderSessionDefaults {
  const scoped = defaults?.providers?.[providerName] ?? {};
  const legacyMatchesProvider = defaults?.provider === providerName;

  return compactProviderDefaults({
    model:
      scoped.model ??
      (legacyMatchesProvider ? defaults?.model : undefined) ??
      nonEmpty(seed.model),
    serviceTier:
      scoped.serviceTier ??
      (legacyMatchesProvider ? defaults?.serviceTier : undefined) ??
      nonEmpty(seed.serviceTier),
    thinkingMode: scoped.thinkingMode ?? seed.thinkingMode ?? undefined,
    effortLevel: scoped.effortLevel ?? seed.effortLevel ?? undefined,
    helperSideModel: scoped.helperSideModel ?? undefined,
  });
}

export function withProviderSessionDefaults(
  defaults: NewSessionDefaults | null | undefined,
  providerName: ProviderName,
  updates: ProviderSessionDefaults,
  seed: ProviderDefaultSeed = {},
): NewSessionDefaults {
  const { helperSideModel: _legacyHelperSideModel, ...baseDefaults } =
    (defaults ?? {}) as NewSessionDefaults & { helperSideModel?: string };
  const providerDefaults = compactProviderDefaults({
    ...getProviderSessionDefaults(defaults, providerName, seed),
    ...updates,
  });

  return {
    ...baseDefaults,
    providers: {
      ...defaults?.providers,
      [providerName]: providerDefaults,
    },
  };
}
