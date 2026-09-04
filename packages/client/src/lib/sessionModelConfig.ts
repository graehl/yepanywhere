import type {
  PromptSuggestionMode,
  SessionEffectiveModelSettings,
} from "@yep-anywhere/shared";

export interface SessionModelConfig {
  model?: string;
  /** YA model id used for per-model settings, distinct from reported model. */
  requestedModel?: string;
  thinking?: { type: string };
  effort?: string;
  promptSuggestionMode?: PromptSuggestionMode;
}

export interface LiveSessionModelConfigSnapshot {
  processId: string;
  config: SessionModelConfig;
}

function firstKnown<T>(...values: Array<T | null | undefined>): T | undefined {
  const value = values.find((candidate) => candidate !== undefined);
  return value ?? undefined;
}

function durableDisplayedModel(
  durable: SessionEffectiveModelSettings | undefined,
): string | null | undefined {
  if (!durable) return undefined;
  const requestedModel = durable.requestedModel?.trim();
  return requestedModel && requestedModel !== "default" ? requestedModel : null;
}

export function liveModelConfigForProcess(
  snapshot: LiveSessionModelConfigSnapshot | null,
  processId: string | undefined,
): SessionModelConfig | null {
  if (!snapshot || snapshot.processId !== processId) return null;
  return snapshot.config;
}

export function resolveSessionModelConfig(
  live: SessionModelConfig | null,
  durable: SessionEffectiveModelSettings | undefined,
  initialAck: SessionModelConfig | null,
): SessionModelConfig | null {
  if (!live && !durable && !initialAck) return null;

  return {
    model: firstKnown(
      live?.model,
      durableDisplayedModel(durable),
      initialAck?.model,
    ),
    requestedModel: firstKnown(live?.requestedModel, durable?.requestedModel),
    thinking: firstKnown(
      live?.thinking,
      durable?.thinking,
      initialAck?.thinking,
    ),
    effort: firstKnown(live?.effort, durable?.effort, initialAck?.effort),
    promptSuggestionMode: live?.promptSuggestionMode,
  };
}
