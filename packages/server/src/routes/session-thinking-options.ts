import {
  thinkingOptionToConfig,
  type EffortLevel,
  type ShowThinking,
  type ThinkingConfig,
  type ThinkingOption,
} from "@yep-anywhere/shared";

interface ThinkingOptionsBody {
  thinking?: ThinkingOption;
  showThinking?: ShowThinking;
}

export interface SessionThinkingOptions {
  thinking: ThinkingConfig | undefined;
  effort?: EffortLevel;
}

export function buildThinkingOptions(
  body: ThinkingOptionsBody,
): SessionThinkingOptions {
  return body.thinking
    ? thinkingOptionToConfig(body.thinking, body.showThinking)
    : { thinking: undefined, effort: undefined };
}
