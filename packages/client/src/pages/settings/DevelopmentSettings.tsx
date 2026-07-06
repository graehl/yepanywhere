import { useCallback, useEffect, useMemo, useState } from "react";
import { useSchemaValidationContext } from "../../contexts/SchemaValidationContext";
import { useDeveloperMode } from "../../hooks/useDeveloperMode";
import { useReloadNotifications } from "../../hooks/useReloadNotifications";
import { useSchemaValidation } from "../../hooks/useSchemaValidation";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useSessionPerformanceSettings } from "../../hooks/useSessionPerformanceSettings";
import { useI18n } from "../../i18n";
import {
  SESSION_SCROLL_BEHAVIOR_MODES,
  type SessionScrollBehaviorMode,
} from "../../lib/sessionScrollBehavior";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { useSettingsUndoBaseline } from "./SettingsUndoContext";

type SessionScrollMemoryModeDescriptionKey =
  | "developmentSessionScrollMemoryModeLiveTailDescription"
  | "developmentSessionScrollMemoryModeRememberPlaceDescription"
  | "developmentSessionScrollMemoryModeManualFollowDescription"
  | "developmentSessionScrollMemoryModeNoMemoryDescription";

type SessionScrollMemoryModeLabelKey =
  | "developmentSessionScrollMemoryModeLiveTail"
  | "developmentSessionScrollMemoryModeRememberPlace"
  | "developmentSessionScrollMemoryModeManualFollow"
  | "developmentSessionScrollMemoryModeNoMemory";

const sessionScrollMemoryModeDescriptionKeys: Record<
  SessionScrollBehaviorMode,
  SessionScrollMemoryModeDescriptionKey
> = {
  "live-tail": "developmentSessionScrollMemoryModeLiveTailDescription",
  "remember-place": "developmentSessionScrollMemoryModeRememberPlaceDescription",
  "manual-follow": "developmentSessionScrollMemoryModeManualFollowDescription",
  "no-memory": "developmentSessionScrollMemoryModeNoMemoryDescription",
};

const sessionScrollMemoryModeLabelKeys: Record<
  SessionScrollBehaviorMode,
  SessionScrollMemoryModeLabelKey
> = {
  "live-tail": "developmentSessionScrollMemoryModeLiveTail",
  "remember-place": "developmentSessionScrollMemoryModeRememberPlace",
  "manual-follow": "developmentSessionScrollMemoryModeManualFollow",
  "no-memory": "developmentSessionScrollMemoryModeNoMemory",
};

