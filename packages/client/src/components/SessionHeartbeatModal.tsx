import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { Modal } from "./ui/Modal";

const DEFAULT_HEARTBEAT_TEXT = "yepanywhere heartbeat";
const DEFAULT_HEARTBEAT_AFTER_MINUTES = 5;

interface SessionHeartbeatModalProps {
  sessionId: string;
  enabled: boolean;
  heartbeatTurnsAfterMinutes?: number;
  heartbeatTurnText?: string;
  onClose: () => void;
  onSaved: (settings: {
    enabled: boolean;
    heartbeatTurnsAfterMinutes?: number;
    heartbeatTurnText?: string;
  }) => void;
}

export function SessionHeartbeatModal({
  sessionId,
  enabled,
  heartbeatTurnsAfterMinutes,
  heartbeatTurnText,
  onClose,
  onSaved,
}: SessionHeartbeatModalProps) {
  const { t } = useI18n();
  const { settings } = useServerSettings();
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [afterMinutes, setAfterMinutes] = useState(
    heartbeatTurnsAfterMinutes ? String(heartbeatTurnsAfterMinutes) : "",
  );
  const [text, setText] = useState(heartbeatTurnText ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsEnabled(enabled);
    setAfterMinutes(
      heartbeatTurnsAfterMinutes ? String(heartbeatTurnsAfterMinutes) : "",
    );
    setText(heartbeatTurnText ?? "");
  }, [enabled, heartbeatTurnText, heartbeatTurnsAfterMinutes]);

  const defaultAfterMinutes =
    settings?.heartbeatTurnsAfterMinutes ?? DEFAULT_HEARTBEAT_AFTER_MINUTES;
  const defaultText = settings?.heartbeatTurnText ?? DEFAULT_HEARTBEAT_TEXT;

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const trimmedText = text.trim();
      const parsedAfterMinutes = Number.parseInt(afterMinutes, 10);
      const heartbeatTurnsAfterMinutesUpdate =
        afterMinutes.trim().length === 0
          ? null
          : Number.isFinite(parsedAfterMinutes) && parsedAfterMinutes >= 1
            ? Math.min(parsedAfterMinutes, 1440)
            : Number.NaN;

      if (Number.isNaN(heartbeatTurnsAfterMinutesUpdate)) {
        throw new Error(t("sessionHeartbeatSaveFailed"));
      }

      await api.updateSessionMetadata(sessionId, {
        heartbeatTurnsEnabled: isEnabled,
        heartbeatTurnsAfterMinutes: heartbeatTurnsAfterMinutesUpdate,
        heartbeatTurnText: trimmedText.length > 0 ? trimmedText : null,
      });

      onSaved({
        enabled: isEnabled,
        heartbeatTurnsAfterMinutes:
          heartbeatTurnsAfterMinutesUpdate === null
            ? undefined
            : heartbeatTurnsAfterMinutesUpdate,
        heartbeatTurnText: trimmedText || undefined,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("sessionHeartbeatSaveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [afterMinutes, isEnabled, onClose, onSaved, sessionId, t, text]);

  return (
    <Modal title={t("sessionHeartbeatTitle")} onClose={onClose}>
      <div className="settings-group session-heartbeat-modal">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("sessionHeartbeatEnabledTitle")}</strong>
            <p>{t("sessionHeartbeatEnabledDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => {
                setIsEnabled(e.target.checked);
                setError(null);
              }}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("sessionHeartbeatAfterTitle")}</strong>
            <p>
              {t("sessionHeartbeatAfterDescription", {
                value: defaultAfterMinutes,
              })}
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={1440}
            value={afterMinutes}
            onChange={(e) => {
              setAfterMinutes(e.target.value);
              setError(null);
            }}
            className="session-heartbeat-input session-heartbeat-input-small"
            placeholder={String(defaultAfterMinutes)}
          />
        </div>

        <div
          className="settings-item"
          style={{ flexDirection: "column", alignItems: "stretch" }}
        >
          <div className="settings-item-info">
            <strong>{t("sessionHeartbeatTextTitle")}</strong>
            <p>{t("sessionHeartbeatTextDescription")}</p>
          </div>
          <input
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, 200));
              setError(null);
            }}
            className="session-heartbeat-input"
            placeholder={defaultText}
          />
          <p className="settings-hint session-heartbeat-hint">
            {t("sessionHeartbeatDefaultHint", {
              text: defaultText,
            })}
          </p>
        </div>

        <div className="session-heartbeat-actions">
          <button
            type="button"
            className="settings-button settings-button-secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            {t("sessionHeartbeatCancel")}
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? t("providersSaving") : t("providersSave")}
          </button>
        </div>

        {error && <p className="settings-warning">{error}</p>}
      </div>
    </Modal>
  );
}
