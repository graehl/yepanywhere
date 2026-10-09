import {
  ALL_PROVIDERS,
  isRecord,
  type NewSessionDefaults,
  type ProviderSessionDefaults,
} from "@yep-anywhere/shared";

const PREFIX = "ya:new-session-display:";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Only server-wide display preferences; never permissions or paid tiers. */
function displayDefaults(value: unknown): NewSessionDefaults | undefined {
  if (!isRecord(value)) return undefined;
  const input = value;
  const result: NewSessionDefaults = {};
  result.provider = ALL_PROVIDERS.find((name) => name === input.provider);
  if (typeof input.model === "string") result.model = input.model;
  const providers = isRecord(input.providers) ? input.providers : undefined;
  for (const name of ALL_PROVIDERS) {
    const source = providers?.[name];
    if (!isRecord(source)) continue;
    const target: ProviderSessionDefaults = {};
    if (typeof source.model === "string") target.model = source.model;
    if (
      source.thinkingMode === "off" ||
      source.thinkingMode === "auto" ||
      source.thinkingMode === "on"
    )
      target.thinkingMode = source.thinkingMode;
    if (
      source.effortLevel === "low" ||
      source.effortLevel === "medium" ||
      source.effortLevel === "high" ||
      source.effortLevel === "xhigh" ||
      source.effortLevel === "max"
    )
      target.effortLevel = source.effortLevel;
    result.providers ??= {};
    result.providers[name] = target;
  }
  return result;
}

export function readNewSessionDisplayDefaults(
  sourceKey: string,
): NewSessionDefaults | undefined {
  try {
    const raw = localStorage.getItem(`${PREFIX}${sourceKey}`);
    if (!raw) return undefined;
    const snapshot: unknown = JSON.parse(raw);
    if (
      !isRecord(snapshot) ||
      snapshot.version !== 1 ||
      typeof snapshot.savedAt !== "number" ||
      !Number.isFinite(snapshot.savedAt) ||
      Date.now() - snapshot.savedAt > MAX_AGE_MS
    )
      return undefined;
    return displayDefaults(snapshot.defaults);
  } catch {
    // Storage availability only affects the next tab's opening display.
    return undefined;
  }
}

export function writeNewSessionDisplayDefaults(
  sourceKey: string,
  defaults: NewSessionDefaults | undefined,
): void {
  try {
    if (!defaults) {
      localStorage.removeItem(`${PREFIX}${sourceKey}`);
      return;
    }
    localStorage.setItem(
      `${PREFIX}${sourceKey}`,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        defaults: displayDefaults(defaults),
      }),
    );
  } catch {
    // Storage pressure must not turn an accepted settings update into failure.
  }
}
