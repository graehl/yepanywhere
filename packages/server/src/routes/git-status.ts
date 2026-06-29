import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type GitFileChange,
  type GitPullResult,
  type GitPushResult,
  type GitRemoteCheckResult,
  type GitRecentCommit,
  type GitStatusInfo,
  type PatchHunk,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { computeEditAugment } from "../augments/edit-augments.js";
import { renderMarkdownToHtml } from "../augments/markdown-augments.js";
import type { ProjectScanner } from "../projects/scanner.js";

const execFileAsync = promisify(execFile);

export interface GitStatusDeps {
  scanner: ProjectScanner;
}

const NOT_A_GIT_REPO: GitStatusInfo = {
  isGitRepo: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  isClean: true,
  files: [],
  recentCommits: [],
  checkedRemoteAt: null,
};

const remoteCheckedAtByProjectPath = new Map<string, string>();
const gitOperationsByProjectPath = new Set<string>();

export function createGitStatusRoutes(deps: GitStatusDeps): Hono {
  const routes = new Hono();

  routes.get("/:projectId/git", async (c) => {
    const projectId = c.req.param("projectId");

    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    const project = await deps.scanner.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    try {
      const result = await getGitStatusWithRemoteCheckTime(project.path);
      return c.json(result);
    } catch (err) {
      if (isNotGitRepoError(err)) {
        return c.json(NOT_A_GIT_REPO);
      }
      return c.json({ error: "Failed to get git status" }, 500);
    }
  });

  /**
   * POST /:projectId/git/check-remote
   * Explicitly fetch remote refs and update the last-checked timestamp.
   */
  routes.post("/:projectId/git/check-remote", async (c) => {
    const projectId = c.req.param("projectId");

    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    const project = await deps.scanner.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const checkedRemoteAt = await getCheckedRemoteAt(project.path);
    if (gitOperationsByProjectPath.has(project.path)) {
      const result: GitRemoteCheckResult = {
        status: "busy",
        checkedRemoteAt,
        gitStatus: await getGitStatusSnapshot(project.path),
      };
      return c.json(result);
    }

    gitOperationsByProjectPath.add(project.path);
    try {
      await runGit(project.path, ["fetch"], {
        timeout: 30_000,
        disableTerminalPrompt: true,
      });
      const nextCheckedRemoteAt = new Date().toISOString();
      remoteCheckedAtByProjectPath.set(project.path, nextCheckedRemoteAt);

      const result: GitRemoteCheckResult = {
        status: "checked",
        checkedRemoteAt: nextCheckedRemoteAt,
        gitStatus: await getGitStatusWithRemoteCheckTime(project.path),
      };
      return c.json(result);
    } catch (err) {
      if (isNotGitRepoError(err)) {
        const result: GitRemoteCheckResult = {
          status: "not-a-git-repo",
          checkedRemoteAt: null,
          gitStatus: NOT_A_GIT_REPO,
        };
        return c.json(result);
      }

      const result: GitRemoteCheckResult = {
        status: "failed",
        checkedRemoteAt: await getCheckedRemoteAt(project.path),
        gitStatus: await getGitStatusSnapshot(project.path),
        detail: getGitErrorDetail(err),
      };
      return c.json(result);
    } finally {
      gitOperationsByProjectPath.delete(project.path);
    }
  });

  /**
   * POST /:projectId/git/pull
   * Try a safe fast-forward pull without opening interactive prompts.
   */
  routes.post("/:projectId/git/pull", async (c) => {
    const projectId = c.req.param("projectId");

    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    const project = await deps.scanner.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const checkedRemoteAt = await getCheckedRemoteAt(project.path);
    if (gitOperationsByProjectPath.has(project.path)) {
      const result: GitPullResult = {
        status: "busy",
        checkedRemoteAt,
        gitStatus: await getGitStatusSnapshot(project.path),
      };
      return c.json(result);
    }

    gitOperationsByProjectPath.add(project.path);
    try {
      await runGit(project.path, ["pull", "--ff-only"], {
        timeout: 60_000,
        disableTerminalPrompt: true,
      });
      const nextCheckedRemoteAt = new Date().toISOString();
      remoteCheckedAtByProjectPath.set(project.path, nextCheckedRemoteAt);

      const result: GitPullResult = {
        status: "pulled",
        checkedRemoteAt: nextCheckedRemoteAt,
        gitStatus: await getGitStatusWithRemoteCheckTime(project.path),
      };
      return c.json(result);
    } catch (err) {
      if (isNotGitRepoError(err)) {
        const result: GitPullResult = {
          status: "not-a-git-repo",
          checkedRemoteAt: null,
          gitStatus: NOT_A_GIT_REPO,
        };
        return c.json(result);
      }

      const result: GitPullResult = {
        status: "failed",
        checkedRemoteAt: await getCheckedRemoteAt(project.path),
        gitStatus: await getGitStatusSnapshot(project.path),
        detail: getGitErrorDetail(err),
      };
      return c.json(result);
    } finally {
      gitOperationsByProjectPath.delete(project.path);
    }
  });

  /**
   * POST /:projectId/git/push
   * Push the current branch, publishing to origin for simple no-upstream cases.
   */
  routes.post("/:projectId/git/push", async (c) => {
    const projectId = c.req.param("projectId");

    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    const project = await deps.scanner.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const checkedRemoteAt = await getCheckedRemoteAt(project.path);
    if (gitOperationsByProjectPath.has(project.path)) {
      const result: GitPushResult = {
        status: "busy",
        checkedRemoteAt,
        gitStatus: await getGitStatusSnapshot(project.path),
      };
      return c.json(result);
    }

    gitOperationsByProjectPath.add(project.path);
    try {
      const status = await getGitStatusWithRemoteCheckTime(project.path);
      const pushArgs = status.upstream
        ? ["push"]
        : status.branch && (await hasGitRemote(project.path, "origin"))
          ? ["push", "-u", "origin", "HEAD"]
          : null;

      if (!pushArgs) {
        const result: GitPushResult = {
          status: "no-upstream",
          checkedRemoteAt,
          gitStatus: status,
        };
        return c.json(result);
      }

      const pushResult = await runGit(project.path, pushArgs, {
        timeout: 60_000,
        disableTerminalPrompt: true,
      });

      const result: GitPushResult = {
        status: status.upstream
          ? isPushAlreadyUpToDateOutput(pushResult)
            ? "up-to-date"
            : "pushed"
          : "published",
        checkedRemoteAt: await getCheckedRemoteAt(project.path),
        gitStatus: await getGitStatusWithRemoteCheckTime(project.path),
      };
      return c.json(result);
    } catch (err) {
      if (isNotGitRepoError(err)) {
        const result: GitPushResult = {
          status: "not-a-git-repo",
          checkedRemoteAt: null,
          gitStatus: NOT_A_GIT_REPO,
        };
        return c.json(result);
      }

      const result: GitPushResult = {
        status: isPushRejectedError(err) ? "rejected" : "failed",
        checkedRemoteAt: await getCheckedRemoteAt(project.path),
        gitStatus: await getGitStatusSnapshot(project.path),
        detail: getGitErrorDetail(err),
      };
      return c.json(result);
    } finally {
      gitOperationsByProjectPath.delete(project.path);
    }
  });

  /**
   * POST /:projectId/git/diff
   * Get syntax-highlighted diff for a specific file.
   * Body: { path, staged, status, fullContext? }
   */
  routes.post("/:projectId/git/diff", async (c) => {
    const projectId = c.req.param("projectId");

    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    const project = await deps.scanner.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    let body: {
      path: string;
      staged: boolean;
      status: string;
      fullContext?: boolean;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { path, staged, status, fullContext } = body;
    if (!path || typeof staged !== "boolean" || !status) {
      return c.json(
        { error: "Missing required fields: path, staged, status" },
        400,
      );
    }

    try {
      const { oldContent, newContent } = await getFileVersions(
        project.path,
        path,
        staged,
        status,
      );

      const contextLines = fullContext ? 999999 : 3;
      const augment = await computeEditAugment(
        "git-diff",
        { file_path: path, old_string: oldContent, new_string: newContent },
        contextLines,
      );

      const result: {
        diffHtml: string;
        structuredPatch: PatchHunk[];
        markdownHtml?: string;
      } = {
        diffHtml: augment.diffHtml,
        structuredPatch: augment.structuredPatch,
      };

      // Render markdown preview for .md files
      const ext = extname(path).toLowerCase();
      if ((ext === ".md" || ext === ".markdown") && newContent) {
        try {
          result.markdownHtml = await renderMarkdownToHtml(newContent);
        } catch {
          // Ignore markdown rendering errors
        }
      }

      return c.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to compute diff";
      return c.json({ error: message }, 500);
    }
  });

  return routes;
}

/**
 * Get old and new file content for computing a diff.
 * Handles all git status codes (M, A, D, ?, R, etc.).
 */
async function getFileVersions(
  cwd: string,
  path: string,
  staged: boolean,
  status: string,
): Promise<{ oldContent: string; newContent: string }> {
  // Untracked: entire file is new
  if (status === "?") {
    const content = await readFile(resolve(cwd, path), "utf-8");
    return { oldContent: "", newContent: content };
  }

  // Added (staged): new file in index
  if (status === "A") {
    if (staged) {
      const { stdout } = await runGit(cwd, ["show", `:${path}`]);
      return { oldContent: "", newContent: stdout };
    }
    // Unstaged add shouldn't normally happen, but handle it
    const content = await readFile(resolve(cwd, path), "utf-8");
    return { oldContent: "", newContent: content };
  }

  // Deleted
  if (status === "D") {
    const ref = staged ? `HEAD:${path}` : `:${path}`;
    const { stdout } = await runGit(cwd, ["show", ref]);
    return { oldContent: stdout, newContent: "" };
  }

  // Modified or other statuses
  if (staged) {
    // Staged: compare HEAD to index
    const [oldResult, newResult] = await Promise.all([
      runGit(cwd, ["show", `HEAD:${path}`]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      runGit(cwd, ["show", `:${path}`]),
    ]);
    return { oldContent: oldResult.stdout, newContent: newResult.stdout };
  }

  // Unstaged: compare index to working tree
  const [oldResult, newContent] = await Promise.all([
    runGit(cwd, ["show", `:${path}`]).catch(() => ({
      stdout: "",
      stderr: "",
    })),
    readFile(resolve(cwd, path), "utf-8").catch(() => ""),
  ]);
  return { oldContent: oldResult.stdout, newContent };
}

async function runGit(
  cwd: string,
  args: string[],
  options?: { timeout?: number; disableTerminalPrompt?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: 1024 * 1024,
    timeout: options?.timeout ?? 10_000,
    ...(options?.disableTerminalPrompt
      ? { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }
      : {}),
  });
}

async function getCheckedRemoteAt(projectPath: string): Promise<string | null> {
  return latestIsoTimestamp(
    remoteCheckedAtByProjectPath.get(projectPath) ?? null,
    await getRecordedFetchAt(projectPath),
  );
}

async function getGitStatusWithRemoteCheckTime(
  projectPath: string,
): Promise<GitStatusInfo> {
  return getGitStatus(projectPath, await getCheckedRemoteAt(projectPath));
}

async function getGitStatusSnapshot(
  projectPath: string,
): Promise<GitStatusInfo> {
  try {
    return await getGitStatusWithRemoteCheckTime(projectPath);
  } catch (err) {
    if (isNotGitRepoError(err)) {
      return NOT_A_GIT_REPO;
    }
    return {
      ...NOT_A_GIT_REPO,
      checkedRemoteAt: await getCheckedRemoteAt(projectPath),
    };
  }
}

async function getRecordedFetchAt(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(projectPath, [
      "rev-parse",
      "--git-path",
      "FETCH_HEAD",
    ]);
    const fetchHeadPath = stdout.trim();
    if (!fetchHeadPath) {
      return null;
    }

    const fetchHeadStat = await stat(resolve(projectPath, fetchHeadPath));
    if (!fetchHeadStat.isFile() || !Number.isFinite(fetchHeadStat.mtimeMs)) {
      return null;
    }
    return fetchHeadStat.mtime.toISOString();
  } catch {
    return null;
  }
}

