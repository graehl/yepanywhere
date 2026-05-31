import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

interface PublicShareStatus {
  enabled: boolean;
  configured: boolean;
  requiresRelay: boolean;
}

export function AdvancedSettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSetting } = useServerSettings();
  const [publicShareStatus, setPublicShareStatus] =
    useState<PublicShareStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api
      .getPublicShareStatus()
      .then((status) => {
        if (!cancelled) {
          setPublicShareStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPublicShareStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const publicSharesEnabled = settings?.publicSharesEnabled ?? false;
  const relayConfigured = publicShareStatus?.configured ?? false;

  return (
    <section className="settings-section">
      <h2>{t("advancedSectionTitle")}</h2>
      <p className="settings-section-description">
        {t("advancedSectionDescription")}
      </p>

      <div className="settings-group">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("advancedPublicShareTitle")}</strong>
            <p>{t("advancedPublicShareDescription")}</p>
            <p>{t("advancedPublicSharePrivacyWarning")}</p>
            <p>{t("advancedPublicShareExistingManagement")}</p>
            {publicShareStatus && (
              <p
                className={
                  relayConfigured ? "settings-hint" : "settings-warning"
                }
              >
                {relayConfigured
                  ? t("advancedPublicShareRelayConfigured")
                  : t("advancedPublicShareRelayMissing")}
              </p>
            )}
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={publicSharesEnabled}
              disabled={isLoading}
              onChange={(e) =>
                void updateSetting("publicSharesEnabled", e.target.checked)
              }
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {error && <p className="settings-warning">{error}</p>}
    </section>
  );
}
