export type RemoteNoticeSeverity =
  | "info"
  | "recommended"
  | "security"
  | "blocking";

export interface RemoteCompatibilityNoticeAction {
  label: string;
  command?: string;
  href?: string;
}

export interface RemoteCompatibilityNotice {
  id: string;
  severity: RemoteNoticeSeverity;
  title: string;
  body: string;
  action?: RemoteCompatibilityNoticeAction;
  dismissKey: string;
}

export interface RemoteCompatibilityInput {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  resumeProtocolVersion?: number;
  capabilities?: string[];
  relayUsername?: string | null;
  installId?: string | null;
  recommendedBaselineVersion?: string;
}

export const RELAY_RESUME_SECURITY_MIN_VERSION = "0.4.0";
export const RELAY_RESUME_SECURITY_MIN_PROTOCOL = 2;
export const REMOTE_BACKEND_API_RECOMMENDED_VERSION = "0.4.29";

const UPDATE_COMMAND = "npm update -g yepanywhere";

const SEVERITY_RANK: Record<RemoteNoticeSeverity, number> = {
  blocking: 0,
  security: 1,
  recommended: 2,
  info: 3,
};

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  sourceBuild: boolean;
  stable: boolean;
  normalized: string;
}

export function getRemoteCompatibilityNotices(
  input: RemoteCompatibilityInput,
): RemoteCompatibilityNotice[] {
  if (!input.relayUsername) {
    return [];
  }

  const notices: RemoteCompatibilityNotice[] = [];
  const current = parseSemver(input.currentVersion);
  const canSuggestNpmUpdate = isStableReleaseVersion(input.currentVersion);

  const addAction = (): RemoteCompatibilityNoticeAction | undefined =>
    canSuggestNpmUpdate
      ? { label: "Copy update command", command: UPDATE_COMMAND }
      : undefined;

  const oldResumeProtocol =
    input.resumeProtocolVersion !== undefined &&
    input.resumeProtocolVersion < RELAY_RESUME_SECURITY_MIN_PROTOCOL;
  const oldResumeVersion =
    input.resumeProtocolVersion === undefined &&
    isVersionLessThan(input.currentVersion, RELAY_RESUME_SECURITY_MIN_VERSION);

  if (oldResumeProtocol || oldResumeVersion) {
    notices.push({
      id: "relay-resume-security",
      severity: "security",
      title: "Server update recommended",
      body: "This server predates relay session-resume hardening. New login still works, but refresh and reconnect behavior is less reliable until the server is updated.",
      action: addAction(),
      dismissKey: buildDismissKey(
        input,
        "relay-resume-security",
        current?.normalized ??
          (input.resumeProtocolVersion !== undefined
            ? `resume-protocol-${input.resumeProtocolVersion}`
            : "unknown-version"),
      ),
    });
  }

  const baseline =
    input.recommendedBaselineVersion ?? REMOTE_BACKEND_API_RECOMMENDED_VERSION;
  if (isVersionLessThan(input.currentVersion, baseline)) {
    const id = `backend-api-compat-${baseline}`;
    notices.push({
      id,
      severity: "recommended",
      title: "Update recommended",
      body: "This hosted client includes backend/API compatibility changes. Basic remote use should still work, but updating the local server is recommended for this release.",
      action: addAction(),
      dismissKey: buildDismissKey(
        input,
        id,
        `${current?.normalized ?? "unknown-version"}-to-${baseline}`,
      ),
    });
  }

  const hasSpecificUpdateNotice = notices.some(
    (notice) =>
      notice.id.startsWith("backend-api-compat-") ||
      notice.id === "relay-resume-security",
  );
  if (
    !hasSpecificUpdateNotice &&
    input.updateAvailable &&
    input.latestVersion
  ) {
    notices.push({
      id: "remote-update-available",
      severity: "recommended",
      title: "Update available",
      body: `Yep Anywhere ${input.latestVersion} is available for this server.`,
      action: addAction(),
      dismissKey: buildDismissKey(
        input,
        "remote-update-available",
        `${current?.normalized ?? input.currentVersion ?? "unknown-version"}-to-${
          input.latestVersion
        }`,
      ),
    });
  }

  return notices.sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return severity !== 0 ? severity : a.id.localeCompare(b.id);
  });
}

export function isVersionLessThan(
  version: string | null | undefined,
  baseline: string,
): boolean {
  const comparison = compareSemver(version, baseline);
  return comparison !== null && comparison < 0;
}

export function compareSemver(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }

  if (left.prerelease === right.prerelease) return 0;
  if (left.sourceBuild) return 1;
  if (right.sourceBuild) return -1;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

export function parseSemver(
  version: string | null | undefined,
): ParsedSemver | null {
  const trimmed = version?.trim().replace(/^v/, "");
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;

  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }

  const prerelease = match[4];
  const sourceBuild = /^\d+-g[0-9a-f]+$/iu.test(prerelease ?? "");
  const parsed: ParsedSemver = {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease: prerelease ?? null,
    sourceBuild,
    stable: prerelease === undefined,
    normalized: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ""}`,
  };
  return parsed;
}

export function isStableReleaseVersion(
  version: string | null | undefined,
): boolean {
  return parseSemver(version)?.stable ?? false;
}

function buildDismissKey(
  input: RemoteCompatibilityInput,
  noticeId: string,
  state: string,
): string {
  const scope =
    input.installId?.trim() ||
    (input.relayUsername ? `relay-${input.relayUsername}` : "unknown-server");
  return `remote-notice-dismissed:${scope}:${noticeId}:${state}`;
}
