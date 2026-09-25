import { type Ref, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { writeClipboardText } from "../lib/clipboard";
import styles from "./ViewerWindowActions.module.css";

/** Shared viewer window actions: copy link, move out, minimize, close. */
export function ViewerWindowActions({
  url,
  copyUrl = url,
  onClose,
  onMinimize,
  closeRef,
  className,
  minimizeLabel,
  closeLabel,
  reloadLabel,
  moveOut = true,
  onMoveOut = onClose,
  destructiveClose = false,
  closeDisabled = false,
  onReload,
}: {
  url: string;
  copyUrl?: string;
  onClose?: () => void;
  onMinimize?: () => void;
  /** Refetch the viewed document from disk; viewers never watch files. */
  onReload?: () => void;
  closeRef?: Ref<HTMLButtonElement>;
  className?: string;
  minimizeLabel?: string;
  closeLabel?: string;
  /** Names what a reload refetches when it is not a file on disk. */
  reloadLabel?: string;
  moveOut?: boolean;
  onMoveOut?: () => void;
  destructiveClose?: boolean;
  closeDisabled?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const absoluteUrl = new URL(url, window.location.href).href;
  const linkTitle =
    copied === "copied"
      ? t("fileViewerCopied")
      : copied === "failed"
        ? t("viewerCopyLinkFailed")
        : t("viewerLinkHint");
  const icon = (path: string) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
  return (
    <div className={`${styles.actions} ${className ?? ""}`}>
      {onReload && (
        <button
          type="button"
          aria-label={reloadLabel ?? t("fileViewerReload" as never)}
          title={reloadLabel ?? t("fileViewerReload" as never)}
          onClick={onReload}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.5 2.5v3.2h-3.2" />
          </svg>
        </button>
      )}
      <a
        href={absoluteUrl}
        target="_blank"
        rel="noopener noreferrer"
        role="button"
        aria-label={t("fileLinkMenuCopyViewerLink")}
        title={linkTitle}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
        onClick={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            window.open(absoluteUrl, "_blank", "noopener,noreferrer");
            return;
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          event.preventDefault();
          void writeClipboardText(
            new URL(copyUrl, window.location.href).href,
          ).then((success) => {
            setCopied(success ? "copied" : "failed");
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied("idle"), 3000);
          });
        }}
      >
        {icon(
          copied === "copied"
            ? "M3 8l3 3 7-7"
            : "M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2.46-2.46a2.5 2.5 0 0 0-3.54-3.54L7.9 4.56M9.5 6.5a2.5 2.5 0 0 0-3.54 0L3.5 8.96a2.5 2.5 0 0 0 3.54 3.54l1.06-1.06",
        )}
      </a>
      {moveOut && (
        <a
          href={absoluteUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("viewerMoveToNewTab")}
          title={t("viewerMoveToNewTab")}
          onClick={onMoveOut}
          onAuxClick={(event) => {
            if (event.button === 1) onMoveOut?.();
          }}
        >
          {icon(
            "M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4M9 2h5v5M6 10l8-8",
          )}
        </a>
      )}
      {onMinimize && (
        <button
          type="button"
          onClick={onMinimize}
          aria-label={minimizeLabel ?? t("modalMinimize")}
          title={minimizeLabel ?? t("modalMinimize")}
        >
          {icon("M3 12h10")}
        </button>
      )}
      {onClose && (
        <button
          ref={closeRef}
          className={destructiveClose ? styles.destructive : undefined}
          disabled={closeDisabled}
          type="button"
          onClick={onClose}
          aria-label={closeLabel ?? t("modalClose")}
          title={closeLabel ?? t("modalClose")}
        >
          {icon("M4 4l8 8M12 4l-8 8")}
        </button>
      )}
    </div>
  );
}
