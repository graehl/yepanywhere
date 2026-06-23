import { useCallback, useEffect, useRef, useState } from "react";
import { useInstallId } from "../contexts/InstallIdContext";
import { getServerScoped, setServerScoped } from "../lib/storageKeys";

// Persistent per-install default for "open the forked session in a new tab when
// fork-after-summary finishes". Server-scoped like showThinking (see
// topics/settings-ui-placement.md). Default-off per topics/vanilla-defaults.md:
// auto-opening a tab is novel behavior, so it ships configurable and off.

const DEFAULT_FORK_SUMMARY_AUTO_OPEN = false;

/** Non-reactive read, for seeding a per-fork toggle at submit time. */
export function getForkSummaryAutoOpen(): boolean {
  return getServerScoped("forkSummaryAutoOpen") === "on";
}

function saveForkSummaryAutoOpen(value: boolean): void {
  setServerScoped("forkSummaryAutoOpen", value ? "on" : "off");
}

export function useForkSummaryAutoOpen(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = getServerScoped("forkSummaryAutoOpen");
    return stored === null ? DEFAULT_FORK_SUMMARY_AUTO_OPEN : stored === "on";
  });
  // The key is install-scoped, so the first read can precede installId landing.
  // Re-read once it does, unless the user already changed it this mount.
  const { installId } = useInstallId();
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!installId || touchedRef.current) return;
    const stored = getForkSummaryAutoOpen();
    setValue((prev) => (prev === stored ? prev : stored));
  }, [installId]);

  const set = useCallback((next: boolean) => {
    touchedRef.current = true;
    setValue(next);
    saveForkSummaryAutoOpen(next);
  }, []);

  return [value, set];
}
