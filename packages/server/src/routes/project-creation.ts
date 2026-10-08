/**
 * Who may add a project where, and how a brand-new project directory is made.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Project creation.
 *
 * Two things live here so the route stays a route. A limited user may add a
 * project only under the directory the superuser configured for them, which
 * is a grant they do not have by default. And a path that does not exist yet
 * is created only when the request explicitly asks — the confirm prompt is
 * the client's, and without that flag the route still refuses a missing
 * directory exactly as it always has.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Context } from "hono";
import { runGit } from "../git/gitExec.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import { principalFor } from "../auth/limitedLaunchPolicy.js";

/** First commit of a project YA created, so the tree has a root to diff from. */
export const INITIAL_COMMIT_MESSAGE = "Initial commit";

/**
 * Identity for the empty first commit when the host configures none. Git
 * refuses to commit without one, and a machine that has never had `git
 * config user.email` set is exactly the fresh machine this feature is for.
 * Only the scaffolding commit uses it; the user's own commits take whatever
 * identity they configure later.
 */
const FALLBACK_COMMIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Yep Anywhere",
  GIT_AUTHOR_EMAIL: "yep-anywhere@localhost",
  GIT_COMMITTER_NAME: "Yep Anywhere",
  GIT_COMMITTER_EMAIL: "yep-anywhere@localhost",
} as const;

/** Whether this repository can already name a committer. */
async function hasCommitIdentity(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(cwd, ["config", "--get", "user.email"]);
    return stdout.trim() !== "";
  } catch {
    // `--get` exits non-zero when the key is unset, which is the answer.
    return false;
  }
}

/** Initializes only a newly allocated directory, retaining the host's commit identity. */
export async function initializeProjectGit(
  projectPath: string,
  trackFiles = false,
): Promise<void> {
  await runGit(projectPath, ["init"]);
  if (trackFiles) await runGit(projectPath, ["add", "--all"]);
  const identified = await hasCommitIdentity(projectPath);
  await runGit(
    projectPath,
    ["commit", "--allow-empty", "-m", INITIAL_COMMIT_MESSAGE],
    identified ? undefined : { env: { ...FALLBACK_COMMIT_IDENTITY } },
  );
}

/** A limited user's project: they own it and are held to `projectRoot`. */
export interface ProjectCreationOwner {
  username: string;
  projectRoot: string;
}

export type ProjectRootDecision =
  | { kind: "allowed"; owner?: ProjectCreationOwner }
  | { kind: "denied"; error: string };

/**
 * Whether `candidate` is the directory `root` or sits beneath it. Both are
 * resolved first, so `~` and `..` cannot walk out of the configured root.
 * This compares spellings only; `isContainedOnDisk` is what follows links.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(expandHomePath(root));
  const resolvedCandidate = path.resolve(expandHomePath(candidate));
  if (resolvedCandidate === resolvedRoot) return true;
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/**
 * Whether the project directory at `projectPath`, as the filesystem resolves
 * it, sits strictly beneath `root`. A symbolic link anywhere on the way is
 * followed, so `~/archer/x -> /` is outside `~/archer`; a symbolic link as
 * the project itself is refused outright, even one pointing back inside,
 * because a project is registered by the path typed and that path would then
 * name a directory other than the one checked. Missing components are resolved
 * from their nearest existing ancestor before creation is allowed.
 */