export function DevelopmentSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("developmentSectionTitle"));
  const {
    isManualReloadMode,
    pendingReloads,
    connected,
    reloadBackend,
    unsafeToRestart,
    interruptibleSessionCount,
  } = useReloadNotifications();
  const { settings: validationSettings, setEnabled: setValidationEnabled } =
    useSchemaValidation();
  const {
    relayDebugEnabled,
    setRelayDebugEnabled,
    remoteLogCollectionEnabled,
    setRemoteLogCollectionEnabled,
  } = useDeveloperMode();
  const {
    sessionScrollBehaviorMode,
    setSessionScrollBehaviorMode,
  } = useSessionPerformanceSettings();
  const { ignoredTools, clearIgnoredTools } = useSchemaValidationContext();
  const { settings: serverSettings, updateSetting: updateServerSetting } =
    useServerSettings();

  const undoState = useMemo(
    () =>
      serverSettings
        ? {
            validationEnabled: validationSettings.enabled,
            relayDebugEnabled,
            remoteLogCollectionEnabled,
            sessionScrollBehaviorMode,
            serviceWorkerEnabled: serverSettings.serviceWorkerEnabled ?? true,
            workstreamsEnabled: serverSettings.workstreamsEnabled ?? false,
          }
        : null,
    [
      validationSettings.enabled,
      relayDebugEnabled,
      remoteLogCollectionEnabled,
      serverSettings,
      sessionScrollBehaviorMode,
    ],
  );
  const restoreUndoState = useCallback(
    (snapshot: NonNullable<typeof undoState>) => {
      setValidationEnabled(snapshot.validationEnabled);
      setRelayDebugEnabled(snapshot.relayDebugEnabled);
      setRemoteLogCollectionEnabled(snapshot.remoteLogCollectionEnabled);
      setSessionScrollBehaviorMode(snapshot.sessionScrollBehaviorMode);
      void updateServerSetting(
        "serviceWorkerEnabled",
        snapshot.serviceWorkerEnabled,
      );
      void updateServerSetting(
        "workstreamsEnabled",
        snapshot.workstreamsEnabled,
      );
    },
    [
      setValidationEnabled,
      setRelayDebugEnabled,
      setRemoteLogCollectionEnabled,
      setSessionScrollBehaviorMode,
      updateServerSetting,
    ],
  );
  useSettingsUndoBaseline(undoState, restoreUndoState);

  const [restarting, setRestarting] = useState(false);
  // When SSE reconnects after restart, re-enable the button
  useEffect(() => {
    if (restarting && connected) {
      setRestarting(false);
    }
  }, [restarting, connected]);

  const handleRestartServer = async () => {
    setRestarting(true);
    await reloadBackend();
  };

  // Only render in manual reload mode (dev mode)
  if (!isManualReloadMode) {
    return null;
  }

  return (
    <section className="settings-section">
      <div className="settings-group">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("developmentSchemaTitle")}</strong>
            <p>{t("developmentSchemaDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={validationSettings.enabled}
              onChange={(e) => setValidationEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        {ignoredTools.length > 0 && (
          <div className="settings-item">
            <div className="settings-item-info">
              <strong>{t("developmentIgnoredToolsTitle")}</strong>
              <p>{t("developmentIgnoredToolsDescription")}</p>
              <div className="ignored-tools-list">
                {ignoredTools.map((tool) => (
                  <span key={tool} className="ignored-tool-badge">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="settings-button settings-button-secondary"
              onClick={clearIgnoredTools}
            >
              {t("developmentClearIgnored")}
            </button>
          </div>
        )}
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("developmentRelayDebugTitle")}</strong>
            <p>{t("developmentRelayDebugDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t("developmentRelayDebugTitle")}
              checked={relayDebugEnabled}
              onChange={(e) => setRelayDebugEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("developmentDiagnosticsTitle")}</strong>
            <p>{t("developmentDiagnosticsDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={remoteLogCollectionEnabled}
              onChange={(e) => setRemoteLogCollectionEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("developmentServiceWorkerTitle")}</strong>
            <p>{t("developmentServiceWorkerDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={serverSettings?.serviceWorkerEnabled ?? true}
              onChange={(e) =>
                updateServerSetting("serviceWorkerEnabled", e.target.checked)
              }
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("developmentWorkstreamsTitle")}</strong>
            <p>{t("developmentWorkstreamsDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={serverSettings?.workstreamsEnabled ?? false}
              onChange={(e) =>
                updateServerSetting("workstreamsEnabled", e.target.checked)
              }
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      <div className="settings-group">
        <details>
          <summary className="settings-hint">
            <strong>{t("developmentSessionScrollMemoryTitle")}</strong>
          </summary>
          <div className="settings-item settings-item--wide-control">
            <div className="settings-item-info">
              <strong>{t("developmentSessionScrollMemoryControlTitle")}</strong>
              <p>{t("developmentSessionScrollMemoryDescription")}</p>
              <ul className="settings-option-description-list">
                {SESSION_SCROLL_BEHAVIOR_MODES.map((mode) => (
                  <li key={mode}>
                    <strong>{t(sessionScrollMemoryModeLabelKeys[mode])}</strong>
                    <span>
                      {t(sessionScrollMemoryModeDescriptionKeys[mode])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="settings-item-actions">
              <select
                className="settings-select"
                value={sessionScrollBehaviorMode}
                onChange={(event) =>
                  setSessionScrollBehaviorMode(
                    event.target.value as SessionScrollBehaviorMode,
                  )
                }
                aria-label={t("developmentSessionScrollMemoryControlTitle")}
              >
                {SESSION_SCROLL_BEHAVIOR_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(sessionScrollMemoryModeLabelKeys[mode])}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </details>
      </div>

      <div className="settings-group">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("developmentRestartTitle")}</strong>
            <p>
              {t("developmentRestartDescription")}
              {pendingReloads.backend && (
                <span className="settings-pending">
                  {" "}
                  {t("developmentChangesPending")}
                </span>
              )}
            </p>
            {unsafeToRestart && (
              <p className="settings-warning">
                {t("developmentInterruptedWarning", {
                  count: interruptibleSessionCount,
                  suffix: interruptibleSessionCount !== 1 ? "s " : " ",
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            className={`settings-button ${unsafeToRestart ? "settings-button-danger" : ""}`}
            onClick={handleRestartServer}
            disabled={restarting}
          >
            {restarting
              ? t("developmentRestarting")
              : unsafeToRestart
                ? t("developmentRestartAnyway")
                : t("developmentRestart")}
          </button>
        </div>
      </div>
    </section>
  );
}
