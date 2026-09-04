import type { TranslationFn } from "../i18n";

export interface SessionDefaultControlCopy {
  title: string;
  description?: string;
  settings?: {
    title?: string;
    keywords: string[];
  };
}

export function getSessionDefaultControlCopy(
  t: TranslationFn,
): Record<
  | "provider"
  | "model"
  | "thinking"
  | "permission"
  | "sandbox"
  | "sandboxFirewall"
  | "showThinking"
  | "recap"
  | "helperModel"
  | "suggestions",
  SessionDefaultControlCopy
> {
  return {
    provider: {
      title: t("newSessionProviderTitle"),
      description: t("modelSettingsDefaultProviderDescription"),
      settings: {
        title: t("modelSettingsDefaultProviderTitle"),
        keywords: ["provider", "ai provider"],
      },
    },
    model: {
      title: t("newSessionModelTitle"),
      description: t("modelSettingsDefaultModelDescription"),
      settings: {
        title: t("modelSettingsDefaultModelTitle"),
        keywords: ["model", "default model"],
      },
    },
    thinking: {
      title: t("modelSettingsThinkingTitle"),
      description: t("modelSettingsThinkingDescription"),
      settings: { keywords: ["thinking", "effort", "reasoning mode"] },
    },
    permission: {
      title: t("newSessionModeTitle"),
      settings: {
        keywords: ["permission mode", "bypass", "plan", "accept edits"],
      },
    },
    sandbox: {
      title: t("newSessionSandboxTitle"),
      description: [
        t("newSessionSandboxDescription"),
        t("newSessionSandboxAvailability"),
      ].join(" "),
      settings: {
        title: t("modelSettingsSandboxDefaultTitle"),
        keywords: ["sandbox", "bubblewrap", "project writes"],
      },
    },
    sandboxFirewall: {
      title: t("newSessionSandboxNetworkFirewallLabel"),
      description: t("newSessionSandboxNetworkFirewallDescription"),
      settings: { keywords: ["sandbox", "network", "firewall", "localhost"] },
    },
    showThinking: {
      title: t("showThinkingTitle"),
      description: t("showThinkingHint"),
      settings: {
        keywords: ["show thinking", "reasoning", "display thinking"],
      },
    },
    recap: {
      title: t("newSessionRecapTitle"),
      settings: {
        keywords: ["recap", "away summary", "side session", "fork"],
      },
    },
    helperModel: {
      title: t("helperSideModelTitle"),
      description: t("helperSideModelDescription"),
      settings: {
        keywords: [
          "helper model",
          "tailed recap",
          "side session model",
          "recap model",
        ],
      },
    },
    suggestions: {
      title: t("newSessionPromptSuggestionsTitle"),
      settings: {
        keywords: ["suggestions", "prompt suggestions", "nudge"],
      },
    },
  };
}