function latestIsoTimestamp(
  first: string | null,
  second: string | null,
): string | null {
  if (!first) return second;
  if (!second) return first;

  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  if (!Number.isFinite(firstTime)) return second;
  if (!Number.isFinite(secondTime)) return first;
  return secondTime > firstTime ? second : first;
}

function getGitErrorDetail(err: unknown): string | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }

  const gitError = err as {
    message?: string;
    stderr?: string;
    stdout?: string;
  };
  const detail = gitError.stderr || gitError.stdout || gitError.message;
  return detail?.trim().slice(0, 1200) || undefined;
}

async function hasGitRemote(
  projectPath: string,
  remoteName: string,
): Promise<boolean> {
  try {
    await runGit(projectPath, ["remote", "get-url", remoteName]);
    return true;
  } catch {
    return false;
  }
}

function isNotGitRepoError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { code?: number | string; stderr?: string };
    if (
      typeof e.stderr === "string" &&
      e.stderr.includes("not a git repository")
    )
      return true;
  }
  return false;
}

function isPushRejectedError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const gitError = err as {
    stderr?: string;
    stdout?: string;
  };
  const output = `${gitError.stderr ?? ""}\n${gitError.stdout ?? ""}`;
  return (
    output.includes("[rejected]") ||
    output.includes("non-fast-forward") ||
    output.includes("fetch first")
  );
}

