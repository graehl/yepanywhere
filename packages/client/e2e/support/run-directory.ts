import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** globalSetup passes this invocation's directory to workers and teardown. */
export function createE2ERunDirectory(): string {
  const directory = mkdtempSync(
    join(process.platform === "darwin" ? "/tmp" : tmpdir(), "claude-e2e-"),
  );
  process.env.YEP_E2E_RUN_DIR = directory;
  return directory;
}

export function getE2ERunDirectory(): string | undefined {
  const directory = process.env.YEP_E2E_RUN_DIR;
  return directory && existsSync(directory) ? directory : undefined;
}
