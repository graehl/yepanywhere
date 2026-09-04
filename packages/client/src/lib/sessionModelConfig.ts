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

function firstKnown<T>(...values: Array<T | null | undefined>): T | undefined {
  const value = values.find((candidate) => candidate !== undefined);
  return value ?? undefined;
}

export function resolveSessionModelConfig(
  live: SessionModelConfig | null,
  durable: SessionEffectiveModelSettings | undefined,
  initialAck: SessionModelConfig | null,
): SessionModelConfig | null {
  if (!live && !durable && !initialAck) return null;

  return {
    model: firstKnown(live?.model, initialAck?.model),
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
