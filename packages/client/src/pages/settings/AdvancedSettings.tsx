import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

const DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL =
  "https://yepanywhere.com/remote/share";

interface PublicShareStatus {
  enabled: boolean;
  configured: boolean;
  requiresRelay: boolean;
  viewerBaseUrl: string | null;
  defaultViewerBaseUrl: string;
  viewerBaseUrlError?: string;
}

type PublicShareViewerOption = "default" | "custom";

export function AdvancedSettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSetting } = useServerSettings();
  const [publicShareStatus, setPublicShareStatus] =
    useState<PublicShareStatus | null>(null);
  const [viewerOption, setViewerOption] =
    useState<PublicShareViewerOption>("default");
  const [customViewerBaseUrl, setCustomViewerBaseUrl] = useState("");
  const [viewerSaveError, setViewerSaveError] = useState<string | null>(null);
  const [isSavingViewerUrl, setIsSavingViewerUrl] = useState(false);

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

  useEffect(() => {
    if (!settings) return;
    const savedBaseUrl = settings.publicShareViewerBaseUrl ?? "";
    setViewerOption(savedBaseUrl ? "custom" : "default");
    setCustomViewerBaseUrl(
      savedBaseUrl ||
        publicShareStatus?.viewerBaseUrl ||
        publicShareStatus?.defaultViewerBaseUrl ||
        DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL,
    );
  }, [
    publicShareStatus?.defaultViewerBaseUrl,
    publicShareStatus?.viewerBaseUrl,
    settings?.publicShareViewerBaseUrl,
  ]);

  const publicSharesEnabled = settings?.publicSharesEnabled ?? false;
  const relayConfigured = publicShareStatus?.configured ?? false;
  const defaultViewerBaseUrl =
    publicShareStatus?.defaultViewerBaseUrl ??
    DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL;
  const effectiveViewerBaseUrl =
    settings?.publicShareViewerBaseUrl ??
    publicShareStatus?.viewerBaseUrl ??
    defaultViewerBaseUrl;
  const customViewerHasChanges =
    customViewerBaseUrl.trim() !== (settings?.publicShareViewerBaseUrl ?? "");

  const handleViewerOptionChange = (option: PublicShareViewerOption) => {
    setViewerOption(option);
    setViewerSaveError(null);
    if (option === "default") {
      void updateSetting("publicShareViewerBaseUrl", undefined);
    } else if (!customViewerBaseUrl.trim()) {
      setCustomViewerBaseUrl(effectiveViewerBaseUrl);
    }
  };

  const handleSaveCustomViewerUrl = async () => {
    setIsSavingViewerUrl(true);
    setViewerSaveError(null);
    try {
      await updateSetting(
        "publicShareViewerBaseUrl",
        customViewerBaseUrl.trim(),
      );
    } catch (err) {
      setViewerSaveError(
        err instanceof Error
          ? err.message
          : t("advancedPublicShareViewerSaveFailed"),
      );
    } finally {
      setIsSavingViewerUrl(false);
    }
  };

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

        <div
          className="settings-item"
          style={{ flexDirection: "column", alignItems: "stretch" }}
        >
          <div className="settings-item-info">
            <strong>{t("advancedPublicShareViewerTitle")}</strong>
            <p>{t("advancedPublicShareViewerDescription")}</p>
            <p className="settings-hint" style={{ wordBreak: "break-all" }}>
              {t("advancedPublicShareViewerEffective", {
                url: effectiveViewerBaseUrl,
              })}
            </p>
            {publicShareStatus?.viewerBaseUrlError && (
              <p className="settings-warning">
                {publicShareStatus.viewerBaseUrlError}
              </p>
            )}
          </div>

          <select
            className="settings-select"
            style={{ width: "100%", maxWidth: "520px" }}
            value={viewerOption}
            disabled={isLoading}
            onChange={(e) =>
              handleViewerOptionChange(
                e.target.value as PublicShareViewerOption,
              )
            }
          >
            <option value="default">
              {t("advancedPublicShareViewerDefault", {
                url: defaultViewerBaseUrl,
              })}
            </option>
            <option value="custom">
              {t("advancedPublicShareViewerCustom")}
            </option>
          </select>

          {viewerOption === "custom" && (
            <div
              className="settings-item-form"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <label htmlFor="public-share-viewer-url">
                {t("advancedPublicShareViewerCustomLabel")}
              </label>
              <input
                id="public-share-viewer-url"
                type="url"
                className="settings-input"
                value={customViewerBaseUrl}
                onChange={(e) => {
                  setCustomViewerBaseUrl(e.target.value);
                  setViewerSaveError(null);
                }}
                placeholder={t("advancedPublicShareViewerPlaceholder")}
                disabled={isSavingViewerUrl}
              />
              <button
                type="button"
                className="settings-button settings-button-secondary"
                onClick={handleSaveCustomViewerUrl}
                disabled={
                  isSavingViewerUrl ||
                  !customViewerBaseUrl.trim() ||
                  !customViewerHasChanges
                }
              >
                {t("advancedPublicShareViewerSave")}
              </button>
              {viewerSaveError && (
                <p className="settings-warning">{viewerSaveError}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="settings-warning">{error}</p>}
    </section>
  );
}
