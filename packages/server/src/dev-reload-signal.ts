import * as fs from "node:fs";

/**
 * Mark that this process is exiting because the dev wrapper should restart it.
 *
 * scripts/dev.js consumes this one-shot marker on child exit. It is only set in
 * manual reload mode and is intentionally best-effort so production restarts do
 * not depend on a dev-only file.
 */
export function markDevReloadRequested(): void {
  const signalFile = process.env.YEP_DEV_RELOAD_SIGNAL_FILE;
  if (!signalFile) return;

  try {
    fs.writeFileSync(
      signalFile,
      JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.warn(
      `[DevReload] Could not write reload signal file ${signalFile}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
