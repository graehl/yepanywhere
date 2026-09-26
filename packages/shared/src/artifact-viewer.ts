import { isRecord } from "./plain-record.js";

/**
 * Sandbox for every frame on the isolated artifact origin and for the artifact
 * response's own CSP `sandbox` directive. It grants no popups, downloads, or
 * top-level navigation: an unsandboxed popup would hold `opener.top`, the YA
 * tab, and could navigate it. A document the frame cannot show is handed to a
 * new tab through the viewer instead (`ARTIFACT_TAB_PROTOCOL`).
 */
export const ARTIFACT_SANDBOX = "allow-scripts allow-same-origin";

/**
 * A framed artifact page asks the YA viewer to open one URL of its own grant in
 * a new tab, for a document such as a PDF that a sandboxed frame cannot
 * display. The viewer accepts it only from its own frame and opens it without
 * an opener.
 */
export const ARTIFACT_TAB_PROTOCOL = "yep-artifact-tab/1";

export interface ArtifactTabRequest {
  protocol: typeof ARTIFACT_TAB_PROTOCOL;
  type: "open";
  url: string;
}

export function isArtifactTabRequest(
  value: unknown,
): value is ArtifactTabRequest {
  return (
    isRecord(value) &&
    value.protocol === ARTIFACT_TAB_PROTOCOL &&
    value.type === "open" &&
    typeof value.url === "string"
  );
}

export interface ArtifactVhost {
  name: string;
  port: number;
  env?: string;
  public?: boolean;
}

export interface ArtifactViewerConfig {
  port: number;
  localOrigin?: string;
  publicOrigin?: string;
  /** Presence in status metadata enables the expiry setting on the client. */
  expiryHours?: number;
  /** Days a new link lives; presence enables the day-unit control. */
  expiryDays?: number;
  /** Presence enables the static vhost table. */
  vhosts?: ArtifactVhost[];
  /** Optional apex such as graehl.org; empty means name.localhost only. */
  vhostPublicRoot?: string;
  /** Rewrite name.localhost links even outside a public relay session. */
  alwaysRewriteVhostLinks?: boolean;
}

export interface ArtifactViewerStatus extends ArtifactViewerConfig {
  available: boolean;
  locked: boolean;
  defaultLocalOrigin: string;
}

export interface ArtifactViewerGrant {
  id: string;
  url: string;
  expiresAt: number;
  /** True when this grant deletes its directory at expiry or revocation. */
  owned?: boolean;
}
