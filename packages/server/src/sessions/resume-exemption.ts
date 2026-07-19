/**
 * Resume exemption for explicitly killed sessions.
 *
 * When the user kills a session through YA's explicit Kill action, the
 * session must not come back through any auto-resume path. Two mechanisms
 * cooperate:
 *
 * - Codex rollout tombstoning: the provider-owned rollout file is renamed
 *   with a `.killed-<timestamp>` suffix so neither YA discovery nor a Codex
 *   app-server `thread/resume` can find it. The rename is reversible by
 *   stripping the suffix.
 * - Heartbeat eligibility: the unowned-session heartbeat resume
 *   (`Supervisor.queueHeartbeatTurnForCandidate`) only considers sessions
 *   that pass `isUnownedHeartbeatResumeEligible`; killing a session clears
 *   its heartbeat opt-in, and archived sessions are never eligible.
 *
 * See topics/heartbeat.md ("Unowned resume exemptions").
 */

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProviderName } from "@yep-anywhere/shared";
import type { SessionMetadata } from "../metadata/SessionMetadataService.js";
import { getCodexRolloutSessionId } from "../utils/codexRolloutFiles.js";

/** Suffix marker appended to a rollout file name when its session is killed. */
export const KILLED_ROLLOUT_SUFFIX_PREFIX = ".killed-";

/** Providers whose sessions are persisted as Codex rollout files. */
export function isCodexRolloutProvider(provider: ProviderName): boolean {
  return provider === "codex" || provider === "codex-oss";
}

/**
 * Whether an unowned session may be auto-resumed by the heartbeat candidate
 * scan. Archived sessions are exempt: archiving says the user is done with
 * the session, so resurrecting it contradicts the gesture.
 */
export function isUnownedHeartbeatResumeEligible(
  metadata: Pick<SessionMetadata, "heartbeatTurnsEnabled" | "isArchived">,
): boolean {
  return metadata.heartbeatTurnsEnabled === true && metadata.isArchived !== true;
}

/** Filename-safe UTC timestamp, e.g. 20260719T164530Z. */
export function killedRolloutTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/**
 * Find every rollout file for a session id under the Codex sessions dir.
 * Matches both plain (.jsonl) and compressed (.jsonl.zst) representations;
 * already-tombstoned files no longer match and are not returned.
 */
export async function findCodexRolloutPathsForSessionId(
  sessionsDir: string,
  sessionId: string,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(sessionsDir, {
      recursive: true,
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const wanted = sessionId.toLowerCase();
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const rolloutSessionId = getCodexRolloutSessionId(entry.name);
    if (rolloutSessionId?.toLowerCase() !== wanted) continue;
    matches.push(path.join(entry.parentPath, entry.name));
  }
  return matches;
}

export interface DisabledRolloutRename {
  from: string;
  to: string;
}

export interface DisableRolloutsResult {
  renamed: DisabledRolloutRename[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Tombstone every rollout file of a killed session by renaming it with a
 * `.killed-<timestamp>` suffix. The renamed file no longer matches
 * `isCodexRolloutFileName`, so session discovery, YA resume, and Codex
 * app-server resume all stop seeing the session. Reversible by renaming
 * the file back to its original name.
 */
export async function disableCodexRolloutsForKilledSession(
  sessionsDir: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<DisableRolloutsResult> {
  const result: DisableRolloutsResult = { renamed: [], failed: [] };
  const suffix = `${KILLED_ROLLOUT_SUFFIX_PREFIX}${killedRolloutTimestamp(now)}`;

  for (const filePath of await findCodexRolloutPathsForSessionId(
    sessionsDir,
    sessionId,
  )) {
    const target = `${filePath}${suffix}`;
    try {
      await fs.rename(filePath, target);
      result.renamed.push({ from: filePath, to: target });
    } catch (error) {
      result.failed.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** Outcome of blocking auto-resume for an explicitly killed session. */
export interface ResumeExemptionResult {
  /** True when the session had heartbeat turns enabled and they were cleared. */
  heartbeatDisabled: boolean;
  /** Tombstoned rollout paths (new names), for feedback and manual reversal. */
  rolloutsRenamed: string[];
  /** Rollouts that could not be renamed, with the error message. */
  failures: Array<{ path: string; error: string }>;
}
