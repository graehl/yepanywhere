import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Modal } from "./ui/Modal";

/**
 * Blue "waiting elsewhere" banner: shown when a session has no detected owner
 * yet its latest turn ends on an unanswered tool call. YA infers another
 * program (a terminal or IDE) opened the call and is parked at its approval
 * prompt — but it can't tell that apart from a program that exited and left
 * the call dangling, so the copy is hedged and age-aware.
 *
 * Sibling of ExternalSessionWarning (the amber live-concurrent-writer banner);
 * the two share the `external-session-risk*` "What's the risk?" styling and a
 * common fork/branch/silent-loss vocabulary.
 */
export function PendingToolWarning({
  toolName,
  pendingSinceMs,
  onDismiss,
}: {
  toolName: string;
  pendingSinceMs: number | null;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [showModal, setShowModal] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Tick the elapsed counter each second; resync on focus/visibility so a
  // throttled background tab snaps to the right value when the user returns.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    const resync = () => setNowTick(Date.now());
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, []);

  const elapsedSeconds =
    pendingSinceMs != null && Number.isFinite(pendingSinceMs)
      ? Math.max(0, Math.floor((nowTick - pendingSinceMs) / 1000))
      : null;
  // Past this, a parked prompt is less likely than an abandoned call, so the
  // copy switches from "waiting" to the "may have been discarded" framing.
  const isStale =
    elapsedSeconds != null && elapsedSeconds >= STALE_AFTER_SECONDS;
  const duration = formatDuration(elapsedSeconds ?? 0);
  const message = isStale
    ? t("pendingToolWarningStale", { tool: toolName, duration })
    : t("pendingToolWarningWaiting", { tool: toolName, duration });

  return (
    <div
      className="external-session-warning pending-tool-warning"
      role="status"
    >
      <div className="pending-tool-warning-copy">
        <svg
          className="pending-tool-warning-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
        <span>
          {message}{" "}
          <span className="external-session-risk">
            <button
              type="button"
              className="external-session-risk-link"
              aria-haspopup="dialog"
              onClick={() => setShowModal(true)}
            >
              {t("pendingToolWarningWhy")}
            </button>
            <div className="external-session-risk-tooltip" role="tooltip">
              <PendingToolRiskExplanation />
            </div>
          </span>
        </span>
      </div>
      <button
        type="button"
        className="pending-tool-warning-close"
        onClick={onDismiss}
        aria-label={t("sessionPendingElsewhereDismiss")}
        title={t("sessionPendingElsewhereDismiss")}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      {showModal && (
        <Modal
          title={t("pendingToolWarningExplainTitle")}
          onClose={() => setShowModal(false)}
        >
          <PendingToolRiskExplanation />
        </Modal>
      )}
    </div>
  );
}

/**
 * Likely-ill-effects explanation, shared by the hover tooltip and the modal.
 * Deliberately hedged: YA cannot tell a parked prompt from an exited program.
 */
function PendingToolRiskExplanation() {
  const { t } = useI18n();
  return (
    <div className="external-session-risk-explanation">
      <p>{t("pendingToolRiskIntro")}</p>
      <ul>
        <li>
          <strong>{t("pendingToolRiskUnblockLead")}</strong>
          {t("pendingToolRiskUnblockBody")}
        </li>
        <li>
          <strong>{t("pendingToolRiskForkLead")}</strong>
          {t("pendingToolRiskForkBody")}
        </li>
        <li>
          <strong>{t("pendingToolRiskDiscardLead")}</strong>
          {t("pendingToolRiskDiscardBody")}
        </li>
      </ul>
      <p className="external-session-risk-caveat">
        {t("pendingToolRiskCaveat")}
      </p>
    </div>
  );
}

const STALE_AFTER_SECONDS = 10 * 60;

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
