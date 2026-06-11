import { useCallback, useEffect, useState } from "react";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

const JOIN_WINDOW_SLIDER_MAX_SECONDS = 120;
const JOIN_WINDOW_MAX_SECONDS = 86400;

function parseJoinWindowSeconds(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, JOIN_WINDOW_MAX_SECONDS);
}

export function MessageDeliverySettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSettings } = useServerSettings();
  const [joinWindowSeconds, setJoinWindowSeconds] = useState("0");
  const [composeAnchorsEnabled, setComposeAnchorsEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const serverJoinWindowSeconds = settings?.deferredJoinWindowSeconds ?? 0;
  const serverComposeAnchorsEnabled = settings?.composeAnchorsEnabled ?? false;
  const safeJoinWindowSeconds = parseJoinWindowSeconds(joinWindowSeconds);
  const hasChanges =
    safeJoinWindowSeconds !== serverJoinWindowSeconds ||
    composeAnchorsEnabled !== serverComposeAnchorsEnabled;

  useEffect(() => {
    if (!settings) return;
    setJoinWindowSeconds(String(serverJoinWindowSeconds));
    setComposeAnchorsEnabled(serverComposeAnchorsEnabled);
  }, [settings, serverComposeAnchorsEnabled, serverJoinWindowSeconds]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        deferredJoinWindowSeconds: safeJoinWindowSeconds,
        composeAnchorsEnabled,
      });
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("messageDeliverySaveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [composeAnchorsEnabled, safeJoinWindowSeconds, t, updateSettings]);

  if (isLoading) {
    return (
      <section className="settings-section">
        <h2>{t("messageDeliveryTitle")}</h2>
        <p className="settings-section-description">
          {t("messageDeliveryLoading")}
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2>{t("messageDeliveryTitle")}</h2>
      <p className="settings-section-description">
        {t("messageDeliveryDescription")}
      </p>

      <div className="settings-group">
        <div className="settings-item model-settings-item">
          <div className="settings-item-info">
            <strong>{t("messageDeliveryJoinWindowTitle")}</strong>
            <p>{t("messageDeliveryJoinWindowDescription")}</p>
          </div>
          <span className="output-appearance-slider-row">
            <input
              id="message-delivery-join-window"
              type="range"
              min={0}
              max={JOIN_WINDOW_SLIDER_MAX_SECONDS}
              step={5}
              value={Math.min(
                safeJoinWindowSeconds,
                JOIN_WINDOW_SLIDER_MAX_SECONDS,
              )}
              onChange={(e) => {
                setJoinWindowSeconds(e.target.value);
                setSaveError(null);
              }}
            />
            <span className="output-appearance-number-wrap">
              <input
                type="number"
                className="settings-input-small output-appearance-number"
                min={0}
                max={JOIN_WINDOW_MAX_SECONDS}
                value={joinWindowSeconds}
                onChange={(e) => {
                  setJoinWindowSeconds(e.target.value);
                  setSaveError(null);
                }}
                aria-label={t("messageDeliveryJoinWindowTitle")}
              />
              <span className="output-appearance-unit">s</span>
            </span>
          </span>
          <span className="settings-hint">
            {safeJoinWindowSeconds === 0
              ? t("messageDeliveryJoinWindowOffHint")
              : t("messageDeliveryJoinWindowOnHint", {
                  seconds: String(safeJoinWindowSeconds),
                })}
          </span>
        </div>

        <label className="settings-item">
          <div className="settings-item-info">
            <strong>{t("messageDeliveryComposeAnchorsTitle")}</strong>
            <p>{t("messageDeliveryComposeAnchorsDescription")}</p>
          </div>
          <input
            type="checkbox"
            checked={composeAnchorsEnabled}
            onChange={(e) => {
              setComposeAnchorsEnabled(e.target.checked);
              setSaveError(null);
            }}
            aria-label={t("messageDeliveryComposeAnchorsTitle")}
          />
        </label>

        <div
          className="settings-item"
          style={{ justifyContent: "flex-end", gap: "var(--space-2)" }}
        >
          <button
            type="button"
            className="settings-button"
            disabled={!hasChanges || isSaving}
            onClick={handleSave}
          >
            {isSaving ? t("providersSaving") : t("providersSave")}
          </button>
        </div>

        {(saveError || error) && (
          <p className="settings-warning">{saveError || error}</p>
        )}
      </div>
    </section>
  );
}
