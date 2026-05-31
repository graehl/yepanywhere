import { useEffect, useState } from "react";
import type { PublicShareStatusResponse } from "../../api/client";
import type { ExperimentalFeatureId } from "../../hooks/useDeveloperMode";
import { useDeveloperMode } from "../../hooks/useDeveloperMode";
import { usePublicShareStatus } from "../../hooks/usePublicShareStatus";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

const DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL =
  "https://yepanywhere.com/remote/share";

type PublicShareViewerOption = "default" | "custom";

interface ExperimentalFeatureOption {
  id: ExperimentalFeatureId;
  titleKey: string;
  descriptionKey: string;
  topicHref: string;
}

const EXPERIMENTAL_FEATURE_OPTIONS: ExperimentalFeatureOption[] = [
  {
    id: "patientQueueMode",
    titleKey: "advancedExperimentalPatientQueueTitle",
    descriptionKey: "advancedExperimentalPatientQueueDescription",
    topicHref:
      "https://github.com/kzahel/yepanywhere/blob/main/topics/message-control-steer-queue-btw-later-interrupt.md",
  },
];

export function AdvancedSettings() {
  const { t } = useI18n();
  const {
    experimentalFeaturesEnabled,
    experimentalFeatures,
    setExperimentalFeaturesEnabled,
    setExperimentalFeatureEnabled,
  } = useDeveloperMode();
  const { settings, isLoading, error, updateSetting } = useServerSettings();
  const publicSharesEnabled = settings?.publicSharesEnabled ?? false;
  const { status: publicShareStatus } = usePublicShareStatus({
    poll: publicSharesEnabled,
  });
  const [viewerOption, setViewerOption] =
    useState<PublicShareViewerOption>("default");
  const [customViewerBaseUrl, setCustomViewerBaseUrl] = useState("");
  const [viewerSaveError, setViewerSaveError] = useState<string | null>(null);
  const [isSavingViewerUrl, setIsSavingViewerUrl] = useState(false);

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

  const defaultViewerBaseUrl =
    publicShareStatus?.defaultViewerBaseUrl ??
    DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL;
  const effectiveViewerBaseUrl =
    settings?.publicShareViewerBaseUrl ??
    publicShareStatus?.viewerBaseUrl ??
    defaultViewerBaseUrl;
  const customViewerHasChanges =
    customViewerBaseUrl.trim() !== (settings?.publicShareViewerBaseUrl ?? "");

  const getShareReadinessMessage = (
    status: PublicShareStatusResponse | null,
  ): { className: string; text: string } | null => {
    if (!status) return null;
    if (!status.configured) {
      return {
        className: "settings-warning",
        text: t("advancedPublicShareRelayMissing"),
      };
    }
    if (!status.remoteAccessEnabled) {
      return {
        className: "settings-warning",
        text: t("advancedPublicShareRemoteAccessDisabled"),
      };
    }
    if (status.relayStatus !== "waiting") {
      return {
        className: "settings-warning",
        text: t("advancedPublicShareRelayTemporarilyUnavailable", {
          status: status.relayStatus ?? "unknown",
        }),
      };
    }
    return {
      className: "settings-hint",
      text: t("advancedPublicShareReady"),
    };
  };

  const shareReadinessMessage = getShareReadinessMessage(publicShareStatus);

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
        <div className="settings-item experimental-features-settings">
          <div className="settings-item-header">
            <div className="settings-item-info">
              <strong>{t("advancedExperimentalFeaturesTitle")}</strong>
              <p>{t("advancedExperimentalFeaturesDescription")}</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                aria-label={t("advancedExperimentalFeaturesTitle")}
                checked={experimentalFeaturesEnabled}
                onChange={(e) =>
                  setExperimentalFeaturesEnabled(e.target.checked)
                }
              />
              <span className="toggle-slider" />
            </label>
          </div>
          {experimentalFeaturesEnabled && (
            <div
              className="experimental-feature-list"
              aria-label={t("advancedExperimentalFeatureListLabel")}
            >
              {EXPERIMENTAL_FEATURE_OPTIONS.map((feature) => (
                <div className="experimental-feature-option" key={feature.id}>
                  <div className="settings-item-info">
                    <strong>{t(feature.titleKey as never)}</strong>
                    <p>{t(feature.descriptionKey as never)}</p>
                    <p className="settings-hint">
                      <a
                        href={feature.topicHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("advancedExperimentalFeatureTopicLink")}
                      </a>
                    </p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      aria-label={t(feature.titleKey as never)}
                      checked={experimentalFeatures[feature.id]}
                      onChange={(e) =>
                        setExperimentalFeatureEnabled(
                          feature.id,
                          e.target.checked,
                        )
                      }
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("advancedPublicShareTitle")}</strong>
            <p>{t("advancedPublicShareDescription")}</p>
            <p>{t("advancedPublicSharePrivacyWarning")}</p>
            <p>{t("advancedPublicShareExistingManagement")}</p>
            {shareReadinessMessage && (
              <p className={shareReadinessMessage.className}>
                {shareReadinessMessage.text}
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
