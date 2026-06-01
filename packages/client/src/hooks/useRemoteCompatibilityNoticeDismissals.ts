import { useCallback, useEffect, useMemo, useState } from "react";
import type { RemoteCompatibilityNotice } from "../lib/remoteCompatibilityNotices";

function readDismissed(keys: string[]): Set<string> {
  const dismissed = new Set<string>();
  for (const key of keys) {
    try {
      if (window.localStorage.getItem(key) === "1") {
        dismissed.add(key);
      }
    } catch {
      // Storage denied / unavailable: notice remains visible.
    }
  }
  return dismissed;
}

export function useRemoteCompatibilityNoticeDismissals(
  notices: RemoteCompatibilityNotice[],
) {
  const keys = useMemo(
    () => notices.map((notice) => notice.dismissKey),
    [notices],
  );
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    readDismissed(keys),
  );

  useEffect(() => {
    setDismissed((current) => new Set([...current, ...readDismissed(keys)]));
  }, [keys]);

  const visibleNotices = useMemo(
    () => notices.filter((notice) => !dismissed.has(notice.dismissKey)),
    [dismissed, notices],
  );

  const dismissNotice = useCallback((notice: RemoteCompatibilityNotice) => {
    try {
      window.localStorage.setItem(notice.dismissKey, "1");
    } catch {
      // Keep same-session dismissal even if persistence fails.
    }
    setDismissed((current) => new Set([...current, notice.dismissKey]));
  }, []);

  return { dismissNotice, visibleNotices };
}
