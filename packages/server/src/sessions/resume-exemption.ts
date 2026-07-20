/**
 * Resume exemption for explicitly killed sessions.
 *
 * When the user kills a session through YA's explicit Kill action, the
 * session must not come back through an automatic YA resume path. The durable
 * exemption lives in YA metadata and is checked by the unowned-session
 * heartbeat candidate gate. Provider transcripts remain untouched so history
 * stays readable and the user can deliberately continue the session.
 *
 * See topics/heartbeat.md ("Unowned resume exemptions").
 */

import type { SessionMetadata } from "../metadata/SessionMetadataService.js";

/**
 * Whether an unowned session may be auto-resumed by the heartbeat candidate
 * scan. Archived sessions are exempt: archiving says the user is done with
 * the session, so resurrecting it contradicts the gesture.
 */
export function isUnownedHeartbeatResumeEligible(
  metadata: Pick<
    SessionMetadata,
    "heartbeatTurnsEnabled" | "isArchived" | "autoResumeDisabled"
  >,
): boolean {
  return (
    metadata.heartbeatTurnsEnabled === true &&
    metadata.isArchived !== true &&
    metadata.autoResumeDisabled !== true
  );
}

/** Outcome of blocking auto-resume for an explicitly killed session. */
export interface ResumeExemptionResult {
  /** True when the session had heartbeat turns enabled and they were cleared. */
  heartbeatDisabled: boolean;
  /** Whether YA's durable automatic-resume gate is blocked. */
  autoResumeDisabled: boolean;
  /** Present when shutdown succeeded but the durable exemption failed. */
  error?: string;
}