function isPushAlreadyUpToDateOutput(result: {
  stdout: string;
  stderr: string;
}): boolean {
  return `${result.stdout}\n${result.stderr}`.includes("Everything up-to-date");
}

/** Parse `git diff --numstat` output into a map of path → {added, deleted} */
function parseNumstat(
  output: string,
): Map<string, { added: number | null; deleted: number | null }> {
  const map = new Map<
    string,
    { added: number | null; deleted: number | null }
  >();
  for (const line of output.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addedStr = parts[0] ?? "";
    const deletedStr = parts[1] ?? "";
    const path = parts.slice(2).join("\t");
    const added = addedStr === "-" ? null : Number.parseInt(addedStr, 10);
    const deleted = deletedStr === "-" ? null : Number.parseInt(deletedStr, 10);
    map.set(path, { added, deleted });
  }
  return map;
}

/** Status letter from the XY field for a given position */
function statusChar(xy: string | undefined, index: 0 | 1): string | null {
  if (!xy) return null;
  const ch = xy[index];
  return ch && ch !== "." ? ch : null;
}

async function getGitStatus(
  projectPath: string,
  checkedRemoteAt: string | null,
): Promise<GitStatusInfo> {
  // Run local read-only commands in parallel.
  const [statusResult, numstatUnstaged, numstatStaged, logResult] =
    await Promise.all([
      runGit(projectPath, ["status", "--porcelain=v2", "--branch"]),
      runGit(projectPath, ["diff", "--numstat"]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      runGit(projectPath, ["diff", "--cached", "--numstat"]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      runGit(projectPath, [
        "log",
        "-n",
        "5",
        "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
      ]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
    ]);

  const unstagedStats = parseNumstat(numstatUnstaged.stdout);
  const stagedStats = parseNumstat(numstatStaged.stdout);
  const recentCommits = parseRecentCommits(logResult.stdout);

  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileChange[] = [];

  for (const line of statusResult.stdout.split("\n")) {
    if (!line) continue;

    // Branch headers
    if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length);
      branch = value === "(detached)" ? null : value;
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match?.[1] && match[2]) {
        ahead = Number.parseInt(match[1], 10);
        behind = Number.parseInt(match[2], 10);
      }
    }
    // Ordinary changed entry: "1 XY sub mH mI mW hH hI path"
    else if (line.startsWith("1 ")) {
      const parts = line.split(" ");
      const xy = parts[1];
      const path = parts.slice(8).join(" ");

      const stagedStatus = statusChar(xy, 0);
      const unstagedStatus = statusChar(xy, 1);

      if (stagedStatus) {
        const stats = stagedStats.get(path);
        files.push({
          path,
          status: stagedStatus,
          staged: true,
          linesAdded: stats?.added ?? null,
          linesDeleted: stats?.deleted ?? null,
        });
      }
      if (unstagedStatus) {
        const stats = unstagedStats.get(path);
        files.push({
          path,
          status: unstagedStatus,
          staged: false,
          linesAdded: stats?.added ?? null,
          linesDeleted: stats?.deleted ?? null,
        });
      }
    }
    // Renamed/copied entry: "2 XY sub mH mI mW hH hI X score path\torigPath"
    else if (line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1];
      const pathAndOrig = parts.slice(9).join(" ");
      const tabIdx = pathAndOrig.indexOf("\t");
      const path = tabIdx >= 0 ? pathAndOrig.slice(0, tabIdx) : pathAndOrig;
      const origPath = tabIdx >= 0 ? pathAndOrig.slice(tabIdx + 1) : undefined;

      const stagedStatus = statusChar(xy, 0);
      const unstagedStatus = statusChar(xy, 1);

      if (stagedStatus) {
        const stats = stagedStats.get(path);
        files.push({
          path,
          status: stagedStatus,
          staged: true,
          linesAdded: stats?.added ?? null,
          linesDeleted: stats?.deleted ?? null,
          origPath,
        });
      }
      if (unstagedStatus) {
        const stats = unstagedStats.get(path);
        files.push({
          path,
          status: unstagedStatus,
          staged: false,
          linesAdded: stats?.added ?? null,
          linesDeleted: stats?.deleted ?? null,
          origPath,
        });
      }
    }
    // Untracked: "? path" (skip directories — they end with /)
    else if (line.startsWith("? ")) {
      const path = line.slice(2);
      if (!path.endsWith("/")) {
        files.push({
          path,
          status: "?",
          staged: false,
          linesAdded: null,
          linesDeleted: null,
        });
      }
    }
    // Unmerged: "u XY sub m1 m2 m3 mW h1 h2 h3 path"
    else if (line.startsWith("u ")) {
      const parts = line.split(" ");
      const path = parts.slice(10).join(" ");
      files.push({
        path,
        status: "U",
        staged: false,
        linesAdded: null,
        linesDeleted: null,
      });
    }
  }

  return {
    isGitRepo: true,
    branch,
    upstream,
    ahead,
    behind,
    isClean: files.length === 0,
    files,
    recentCommits,
    checkedRemoteAt,
  };
}

function parseRecentCommits(output: string): GitRecentCommit[] {
  const commits: GitRecentCommit[] = [];

  for (const rawRecord of output.split("\x1e")) {
    const record = rawRecord.replace(/^\n/, "").replace(/\n$/, "");
    if (!record) continue;

    const [hash, shortHash, authorName, authorDate, ...subjectParts] =
      record.split("\x1f");
    const subject = subjectParts.join("\x1f");

    if (!hash || !shortHash || !authorName || !authorDate) {
      continue;
    }

    commits.push({
      hash,
      shortHash,
      authorName,
      authorDate,
      subject,
    });
  }

  return commits;
}
