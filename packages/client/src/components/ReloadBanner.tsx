import type {
  SafeRestartBlocker,
  SafeRestartPreservedWork,
  SafeRestartState,
} from "@yep-anywhere/shared";
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
  const label = target === "backend" ? "Server" : "Frontend";
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

  return (
    <div
      className={`reload-banner ${showWarning ? "reload-banner-warning" : ""}`}
    >
      <span className="reload-banner-message">
        {t("reloadBannerCodeChanged", { target: label })}
      </span>
      {showWarning && (
        <span className="reload-banner-warning-text">
          {safeRestartStatus ?? immediateRestartWarning}
          {safeRestartPreservedStatus
            ? ` ${safeRestartPreservedStatus}`
            : null}
        </span>
      )}
      <button
        type="button"
        className={`reload-banner-button reload-banner-button-primary ${
          showWarning ? "reload-banner-button-danger" : ""
        }`}
        onClick={onReload}
      >
        {showWarning ? "Reload Anyway" : `Reload ${label}`}
      </button>
      {canScheduleSafeRestart && (
        <button
          type="button"
          className="reload-banner-button reload-banner-button-safe"
          onClick={onRestartWhenSafe}
          disabled={safeRestartMutating}
        >
          {t("reloadBannerRestartWhenSafe")}
        </button>
      )}
      {hasScheduledRestart && onCancelSafeRestart && (
        <button
          type="button"
          className="reload-banner-button"
          onClick={onCancelSafeRestart}
          disabled={safeRestartMutating}
        >
          {t("reloadBannerCancelSafeRestart")}
        </button>
      )}
      <button
        type="button"
        className="reload-banner-button"
        onClick={onDismiss}
      >
        Dismiss
      </button>
      <span className="reload-banner-shortcut">Ctrl+Shift+R</span>
    </div>
  );
}
