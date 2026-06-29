import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type GitPushResult,
  type GitStatusInfo,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createGitStatusRoutes } from "../../src/routes/git-status.js";
import type { Project } from "../../src/supervisor/types.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

function createRoutesForProject(projectPath: string) {
  const projectId = toUrlProjectId(projectPath);
  const project: Project = {
    id: projectId,
    path: projectPath,
    name: "repo",
    sessionCount: 0,
    sessionDir: join(projectPath, ".sessions"),
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
    provider: "claude",
  };

  return {
    projectId,
    routes: createGitStatusRoutes({
      scanner: {
        async getProject(id: string) {
          return id === projectId ? project : null;
        },
      } as unknown as ProjectScanner,
    }),
  };
}

async function commitFile(
  repoDir: string,
  fileName: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(join(repoDir, fileName), content);
  await runGit(repoDir, ["add", fileName]);
  await runGit(repoDir, ["commit", "-m", message]);
}

describe("git-status routes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yep-git-status-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createRepoWithUpstream(): Promise<string> {
    const remoteDir = join(tempDir, "remote.git");
    const repoDir = join(tempDir, "repo");

    await mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "--bare", remoteDir]);
    await execFileAsync("git", ["init", repoDir]);
    await runGit(repoDir, ["config", "user.email", "ya-test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "YA Test"]);
    await commitFile(repoDir, "README.md", "hello\n", "Initial commit");
    await runGit(repoDir, ["remote", "add", "origin", remoteDir]);
    await runGit(repoDir, ["push", "-u", "origin", "HEAD"]);

    return repoDir;
  }

  it("reports up-to-date when push has nothing to send", async () => {
    const repoDir = await createRepoWithUpstream();
    const { projectId, routes } = createRoutesForProject(repoDir);

    const response = await routes.request(`/${projectId}/git/push`, {
      method: "POST",
    });
    const body = (await response.json()) as GitPushResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe("up-to-date");
    expect(body.gitStatus?.ahead).toBe(0);
  });

  it("reports pushed when push sends local commits", async () => {
    const repoDir = await createRepoWithUpstream();
    await commitFile(repoDir, "README.md", "hello again\n", "Update readme");
    const { projectId, routes } = createRoutesForProject(repoDir);

    const response = await routes.request(`/${projectId}/git/push`, {
      method: "POST",
    });
    const body = (await response.json()) as GitPushResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe("pushed");
    expect(body.gitStatus?.ahead).toBe(0);
  });

  it("reports the last fetch time recorded by git", async () => {
    const repoDir = await createRepoWithUpstream();
    const { projectId, routes } = createRoutesForProject(repoDir);
    const beforeFetchMs = Date.now() - 2_000;

    await runGit(repoDir, ["fetch", "origin"]);

    const afterFetchMs = Date.now() + 2_000;
    const response = await routes.request(`/${projectId}/git`);
    const body = (await response.json()) as GitStatusInfo;
    const checkedRemoteMs = Date.parse(body.checkedRemoteAt ?? "");

    expect(response.status).toBe(200);
    expect(body.checkedRemoteAt).toEqual(expect.any(String));
    expect(Number.isFinite(checkedRemoteMs)).toBe(true);
    expect(checkedRemoteMs).toBeGreaterThanOrEqual(beforeFetchMs);
    expect(checkedRemoteMs).toBeLessThanOrEqual(afterFetchMs);
  });
});
