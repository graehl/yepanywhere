import type {
  EffortLevel,
  ProviderInfo,
  ProviderName,
  ThinkingConfig,
  ThinkingMode,
  ThinkingOption,
} from "@yep-anywhere/shared";
import {
  getThinkingModeFromProcess,
  normalizeEffortLevel,
} from "./modelConfigIndicator";

export interface LiveThinkingSelection {
  mode: ThinkingMode;
  effortLevel: EffortLevel;
}

export function thinkingOptionFromSelection(
  mode: ThinkingMode,
  effortLevel: EffortLevel,
): ThinkingOption {
  if (mode === "off") return "off";
  if (mode === "auto") return "auto";
  return `on:${effortLevel}`;
}

export function liveThinkingSelectionFromProcess(
  thinking?: ThinkingConfig | { type: string } | null,
  effort?: string | null,
  provider?: ProviderInfo | ProviderName | null,
): LiveThinkingSelection {
  return {
    mode: getThinkingModeFromProcess(
      thinking ?? undefined,
      effort ?? undefined,
    ),
    effortLevel: normalizeEffortLevel(effort ?? undefined, provider),
  };
}

export function thinkingOptionFromProcess(
  thinking?: ThinkingConfig | { type: string } | null,
  effort?: string | null,
  provider?: ProviderInfo | ProviderName | null,
): ThinkingOption {
  const selection = liveThinkingSelectionFromProcess(
    thinking,
    effort,
    provider,
  );
  return thinkingOptionFromSelection(selection.mode, selection.effortLevel);
}
