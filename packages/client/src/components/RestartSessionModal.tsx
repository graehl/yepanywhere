import type {
  EffortLevel,
  ModelInfo,
  NewSessionDefaults,
  ProviderName,
  ThinkingOption,
} from "@yep-anywhere/shared";
import { resolveModel } from "@yep-anywhere/shared";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { getModelSetting } from "../hooks/useModelSettings";
import { useServerSettings } from "../hooks/useServerSettings";
import type { PermissionMode } from "../types";
import { useI18n } from "../i18n";
import { Modal } from "./ui/Modal";

type ThinkingMode = "off" | "auto" | "on";

const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "max"];

function parseThinkingOption(option: ThinkingOption | undefined): {
  mode: ThinkingMode;
  effort: EffortLevel;
} {
  if (!option || option === "off") {
    return { mode: "off", effort: "high" };
  }
  if (option === "auto") {
    return { mode: "auto", effort: "high" };
  }
  if (option.startsWith("on:")) {
    const effort = option.slice(3);
    return {
      mode: "on",
      effort: EFFORT_LEVELS.includes(effort as EffortLevel)
        ? (effort as EffortLevel)
        : "high",
    };
  }
  return {
    mode: "on",
    effort: EFFORT_LEVELS.includes(option as EffortLevel)
      ? (option as EffortLevel)
      : "high",
  };
}

function toThinkingOption(
  mode: ThinkingMode,
  effort: EffortLevel,
): ThinkingOption {
  if (mode === "off") return "off";
  if (mode === "auto") return "auto";
  return `on:${effort}`;
}

function getPreferredModelId(
  models: ModelInfo[],
  preferredModelId?: string | null,
): string | null {
  if (preferredModelId) {
    const matchingPreferredModel = models.find((m) => m.id === preferredModelId);
    if (matchingPreferredModel) return matchingPreferredModel.id;
  }

  return models.find((m) => m.id === "default")?.id ?? models[0]?.id ?? null;
}

function getRestartDefaultModel(params: {
  provider: ProviderName;
  models: ModelInfo[];
  currentModel?: string;
  defaults?: NewSessionDefaults | null;
}): string {
  const sessionDefaultModel =
    params.defaults?.provider === params.provider ? params.defaults.model : undefined;
  const legacyClaudeFallbackModel =
    params.provider === "claude" ? resolveModel(getModelSetting()) : undefined;

  return (
    getPreferredModelId(
      params.models,
      sessionDefaultModel ?? legacyClaudeFallbackModel ?? params.currentModel,
    ) ??
    params.currentModel ??
    "default"
  );
}

interface RestartSessionModalProps {
  projectId: string;
  sessionId: string;
  provider: ProviderName;
  providerDisplayName?: string;
  models?: ModelInfo[];
  currentModel?: string;
  mode?: PermissionMode;
  thinking?: ThinkingOption;
  executor?: string;
  onRestarted: (result: {
    sessionId: string;
    processId: string;
    model?: string;
    oldProcessAborted: boolean;
  }, options?: {
    openInNewWindow?: boolean;
    targetWindow?: Window | null;
  }) => void;
  onClose: () => void;
}

