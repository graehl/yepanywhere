import type {
  GitDiffResult,
  GitIntegrationOptionsResult,
  GitPullResult,
  GitPushResult,
  GitRemoteCheckResult,
  GitStatusInfo,
  GitUntrackedFolderInfo,
} from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

export const gitApi = {
  getGitStatus: (projectId: string) =>
    fetchJSON<GitStatusInfo>(`/projects/${projectId}/git`),

  getGitUntrackedFolder: (projectId: string, path: string) =>
    fetchJSON<GitUntrackedFolderInfo>(
      `/projects/${projectId}/git/untracked-folder?path=${encodeURIComponent(path)}`,
    ),

  checkGitRemote: (projectId: string) =>
    fetchJSON<GitRemoteCheckResult>(`/projects/${projectId}/git/check-remote`, {
      method: "POST",
    }),

  getGitIntegrationOptions: (projectId: string) =>
    fetchJSON<GitIntegrationOptionsResult>(
      `/projects/${projectId}/git/integration-options`,
    ),

  pullGit: (projectId: string) =>
    fetchJSON<GitPullResult>(`/projects/${projectId}/git/pull`, {
      method: "POST",
    }),

  pushGit: (projectId: string) =>
    fetchJSON<GitPushResult>(`/projects/${projectId}/git/push`, {
      method: "POST",
    }),

  getGitDiff: (
    projectId: string,
    params: {
      path: string;
      staged: boolean;
      status: string;
      fullContext?: boolean;
    },
  ) =>
    fetchJSON<GitDiffResult>(`/projects/${projectId}/git/diff`, {
      method: "POST",
      body: JSON.stringify(params),
    }),
};
