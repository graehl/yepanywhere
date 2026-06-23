import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";

// Backgrounded fork-after-summary job state. The generation step is a full
// LLM turn over the entire forked context (30+ s, worse cold-cache), so it
// runs detached from the composer with this persistent indicator instead of
// graying out the send button. See topics/fork-from-turn.md.
//
// This is the transient float. On a terminal event ((tab opened) or a click on
// the follow link) it fades out. The durable pseudo-turn the float should
// transition into is future work (topics/transcript-display-objects.md).
export type ForkSummaryJob = {
  status: "generating" | "ready" | "error";
  startedAt: number;
  /** Per-fork auto-open choice while generating (seeded from the default). */
  autoOpenWhenReady?: boolean;
  /** App-relative session path, used for in-app navigation if needed. */
  targetUrl?: string;
  /** Absolute URL for the new-tab anchor (origin + base + path). */
  targetHref?: string;
  targetSessionId?: string;
  /** Display title (summary first line); also the follow-link label. */
  title?: string;
  /** Whether the post-completion window.open succeeded (usually popup-blocked
   * because it fires outside a user gesture — then the link is the path). */
  autoOpened?: boolean;
  error?: string;
};

// Fade duration; must match the CSS transition on .fork-summary-indicator.
const FADE_MS = 350;
// How long an auto-opened (tab already opened) indicator lingers before fading.
const AUTO_OPENED_LINGER_MS = 4000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function ForkSummaryIndicator({
  job,
  onCancel,
  onDismiss,
  onToggleAutoOpen,
}: {
  job: ForkSummaryJob;
  onCancel: () => void;
  onDismiss: () => void;
  onToggleAutoOpen: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);

  const beginLeave = useCallback(() => setLeaving(true), []);

  // Tick the elapsed clock while generating.
  useEffect(() => {
    if (job.status !== "generating") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job.status]);

  // After the fade transition, drop the indicator entirely.
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(onDismiss, FADE_MS);
    return () => clearTimeout(id);
  }, [leaving, onDismiss]);

  // Auto-opened is a terminal event: linger briefly, then fade out.
  useEffect(() => {
    if (job.status === "ready" && job.autoOpened) {
      const id = setTimeout(beginLeave, AUTO_OPENED_LINGER_MS);
      return () => clearTimeout(id);
    }
  }, [job.status, job.autoOpened, beginLeave]);

  const leavingClass = leaving ? " fork-summary-indicator-leaving" : "";

  if (job.status === "generating") {
    return (
      <div
        className={`fork-summary-indicator fork-summary-indicator-generating${leavingClass}`}
        role="status"
        aria-live="polite"
      >
        <span className="fork-summary-indicator-spinner" aria-hidden="true" />
        <span className="fork-summary-indicator-label">
          {t("forkSummaryProgress")}
        </span>
        <span className="fork-summary-indicator-elapsed">
          {formatElapsed(now - job.startedAt)}
        </span>
        <label className="fork-summary-indicator-autoopen">
          <input
            type="checkbox"
            checked={job.autoOpenWhenReady ?? false}
            onChange={(e) => onToggleAutoOpen(e.target.checked)}
          />
          {t("forkSummaryAutoOpenToggle")}
        </label>
        <button
          type="button"
          className="fork-summary-indicator-cancel"
          onClick={onCancel}
        >
          {t("forkSummaryCancelInFlight")}
        </button>
      </div>
    );
  }

  if (job.status === "error") {
    return (
      <div
        className={`fork-summary-indicator fork-summary-indicator-error${leavingClass}`}
        role="alert"
      >
        <span className="fork-summary-indicator-label">
          {job.error
            ? `${t("forkSummaryFailed")}: ${job.error}`
            : t("forkSummaryFailed")}
        </span>
        <button
          type="button"
          className="fork-summary-indicator-dismiss"
          onClick={onDismiss}
          aria-label={t("forkSummaryDismiss")}
        >
          ×
        </button>
      </div>
    );
  }

  const title = job.title ?? t("forkSummaryReadyFallbackTitle");
  return (
    <div
      className={`fork-summary-indicator fork-summary-indicator-ready${leavingClass}`}
      role="status"
      aria-live="polite"
    >
      <span className="fork-summary-indicator-label">
        {job.autoOpened
          ? t("forkSummaryOpenedNewTab")
          : t("forkSummaryReadyOpen")}
      </span>
      <a
        className="fork-summary-indicator-link"
        href={job.targetHref ?? job.targetUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        onClick={beginLeave}
        title={title}
      >
        {title} ↗
      </a>
    </div>
  );
}
