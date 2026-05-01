import type {
  PublicSessionShareMode,
  PublicSessionShareSessionStatusResponse,
  UrlProjectId,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import { Modal } from "./ui/Modal";
import { ViewerCountIndicator } from "./ViewerCountIndicator";

interface SessionShareModalProps {
  projectId: string;
  sessionId: string;
  title?: string | null;
  onClose: () => void;
}

const CLIPBOARD_WRITE_TIMEOUT_MS = 250;
const STATUS_POLL_MS = 10_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (document.hasFocus() && navigator.clipboard?.writeText) {
    try {
      const copied = await withTimeout(
        navigator.clipboard.writeText(text).then(() => true),
        CLIPBOARD_WRITE_TIMEOUT_MS,
      );
      if (copied) {
        return true;
      }
    } catch {
      // Fall through to the legacy selection-based copy path.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  textArea.style.opacity = "0";
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  document.body.appendChild(textArea);
  textArea.focus({ preventScroll: true });
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  let copied = false;
  try {
    copied =
      typeof document.execCommand === "function" &&
      document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textArea);
    activeElement?.focus({ preventScroll: true });
  }

  return copied;
}

export function SessionShareModal({
  projectId,
  sessionId,
  title,
  onClose,
}: SessionShareModalProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] =
    useState<PublicSessionShareSessionStatusResponse | null>(null);
  const [isWorking, setIsWorking] = useState<PublicSessionShareMode | "revoke" | null>(
    null,
  );
  const [result, setResult] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refreshStatus = async () => {
      try {
        const nextStatus = await api.getPublicSessionShareStatus(
          projectId,
          sessionId,
        );
        if (!cancelled) {
          setStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(refreshStatus, STATUS_POLL_MS);
        }
      }
    };

    void refreshStatus();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [projectId, sessionId]);

  const copyUrl = async (nextUrl: string) => {
    const copied = await writeClipboardText(nextUrl);
    if (copied) {
      setResult(t("sessionShareCopiedReadOnly"));
      return;
    }
    window.setTimeout(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    }, 0);
    setResult(t("sessionShareManualCopy"));
  };

  const createAndCopyShare = async (mode: PublicSessionShareMode) => {
    setIsWorking(mode);
    setError(null);
    setResult(null);
    try {
      const result = await api.createPublicSessionShare({
        projectId: projectId as UrlProjectId,
        sessionId,
        mode,
        title: title ?? undefined,
      });
      setUrl(result.url);
      await copyUrl(result.url);
      setStatus((current) => {
        const frozenDelta = mode === "frozen" ? 1 : 0;
        const liveDelta = mode === "live" ? 1 : 0;
        return {
          activeCount: (current?.activeCount ?? 0) + 1,
          frozenCount: (current?.frozenCount ?? 0) + frozenDelta,
          liveCount: (current?.liveCount ?? 0) + liveDelta,
          activeViewerCount: current?.activeViewerCount ?? 0,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sessionShareFailed"));
    } finally {
      setIsWorking(null);
    }
  };

  const revokeAll = async () => {
    setIsWorking("revoke");
    setError(null);
    setResult(null);
    try {
      const response = await api.revokePublicSessionShares(projectId, sessionId);
      setStatus(response);
      setUrl(null);
      setResult(t("sessionShareRevoked", { count: response.revokedCount }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sessionShareRevokeFailed"));
    } finally {
      setIsWorking(null);
    }
  };

  const hasActiveShares = (status?.activeCount ?? 0) > 0;
  const activeViewerCount = status?.activeViewerCount ?? 0;

  return (
    <Modal title={t("sessionShareTitle")} onClose={onClose}>
      <div className="session-share-modal">
        <p className="session-share-readonly-note">
          {t("sessionShareReadOnlyNote")}
        </p>
        <div className="session-share-actions">
          <button
            type="button"
            className="session-share-action"
            onClick={() => void createAndCopyShare("frozen")}
            disabled={isWorking !== null}
          >
            <span className="session-share-option-title">
              {isWorking === "frozen"
                ? t("sessionShareCopying")
                : t("sessionShareCopyFrozenReadOnly")}
            </span>
            <span className="session-share-option-description">
              {t("sessionShareFrozenDescription")}
            </span>
          </button>
          <button
            type="button"
            className="session-share-action"
            onClick={() => void createAndCopyShare("live")}
            disabled={isWorking !== null}
          >
            <span className="session-share-option-title">
              {isWorking === "live"
                ? t("sessionShareCopying")
                : t("sessionShareCopyLiveReadOnly")}
            </span>
            <span className="session-share-option-description">
              {t("sessionShareLiveDescription")}
            </span>
          </button>
        </div>

        {url && (
          <label className="session-share-url-field">
            <span>{t("sessionShareUrlLabel")}</span>
            <input
              ref={urlInputRef}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        )}

        {error && <div className="session-share-error">{error}</div>}
        {result && <div className="session-share-status">{result}</div>}

        {hasActiveShares && (
          <>
            <ViewerCountIndicator
              className="session-share-viewer-count"
              count={activeViewerCount}
              label={t("sessionShareActiveViewers", {
                count: activeViewerCount,
              })}
            />
            <button
              type="button"
              className="session-share-revoke-button"
              onClick={() => void revokeAll()}
              disabled={isWorking !== null}
            >
              {isWorking === "revoke"
                ? t("sessionShareRevoking")
                : t("sessionShareRevokeAll")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
