import { useState } from "react";
import { useNotifyInApp } from "../hooks/useNotifyInApp";
import { usePushNotifications } from "../hooks/usePushNotifications";
import type {
  PushDeliveryUrgency,
  TestNotificationUrgency,
} from "../hooks/useSubscribedDevices";
import { useI18n } from "../i18n";

/**
 * Toggle component for push notification settings.
 * Shows subscription status, toggle switch, and test button.
 */
export function PushNotificationToggle() {
  const { t } = useI18n();
  const {
    isSupported,
    isSubscribed,
    isLoading,
    error,
    permission,
    subscribe,
    unsubscribe,
    sendTest,
  } = usePushNotifications();
  const { notifyInApp, setNotifyInApp } = useNotifyInApp();
  const [testUrgency, setTestUrgency] =
    useState<TestNotificationUrgency>("normal");
  const [deliveryUrgency, setDeliveryUrgency] =
    useState<PushDeliveryUrgency>("high");
  const [testSent, setTestSent] = useState(false);

  const handleSendTest = async () => {
    setTestSent(false);
    const accepted = await sendTest(testUrgency, deliveryUrgency);
    // On failure the hook's `error` line reports what went wrong.
    setTestSent(accepted);
  };

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  // Not supported - show message with reason and help link
  if (!isSupported) {
    // Check if this is specifically the dev mode SW disabled case
    const isDevModeDisabled = error?.includes(
      "Service worker disabled in dev mode",
    );

    return (
      <div className="settings-item">
        <div className="settings-item-info">
          <strong>{t("pushToggleTitle")}</strong>
          <p>{error || t("pushToggleUnsupported")}</p>
          {isDevModeDisabled && (
            <div className="settings-info-box" style={{ marginTop: "0.5rem" }}>
              <p>{t("pushToggleThisDeviceOnly")}</p>
              <p>{t("pushToggleDevModeHint")}</p>
            </div>
          )}
          <p style={{ marginTop: "0.5rem" }}>
            <a
              href="https://github.com/kzahel/yepanywhere/blob/main/docs/push-notifications.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("pushToggleTroubleshooting")}
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Permission denied - show how to fix
  if (permission === "denied") {
    return (
      <div className="settings-item">
        <div className="settings-item-info">
          <strong>{t("pushToggleTitle")}</strong>
          <p className="settings-warning">{t("pushToggleBlocked")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="settings-item">
        <div className="settings-item-info">
          <strong>{t("pushToggleTitle")}</strong>
          <p>{t("pushToggleDescription")}</p>
          {error && <p className="settings-error">{error}</p>}
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={isSubscribed}
            onChange={handleToggle}
            disabled={isLoading}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {isSubscribed && (
        <>
          <div className="settings-item">
            <div className="settings-item-info">
              <strong>{t("pushToggleNotifyInAppTitle")}</strong>
              <p>{t("pushToggleNotifyInAppDescription")}</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={notifyInApp}
                onChange={(e) => setNotifyInApp(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <strong>{t("pushToggleTestTitle")}</strong>
              <p>{t("pushToggleTestDescription")}</p>
              <p className="settings-hint push-test-status" aria-live="polite">
                {testSent ? t("pushToggleTestSent") : " "}
              </p>
            </div>
            <div className="settings-item-actions">
              <select
                className="settings-select"
                aria-label={t("pushToggleDisplayBehavior")}
                value={testUrgency}
                onChange={(e) =>
                  setTestUrgency(e.target.value as TestNotificationUrgency)
                }
                disabled={isLoading}
              >
                <option value="normal">{t("pushToggleUrgencyNormal")}</option>
                <option value="persistent">
                  {t("pushToggleUrgencyPersistent")}
                </option>
                <option value="silent">{t("pushToggleUrgencySilent")}</option>
              </select>
              <select
                className="settings-select"
                aria-label={t("pushTestDeliveryPriority")}
                value={deliveryUrgency}
                onChange={(e) =>
                  setDeliveryUrgency(e.target.value as PushDeliveryUrgency)
                }
                disabled={isLoading}
              >
                <option value="high">{t("pushDeliveryHigh")}</option>
                <option value="normal">{t("pushDeliveryNormal")}</option>
                <option value="low">{t("pushDeliveryLow")}</option>
                <option value="very-low">{t("pushDeliveryVeryLow")}</option>
              </select>
              <button
                type="button"
                className="settings-button"
                onClick={handleSendTest}
                disabled={isLoading}
              >
                {t("pushToggleSendTest")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
