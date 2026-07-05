export const GIT_STATUS_CAPABILITY = "git-status";
export const GIT_STATUS_ENHANCED_CAPABILITY = "git-status-enhanced";
export const GIT_STATUS_REMOTE_CHECK_CAPABILITY = "git-status-remote-check";
export const GIT_STATUS_PULL_CAPABILITY = "git-status-pull";
export const GIT_STATUS_PUSH_CAPABILITY = "git-status-push";
export const GIT_STATUS_INTEGRATION_OPTIONS_CAPABILITY =
  "git-status-integration-options";

export interface GitFileChange {
  /** Relative path within the repo. May be a compact untracked directory. */
  path: string;
  /** Git status code: M, A, D, ?, R, T, U */
  status: string;
  /** Whether the change is staged (in the index) */
  staged: boolean;
  /** Lines added (null for binary or untracked files) */
  linesAdded: number | null;
  /** Lines deleted (null for binary or untracked files) */
  linesDeleted: number | null;
  /** Original path (for renames) */
  origPath?: string;
}

export interface GitRecentCommit {
  /** Full commit hash */
  hash: string;
  /** Short commit hash for display */
  shortHash: string;
  /** Commit subject line */
  subject: string;
  /** Author display name */
  authorName: string;
  /** Author timestamp as an ISO 8601 string */
  authorDate: string;
}

export interface GitUntrackedFolderInfo {
  /** Compact untracked directory path, with trailing slash */
  path: string;
  /** Expanded untracked file paths within the directory */
  files: string[];
  /** Whether the list was capped by the server */
  truncated: boolean;
  /** Maximum number of files returned before truncation */
  limit: number;
}

export interface GitStatusInfo {
  /** Whether the project path is a git repository */
  isGitRepo: boolean;
  /** Current branch name (null if detached HEAD) */
  branch: string | null;
  /** Upstream branch (e.g. "origin/main") */
  upstream: string | null;
  /** Commits ahead of upstream */
  ahead: number;
  /** Commits behind upstream */
  behind: number;
  /** Whether the working tree is clean */
  isClean: boolean;
  /** Changed files with status and line counts */
  files: GitFileChange[];
  /** Recent commits on the current HEAD */
  recentCommits?: GitRecentCommit[];
  /** Last successful remote fetch/check detected from this server or git metadata */
  checkedRemoteAt?: string | null;
}

export type GitRemoteCheckStatus =
  | "checked"
  | "busy"
  | "not-a-git-repo"
  | "failed";

export interface GitRemoteCheckResult {
  status: GitRemoteCheckStatus;
  checkedRemoteAt: string | null;
  gitStatus?: GitStatusInfo;
  detail?: string;
}

export type GitPullStatus = "pulled" | "busy" | "not-a-git-repo" | "failed";

export interface GitPullResult {
  status: GitPullStatus;
  checkedRemoteAt: string | null;
  gitStatus?: GitStatusInfo;
  detail?: string;
}

export type GitPushStatus =
  | "pushed"
  | "published"
  | "up-to-date"
  | "busy"
  | "no-upstream"
  | "rejected"
  | "not-a-git-repo"
  | "failed";

export interface GitPushResult {
  status: GitPushStatus;
  checkedRemoteAt: string | null;
  gitStatus?: GitStatusInfo;
  detail?: string;
}

export type GitIntegrationOptionsStatus =
  | "available"
  | "unavailable"
  | "busy"
  | "not-a-git-repo"
  | "failed";

export type GitIntegrationOptionReason =
  | "not-diverged"
  | "missing-upstream"
  | "detached-head"
  | "dirty-worktree"
  | "sequencer-in-progress"
  | "operation-running"
  | "not-a-git-repo"
  | "status-unavailable";

export interface GitIntegrationOptionsResult {
  status: GitIntegrationOptionsStatus;
  checkedRemoteAt: string | null;
  gitStatus?: GitStatusInfo;
  canAutoRebase: boolean;
  canAutoMerge: boolean;
  reasons: GitIntegrationOptionReason[];
  ahead: number;
  behind: number;
  upstream: string | null;
  isClean: boolean;
  hasSequencerState: boolean;
  detail?: string;
}