export function RestartSessionModal({
  projectId,
  sessionId,
  provider,
  providerDisplayName,
  models = [],
  currentModel,
  mode,
  thinking,
  executor,
  onRestarted,
  onClose,
}: RestartSessionModalProps) {
  const { t } = useI18n();
  const { settings, isLoading: settingsLoading } = useServerSettings();
  const modelOptions = useMemo<ModelInfo[]>(() => {
    if (models.length > 0) return models;
    return [{ id: "default", name: "Default" }];
  }, [models]);
  const [selectedModel, setSelectedModel] = useState<string>(
    getRestartDefaultModel({
      provider,
      models: modelOptions,
      currentModel,
      defaults: settings?.newSessionDefaults,
    }),
  );
  const hasUserSelectedModelRef = useRef(false);
  const initialThinking = useMemo(
    () => parseThinkingOption(thinking),
    [thinking],
  );
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(
    initialThinking.mode,
  );
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(
    initialThinking.effort,
  );
  const [openInNewWindow, setOpenInNewWindow] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settingsLoading || hasUserSelectedModelRef.current) {
      return;
    }
    setSelectedModel(
      getRestartDefaultModel({
        provider,
        models: modelOptions,
        currentModel,
        defaults: settings?.newSessionDefaults,
      }),
    );
  }, [currentModel, modelOptions, provider, settings, settingsLoading]);

  useEffect(() => {
    setThinkingMode(initialThinking.mode);
    setEffortLevel(initialThinking.effort);
  }, [initialThinking]);

  const renderThinkingLabel = (mode: ThinkingMode, effort: EffortLevel) => {
    if (mode === "off") return t("newSessionThinkingOff");
    if (mode === "auto") return t("newSessionThinkingAuto");
    return t("newSessionThinkingOn", { level: effort });
  };

  const restart = async (targetNewWindow = false) => {
    if (restarting) return;
    const shouldOpenInNewWindow = targetNewWindow || openInNewWindow;
    const targetWindow = shouldOpenInNewWindow
      ? window.open("about:blank", "_blank")
      : null;
    if (targetWindow) {
      targetWindow.opener = null;
    }
    setRestarting(true);
    setError(null);
    try {
      const result = await api.restartSession(projectId, sessionId, {
        mode,
        model: selectedModel,
        thinking: toThinkingOption(thinkingMode, effortLevel),
        provider,
        executor,
        reason: "Manual restart from Yep Anywhere",
      });
      onRestarted(result, {
        openInNewWindow: shouldOpenInNewWindow,
        targetWindow,
      });
    } catch (err) {
      targetWindow?.close();
      setError(err instanceof Error ? err.message : t("sessionRestartFailed"));
      setRestarting(false);
    }
  };

  const handleStartClick = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    void restart(event.metaKey || event.ctrlKey || event.shiftKey);
  };

  const handleStartAuxClick = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 1) return;
    event.preventDefault();
    void restart(true);
  };

  return (
    <Modal title={t("sessionRestartTitle")} onClose={restarting ? () => {} : onClose}>
      <div className="model-switch-content">
        <div className="model-switch-status">
          <div className="model-switch-status-row">
            <span className="model-switch-status-marker">
              {t("modelSwitchCurrent")}
            </span>
            <span className="model-switch-status-main">
              {currentModel ?? "Default"}
            </span>
            <span className="model-switch-status-detail">
              {providerDisplayName ?? provider}
            </span>
          </div>
          <div className="model-switch-status-row pending">
            <span className="model-switch-status-marker" aria-hidden="true">
              →
            </span>
            <span className="model-switch-status-main">
              {selectedModel ?? "Default"}
            </span>
            <span className="model-switch-status-detail">
              {renderThinkingLabel(thinkingMode, effortLevel)}
            </span>
          </div>
        </div>

        {error && <div className="model-switch-error">{error}</div>}

        <section className="model-switch-section">
          <div className="model-switch-section-header">
            <strong>{t("newSessionModelTitle")}</strong>
          </div>
          <div className="model-switch-list">
            {modelOptions.map((model) => {
              const isCurrent = currentModel === model.id;
              const isSelected = selectedModel === model.id;
              return (
                <div key={model.id} className="model-switch-item-row">
                  <button
                    type="button"
                    className={`model-switch-item ${isCurrent ? "current" : ""} ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      hasUserSelectedModelRef.current = true;
                      setSelectedModel(model.id);
                    }}
                    disabled={restarting}
                  >
                    <span className="model-switch-item-main">
                      <span className="model-switch-name">{model.name}</span>
                      {model.description && (
                        <span className="model-switch-description">
                          {model.description}
                        </span>
                      )}
                    </span>
                    <span className="model-switch-item-meta">
                      {isCurrent && (
                        <span className="model-switch-tag">
                          {t("modelSwitchCurrent")}
                        </span>
                      )}
                      <span
                        className={`model-switch-radio ${isSelected ? "selected" : ""}`}
                        aria-hidden="true"
                      >
                        {isSelected ? "●" : "○"}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="model-switch-section">
          <div className="model-switch-section-header">
            <strong>{t("newSessionThinkingMode")}</strong>
          </div>
          <div className="model-switch-chip-group">
            {(["off", "auto", "on"] as ThinkingMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`model-switch-chip ${thinkingMode === mode ? "active" : ""}`}
                onClick={() => setThinkingMode(mode)}
                disabled={restarting}
              >
                <span
                  className={`model-switch-indicator-dot tone-${
                    mode === "off"
                      ? "off"
                      : mode === "auto"
                        ? "auto"
                        : effortLevel
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {mode === "off"
                    ? t("newSessionThinkingOff")
                    : mode === "auto"
                      ? t("newSessionThinkingAuto")
                      : t("newSessionThinkingOn", { level: effortLevel })}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="model-switch-section">
          <div className="model-switch-section-header">
            <strong>{t("modelSettingsEffortTitle")}</strong>
          </div>
          <div className="model-switch-chip-group">
            {EFFORT_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={`model-switch-chip ${
                  thinkingMode === "on" && effortLevel === level ? "active" : ""
                }`}
                onClick={() => {
                  setThinkingMode("on");
                  setEffortLevel(level);
                }}
                disabled={restarting}
              >
                <span
                  className={`model-switch-indicator-dot tone-${level}`}
                  aria-hidden="true"
                />
                <span>{level}</span>
              </button>
            ))}
          </div>
        </section>

        <label className="model-switch-chip">
          <input
            type="checkbox"
            checked={openInNewWindow}
            onChange={(event) => setOpenInNewWindow(event.currentTarget.checked)}
            disabled={restarting}
          />
          <span>{t("sessionRestartOpenNewWindow")}</span>
        </label>

        <div className="model-switch-actions">
          <button
            type="button"
            className="settings-button settings-button-secondary"
            onClick={onClose}
            disabled={restarting}
          >
            {t("modalCancel")}
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={handleStartClick}
            onAuxClick={handleStartAuxClick}
            disabled={restarting || !selectedModel}
          >
            {restarting ? t("sessionRestarting") : t("sessionRestartStart")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
