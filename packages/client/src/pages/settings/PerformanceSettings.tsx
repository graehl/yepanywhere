import { useCallback, useMemo } from "react";
import { useSessionLoadingProgress } from "../../hooks/useSessionLoadingProgress";
import { useSessionPerformanceSettings } from "../../hooks/useSessionPerformanceSettings";
import { useStableToolPreviewRendering } from "../../hooks/useStableToolPreviewRendering";
import { useStreamingEnabled } from "../../hooks/useStreamingEnabled";
import { useI18n } from "../../i18n";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { useSettingsUndoBaseline } from "./SettingsUndoContext";

export function PerformanceSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("performanceSectionTitle"));
  const { streamingEnabled, setStreamingEnabled } = useStreamingEnabled();
  const { sessionLoadingProgressEnabled, setSessionLoadingProgressEnabled } =
    useSessionLoadingProgress();
  const {
    sessionDomLingerEnabled,
    sessionTranscriptCacheEnabled,
    setSessionDomLingerEnabled,
    setSessionTranscriptCacheEnabled,
  } = useSessionPerformanceSettings();
  const { stableToolPreviewRendering, setStableToolPreviewRendering } =
    useStableToolPreviewRendering();

  const undoState = useMemo(
    () => ({
      streamingEnabled,
      sessionLoadingProgressEnabled,
      sessionDomLingerEnabled,
      sessionTranscriptCacheEnabled,
      stableToolPreviewRendering,
    }),
    [
      streamingEnabled,
      sessionLoadingProgressEnabled,
      sessionDomLingerEnabled,
      sessionTranscriptCacheEnabled,
      stableToolPreviewRendering,
    ],
  );
  const restoreUndoState = useCallback(
    (snapshot: typeof undoState) => {
      setStreamingEnabled(snapshot.streamingEnabled);
      setSessionLoadingProgressEnabled(snapshot.sessionLoadingProgressEnabled);
      setSessionDomLingerEnabled(snapshot.sessionDomLingerEnabled);
      setSessionTranscriptCacheEnabled(snapshot.sessionTranscriptCacheEnabled);
      setStableToolPreviewRendering(snapshot.stableToolPreviewRendering);
    },
    [
      setStreamingEnabled,
      setSessionLoadingProgressEnabled,
      setSessionDomLingerEnabled,
      setSessionTranscriptCacheEnabled,
      setStableToolPreviewRendering,
    ],
  );
  useSettingsUndoBaseline(undoState, restoreUndoState);

  return (
    <section className="settings-section">
      <p className="settings-section-description">
        {t("performanceSectionDescription")}
      </p>
      <div className="settings-group">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("appearanceStreamingTitle")}</strong>
            <p>{t("appearanceStreamingDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={streamingEnabled}
              onChange={(event) => setStreamingEnabled(event.target.checked)}
              aria-label={t("appearanceStreamingTitle")}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("appearanceSessionLoadingProgressTitle")}</strong>
            <p>{t("appearanceSessionLoadingProgressDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={sessionLoadingProgressEnabled}
              onChange={(event) =>
                setSessionLoadingProgressEnabled(event.target.checked)
              }
              aria-label={t("appearanceSessionLoadingProgressTitle")}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("performanceKeepRecentSessionMountedTitle")}</strong>
            <p>{t("performanceKeepRecentSessionMountedDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={sessionDomLingerEnabled}
              onChange={(event) =>
                setSessionDomLingerEnabled(event.target.checked)
              }
              aria-label={t("performanceKeepRecentSessionMountedTitle")}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("performanceTranscriptCacheTitle")}</strong>
            <p>{t("performanceTranscriptCacheDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={sessionTranscriptCacheEnabled}
              onChange={(event) =>
                setSessionTranscriptCacheEnabled(event.target.checked)
              }
              aria-label={t("performanceTranscriptCacheTitle")}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("appearanceStableToolPreviewTitle")}</strong>
            <p>{t("appearanceStableToolPreviewDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={stableToolPreviewRendering}
              onChange={(event) =>
                setStableToolPreviewRendering(event.target.checked)
              }
              aria-label={t("appearanceStableToolPreviewTitle")}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </section>
  );
}
