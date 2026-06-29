import { useCallback, useState } from "react";

const DEFAULT_FORK_SUMMARY_AUTO_OPEN = false;

// The old install-scoped writer had no production fallback, so this setting did
// not survive reloads. Keep it non-persistent until product scope is decided.

/** Non-reactive read, for seeding a per-fork toggle at submit time. */
export function getForkSummaryAutoOpen(): boolean {
  return DEFAULT_FORK_SUMMARY_AUTO_OPEN;
}

export function useForkSummaryAutoOpen(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(DEFAULT_FORK_SUMMARY_AUTO_OPEN);

  const set = useCallback((next: boolean) => {
    setValue(next);
  }, []);

  return [value, set];
}