export async function isContainedOnDisk(
  root: string,
  projectPath: string,
): Promise<boolean> {
  const realRoot = await resolveFutureDirectory(
    path.resolve(expandHomePath(root)),
  );
  const leaf = path.resolve(expandHomePath(projectPath));
  try {
    if ((await fs.lstat(leaf)).isSymbolicLink()) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const realParent = await resolveFutureDirectory(path.dirname(leaf));
  const realLeaf = path.join(realParent, path.basename(leaf));
  return realLeaf !== realRoot && isWithinRoot(realRoot, realLeaf);
}

async function resolveFutureDirectory(directory: string): Promise<string> {
  try {
    await fs.lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(
      await resolveFutureDirectory(parent),
      path.basename(directory),
    );
  }
  // Existing dangling links, inaccessible paths and files are errors, not
  // missing directories that recursive mkdir may repair.
  const resolved = await fs.realpath(directory);
  if (!(await fs.stat(resolved)).isDirectory())
    throw new Error(`Project creation parent is not a directory: ${directory}`);
  return resolved;
}

/**
 * Decide whether the acting principal may add a project at this path, and
 * who ends up owning it. The superuser may add anything and owns nothing in
 * particular; a limited user is held to their configured root, on disk as
 * well as by spelling.
 */
export async function decideProjectCreation(
  c: Context,
  projectPath: string,
): Promise<ProjectRootDecision> {
  const principal = principalFor(c);
  if (principal.kind !== "limited") return { kind: "allowed" };

  const root = principal.grants.projectRoot;
  if (!root) {
    return {
      kind: "denied",
      error: "This user may not create projects",
    };
  }
  const outsideRoot: ProjectRootDecision = {
    kind: "denied",
    error: `This user may only create projects under ${root}`,
  };
  if (!isWithinRoot(root, projectPath)) return outsideRoot;
  // The root itself is where projects go, not a project.
  if (
    path.resolve(expandHomePath(projectPath)) ===
    path.resolve(expandHomePath(root))
  ) {
    return {
      kind: "denied",
      error: `${root} is the parent directory, not a project`,
    };
  }
  if (!(await isContainedOnDisk(root, projectPath))) return outsideRoot;
  return {
    kind: "allowed",
    owner: { username: principal.username, projectRoot: root },
  };
}

export type ProjectDirectoryOutcome =
  | { kind: "exists" }
  | { kind: "created" }
  | { kind: "error"; status: 400 | 404 | 409 | 500; error: string };

/**
 * Make a project directory that does not exist yet: create it, `git init`,
 * and leave one empty commit so the project has a root revision to diff
 * against from its very first change, unless the caller declines Git. An
 * existing directory is left exactly as it is — YA never runs `git init` over
 * somebody's tree.
 */
export async function ensureProjectDirectory(
  projectPath: string,
  options: { create: boolean; projectRoot?: string; initializeGit?: boolean },
): Promise<ProjectDirectoryOutcome> {
  let stats: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stats = await fs.stat(projectPath);
  } catch {
    stats = null;
  }

  if (stats) {
    if (!stats.isDirectory()) {
      return {
        kind: "error",
        status: 400,
        error: "Path exists and is not a directory",
      };
    }
    return { kind: "exists" };
  }

  if (!options.create) {
    return {
      kind: "error",
      status: 404,
      error: "Path does not exist or is not a directory",
    };
  }

  // The parent must already exist: creating a whole tree from one typed path
  // turns a typo into a directory nobody meant to make.
  const parent = path.dirname(projectPath);
  if (options.projectRoot) {
    try {
      if (
        !isWithinRoot(options.projectRoot, projectPath) ||
        !(await isContainedOnDisk(options.projectRoot, projectPath))
      )
        return {
          kind: "error",
          status: 400,
          error: "Project path escapes the configured creation directory",
        };
      await fs.mkdir(parent, { recursive: true });
      if (!(await isContainedOnDisk(options.projectRoot, projectPath)))
        return {
          kind: "error",
          status: 400,
          error: "Project path escapes the configured creation directory",
        };
    } catch (error) {
      return {
        kind: "error",
        status: 500,
        error: `Could not create project parent directory: ${(error as Error).message}`,
      };
    }
  }
  try {
    const parentStats = await fs.stat(parent);
    if (!parentStats.isDirectory()) {
      return {
        kind: "error",
        status: 400,
        error: `${parent} is not a directory`,
      };
    }
  } catch {
    return {
      kind: "error",
      status: 404,
      error: `${parent} does not exist`,
    };
  }

  try {
    await fs.mkdir(projectPath);
  } catch (error) {
    return {
      kind: "error",
      status: 500,
      error: `Could not create ${projectPath}: ${(error as Error).message}`,
    };
  }

  if (options.initializeGit === false) return { kind: "created" };
  try {
    await initializeProjectGit(projectPath);
  } catch (error) {
    // The directory exists and is the user's now; leaving it without a
    // repository is better than deleting a path we just handed them.
    return {
      kind: "error",
      status: 500,
      error: `Created ${projectPath} but could not initialize Git: ${
        (error as Error).message
      }`,
    };
  }

  return { kind: "created" };
}
