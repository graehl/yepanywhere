import type {
  SafeRestartBlocker,
  SafeRestartPreservedWork,
  SafeRestartState,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

interface Props {
  target: "backend" | "frontend";
  onReload: () => void;
  onDismiss: () => void;
  onRestartWhenSafe?: () => void;
  onCancelSafeRestart?: () => void;
  unsafeToRestart?: boolean;
  interruptibleSessionCount?: number;
  queuedSessionMessageCount?: number;
  safeRestartState?: SafeRestartState;
  safeRestartMutating?: boolean;
}

function blockerCount(
  blockers: SafeRestartBlocker[],
  type: SafeRestartBlocker["type"],
): number {
  return blockers.find((blocker) => blocker.type === type)?.count ?? 0;
}

function preservedCount(
  preserved: SafeRestartPreservedWork[] | undefined,
  type: SafeRestartPreservedWork["type"],
): number {
  return preserved?.find((item) => item.type === type)?.count ?? 0;
}

export function ReloadBanner({
  target,
  onReload,
  onDismiss,
  onRestartWhenSafe,
  onCancelSafeRestart,
  unsafeToRestart,
  interruptibleSessionCount = 0,
  queuedSessionMessageCount = 0,
  safeRestartState,
  safeRestartMutating = false,
}: Props) {
  const { t } = useI18n();
  const [confirmingImmediateReloadLabel, setConfirmingImmediateReloadLabel] =
    useState<string | null>(null);
  const label =
    target === "backend"
      ? t("reloadBannerTargetServer")
      : t("reloadBannerTargetFrontend");
  const hasScheduledRestart =
    target === "backend" &&
    safeRestartState !== undefined &&
    safeRestartState.status !== "idle";
  const showWarning =
    (unsafeToRestart && target === "backend") || hasScheduledRestart;
  const canScheduleSafeRestart =
    target === "backend" &&
    onRestartWhenSafe &&
    unsafeToRestart &&
    !hasScheduledRestart;
  const activeBlockers = safeRestartState
    ? blockerCount(safeRestartState.blockers, "active-sessions")
    : 0;
  const queuedBlockers = safeRestartState
    ? blockerCount(safeRestartState.blockers, "session-queue")
    : 0;
  const recoveredQueuePreserved = safeRestartState
    ? preservedCount(
        safeRestartState.preserved,
        "recovered-session-queue",
      )
    : 0;
  const safeRestartStatus =
    safeRestartState?.status === "restarting"
      ? t("reloadBannerSafeRestartRestarting")
      : hasScheduledRestart
        ? activeBlockers > 0 && queuedBlockers > 0
          ? t("reloadBannerSafeRestartWaitingActiveAndQueued", {
              activeCount: activeBlockers,
              activeSuffix: activeBlockers !== 1 ? "s" : "",
              queuedCount: queuedBlockers,
              queuedSuffix: queuedBlockers !== 1 ? "s" : "",
            })
          : activeBlockers > 0
            ? t("reloadBannerSafeRestartWaitingActive", {
                count: activeBlockers,
                suffix: activeBlockers !== 1 ? "s" : "",
              })
            : queuedBlockers > 0
              ? t("reloadBannerSafeRestartWaitingQueued", {
                  count: queuedBlockers,
                  suffix: queuedBlockers !== 1 ? "s" : "",
                })
              : t("reloadBannerSafeRestartReady")
        : null;
  const safeRestartPreservedStatus =
    hasScheduledRestart && recoveredQueuePreserved > 0
      ? t("reloadBannerSafeRestartPreservedRecoveredQueue", {
          count: recoveredQueuePreserved,
          suffix: recoveredQueuePreserved !== 1 ? "s" : "",
        })
      : null;
  const immediateRestartWarning =
    interruptibleSessionCount > 0 && queuedSessionMessageCount > 0
      ? t("developmentInterruptedWarningActiveAndQueued", {
          activeCount: interruptibleSessionCount,
          activeSuffix: interruptibleSessionCount !== 1 ? "s" : "",
          queuedCount: queuedSessionMessageCount,
          queuedSuffix: queuedSessionMessageCount !== 1 ? "s" : "",
        })
      : queuedSessionMessageCount > 0
        ? t("developmentInterruptedWarningQueued", {
            count: queuedSessionMessageCount,
            suffix: queuedSessionMessageCount !== 1 ? "s" : "",
          })
        : t("developmentInterruptedWarning", {
            count: interruptibleSessionCount,
            suffix: interruptibleSessionCount !== 1 ? "s " : " ",
          });
  const compactBlockerStatus =
    activeBlockers > 0 && queuedBlockers > 0
      ? t("reloadBannerStatusActiveAndQueuedCompact", {
          activeCount: activeBlockers,
          queuedCount: queuedBlockers,
        })
      : activeBlockers > 0
        ? t("reloadBannerStatusActiveCompact", { count: activeBlockers })
        : queuedBlockers > 0
          ? t("reloadBannerStatusQueuedCompact", { count: queuedBlockers })
          : null;
  const compactImmediateRestartWarning =
    interruptibleSessionCount > 0 && queuedSessionMessageCount > 0
      ? t("reloadBannerStatusActiveAndQueuedCompact", {
          activeCount: interruptibleSessionCount,
          queuedCount: queuedSessionMessageCount,
        })
      : queuedSessionMessageCount > 0
        ? t("reloadBannerStatusQueuedCompact", {
            count: queuedSessionMessageCount,
          })
        : t("reloadBannerStatusActiveCompact", {
            count: interruptibleSessionCount,
          });
  const compactWarningStatus =
    safeRestartState?.status === "restarting"
      ? t("reloadBannerSafeRestartRestartingCompact")
      : hasScheduledRestart
        ? (compactBlockerStatus ?? t("reloadBannerSafeRestartReadyCompact"))
        : compactImmediateRestartWarning;
  const primaryReloadLabel = showWarning
    ? t("reloadBannerReloadAnyway")
    : t("reloadBannerReloadTarget", { target: label });
  const isConfirmingImmediateReload =
    confirmingImmediateReloadLabel === primaryReloadLabel;
  const displayedPrimaryReloadLabel = isConfirmingImmediateReload
    ? t("reloadBannerConfirmImmediateReload")
    : primaryReloadLabel;
  const compactPrimaryReloadLabel = isConfirmingImmediateReload
    ? t("reloadBannerConfirmImmediateReloadCompact")
    : t("reloadBannerReloadTargetCompact");

  useEffect(() => {
    if (confirmingImmediateReloadLabel === null) return;

    const timeout = window.setTimeout(() => {
      setConfirmingImmediateReloadLabel(null);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [confirmingImmediateReloadLabel]);

  const handleImmediateReloadClick = () => {
    if (!isConfirmingImmediateReload) {
      setConfirmingImmediateReloadLabel(primaryReloadLabel);
      return;
    }

    setConfirmingImmediateReloadLabel(null);
    onReload();
  };
  const clearImmediateReloadConfirmation = () => {
    setConfirmingImmediateReloadLabel(null);
  };
  const handleRestartWhenSafeClick = () => {
    clearImmediateReloadConfirmation();
    onRestartWhenSafe?.();
  };
  const handleCancelSafeRestartClick = () => {
    clearImmediateReloadConfirmation();
    onCancelSafeRestart?.();
  };
  const handleDismissClick = () => {
    clearImmediateReloadConfirmation();
    onDismiss();
  };

  return (
    <div
      className={`reload-banner ${showWarning ? "reload-banner-warning" : ""}`}
    >
      <span className="reload-banner-content">
        <span className="reload-banner-message">
          <span className="reload-banner-label-full">
            {t("reloadBannerCodeChanged", { target: label })}
          </span>
          <span className="reload-banner-label-compact">
            {t("reloadBannerCodeChangedCompact", { target: label })}
          </span>
        </span>
        {showWarning && (
          <span className="reload-banner-warning-text">
            <span className="reload-banner-status-full">
              {safeRestartStatus ?? immediateRestartWarning}
              {safeRestartPreservedStatus
                ? ` ${safeRestartPreservedStatus}`
                : null}
            </span>
            <span className="reload-banner-status-compact">
              {compactWarningStatus}
            </span>
          </span>
        )}
      </span>
      <span className="reload-banner-actions">
        <button
          type="button"
          className={`reload-banner-button reload-banner-button-primary ${
            showWarning ? "reload-banner-button-danger" : ""
          }`}
          onClick={handleImmediateReloadClick}
          aria-label={displayedPrimaryReloadLabel}
          title={displayedPrimaryReloadLabel}
        >
          <span className="reload-banner-label-full">
            {displayedPrimaryReloadLabel}
          </span>
          <span className="reload-banner-label-compact">
            {compactPrimaryReloadLabel}
          </span>
        </button>
        {canScheduleSafeRestart && (
          <button
            type="button"
            className="reload-banner-button reload-banner-button-safe"
            onClick={handleRestartWhenSafeClick}
            disabled={safeRestartMutating}
            aria-label={t("reloadBannerRestartWhenSafe")}
            title={t("reloadBannerRestartWhenSafe")}
          >
            <span className="reload-banner-label-full">
              {t("reloadBannerRestartWhenSafe")}
            </span>
            <span className="reload-banner-label-compact">
              {t("reloadBannerRestartWhenSafeCompact")}
            </span>
          </button>
        )}
        {hasScheduledRestart && onCancelSafeRestart && (
          <button
            type="button"
            className="reload-banner-button"
            onClick={handleCancelSafeRestartClick}
            disabled={safeRestartMutating}
            aria-label={t("reloadBannerCancelSafeRestart")}
            title={t("reloadBannerCancelSafeRestart")}
          >
            <span className="reload-banner-label-full">
              {t("reloadBannerCancelSafeRestart")}
            </span>
            <span className="reload-banner-label-compact">
              {t("reloadBannerCancelSafeRestartCompact")}
            </span>
          </button>
        )}
        <button
          type="button"
          className="reload-banner-button reload-banner-dismiss-button"
          onClick={handleDismissClick}
          aria-label={t("reloadBannerDismiss")}
          title={t("reloadBannerDismiss")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <span className="reload-banner-shortcut">Ctrl+Shift+R</span>
      </span>
    </div>
  );
}
