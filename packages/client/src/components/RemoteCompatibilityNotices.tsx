import { useMemo, useState } from "react";
import type { VersionInfo } from "../api/client";
import { useRemoteCompatibilityNoticeDismissals } from "../hooks/useRemoteCompatibilityNoticeDismissals";
import { writeClipboardText } from "../lib/clipboard";
import {
  type RemoteCompatibilityNotice,
  getRemoteCompatibilityNotices,
} from "../lib/remoteCompatibilityNotices";

interface RemoteCompatibilityNoticesProps {
  versionInfo: VersionInfo | null;
  relayUsername: string | null;
  installId?: string | null;
}

export function RemoteCompatibilityNotices({
  versionInfo,
  relayUsername,
  installId,
}: RemoteCompatibilityNoticesProps) {
  const notices = useMemo(
    () =>
      getRemoteCompatibilityNotices({
        currentVersion: versionInfo?.current ?? null,
        latestVersion: versionInfo?.latest ?? null,
        updateAvailable: versionInfo?.updateAvailable ?? false,
        resumeProtocolVersion: versionInfo?.resumeProtocolVersion,
        capabilities: versionInfo?.capabilities,
        relayUsername,
        installId,
      }),
    [installId, relayUsername, versionInfo],
  );
  const { dismissNotice, visibleNotices } =
    useRemoteCompatibilityNoticeDismissals(notices);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const notice = visibleNotices[0];
  if (!notice) return null;

  const handleAction = async (activeNotice: RemoteCompatibilityNotice) => {
    const command = activeNotice.action?.command;
    if (!command) return;
    const copied = await writeClipboardText(command);
    if (copied) {
      setCopiedKey(activeNotice.dismissKey);
      window.setTimeout(() => {
        setCopiedKey((current) =>
          current === activeNotice.dismissKey ? null : current,
        );
      }, 1600);
    }
  };

  return (
    <div
      className={`remote-compatibility-notice remote-compatibility-notice--${notice.severity}`}
      role={notice.severity === "security" ? "alert" : "status"}
      data-testid="remote-compatibility-notice"
    >
      <div className="remote-compatibility-notice__content">
        <strong className="remote-compatibility-notice__title">
          {notice.title}
        </strong>
        <span className="remote-compatibility-notice__body">{notice.body}</span>
        {visibleNotices.length > 1 && (
          <span className="remote-compatibility-notice__count">
            {visibleNotices.length} notices
          </span>
        )}
      </div>
      <div className="remote-compatibility-notice__actions">
        {notice.action?.command && (
          <button
            type="button"
            className="remote-compatibility-notice__button remote-compatibility-notice__button-primary"
            onClick={() => void handleAction(notice)}
          >
            {copiedKey === notice.dismissKey ? "Copied" : notice.action.label}
          </button>
        )}
        {notice.action?.href && (
          <a
            className="remote-compatibility-notice__button remote-compatibility-notice__button-primary"
            href={notice.action.href}
          >
            {notice.action.label}
          </a>
        )}
        <button
          type="button"
          className="remote-compatibility-notice__button"
          onClick={() => dismissNotice(notice)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
