import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideLimitedRoute } from "../../src/auth/limitedUserPolicy.js";
import {
  INITIAL_COMMIT_MESSAGE,
  decideProjectCreation,
  ensureProjectDirectory,
  isContainedOnDisk,
  isWithinRoot,
} from "../../src/routes/project-creation.js";
import { runGit } from "../../src/git/gitExec.js";

/** Contract: topics/limited-users.md § Delivery v1 — Project creation. */

const contextFor = (principal: unknown) =>
  ({ get: () => principal }) as unknown as Parameters<
    typeof decideProjectCreation
  >[0];

function limited(projectRoot?: string) {
  return {
    kind: "limited",
    username: "archer",
    switched: false,
    locked: true,
    via: "direct",
    grants: {
      newSessionProjects: [],
      joinProjects: [],
      viewProjects: [],
      joinStaleOffsetMinutes: 0,
      lock: {},
      ...(projectRoot ? { projectRoot } : {}),
    },
  };
}

describe("isWithinRoot", () => {
  it("accepts the root and anything beneath it", () => {
    expect(isWithinRoot("/home/a", "/home/a")).toBe(true);
    expect(isWithinRoot("/home/a", "/home/a/proj")).toBe(true);
    expect(isWithinRoot("/home/a", "/home/a/deep/proj")).toBe(true);
  });

  it("refuses a sibling whose path merely starts the same", () => {
    expect(isWithinRoot("/home/a", "/home/ab")).toBe(false);
    expect(isWithinRoot("/home/a", "/home/b")).toBe(false);
  });

  it("refuses a walk back out through ..", () => {
    expect(isWithinRoot("/home/a", "/home/a/../b")).toBe(false);
    expect(isWithinRoot("/home/a", "/home/a/x/../../b")).toBe(false);
  });
});

describe("decideProjectCreation", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "ya-projroot-")),
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lets the superuser add anything, owned by nobody in particular", async () => {
    await expect(
      decideProjectCreation(contextFor({ kind: "superuser" }), "/anywhere"),
    ).resolves.toEqual({ kind: "allowed" });
  });

  it("refuses a limited user with no configured directory", async () => {
    const decision = await decideProjectCreation(
      contextFor(limited()),
      path.join(root, "proj"),
    );
    expect(decision.kind).toBe("denied");
  });

  it("allows one under their directory and records them as owner", async () => {
    await expect(
      decideProjectCreation(contextFor(limited(root)), path.join(root, "proj")),
    ).resolves.toEqual({
      kind: "allowed",
      owner: { username: "archer", projectRoot: root },
    });
  });

  it("refuses one outside their directory", async () => {
    const decision = await decideProjectCreation(
      contextFor(limited(root)),
      "/etc",
    );
    expect(decision.kind).toBe("denied");
    expect(decision).toMatchObject({
      error: expect.stringContaining(root),
    });
  });

  it("refuses the root itself, which is where projects go", async () => {
    const decision = await decideProjectCreation(
      contextFor(limited(root)),
      root,
    );
    expect(decision.kind).toBe("denied");
  });
});

describe("isContainedOnDisk", () => {
  let dir: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "ya-projdisk-")),
    );
    root = path.join(dir, "root");
    outside = path.join(dir, "outside");
    await fs.mkdir(root);
    await fs.mkdir(outside);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("accepts a directory, or a missing leaf, beneath the root", async () => {
    await fs.mkdir(path.join(root, "made"));
    expect(await isContainedOnDisk(root, path.join(root, "made"))).toBe(true);
    expect(await isContainedOnDisk(root, path.join(root, "fresh"))).toBe(true);
  });

  it("follows a symlinked root to where it really is", async () => {
    const alias = path.join(dir, "root-alias");
    await fs.symlink(root, alias);
    expect(await isContainedOnDisk(alias, path.join(alias, "proj"))).toBe(true);
  });

  it("refuses a symlinked leaf wherever it points", async () => {
    await fs.symlink(outside, path.join(root, "out"));
    await fs.mkdir(path.join(root, "real"));
    await fs.symlink(path.join(root, "real"), path.join(root, "in"));
    expect(await isContainedOnDisk(root, path.join(root, "out"))).toBe(false);
    expect(await isContainedOnDisk(root, path.join(root, "in"))).toBe(false);
  });

  it("refuses a leaf under a symlinked parent that leaves the root", async () => {
    await fs.symlink(outside, path.join(root, "via"));
    expect(await isContainedOnDisk(root, path.join(root, "via", "proj"))).toBe(
      false,
    );
  });

  it("accepts a missing root so creation can make its directories", async () => {
    expect(
      await isContainedOnDisk(
        path.join(dir, "no-root"),
        path.join(dir, "no-root", "proj"),
      ),
    ).toBe(true);
  });
});

describe("limited-user route policy for adding a project", () => {
  it("reaches the route, which is what holds them to their directory", () => {
    expect(
      decideLimitedRoute({ method: "POST", path: "/api/projects" }),
    ).toEqual({ kind: "allow" });
    // Anything else on the collection stays refused.
    expect(
      decideLimitedRoute({ method: "DELETE", path: "/api/projects" }),
    ).toEqual({ kind: "deny" });
  });
});

describe("ensureProjectDirectory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-projcreate-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("leaves an existing directory exactly as it is", async () => {
    const outcome = await ensureProjectDirectory(dir, { create: true });
    expect(outcome).toEqual({ kind: "exists" });
    // No repository was imposed on a tree YA did not make.
    await expect(fs.stat(path.join(dir, ".git"))).rejects.toThrow();
  });

  it("refuses a missing directory until the caller asks to create it", async () => {
    const target = path.join(dir, "unconfirmed");
    const outcome = await ensureProjectDirectory(target, { create: false });
    expect(outcome).toMatchObject({ kind: "error", status: 404 });
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it("creates the directory as a repository with one empty commit", async () => {
    const target = path.join(dir, "fresh");
    const outcome = await ensureProjectDirectory(target, { create: true });
    expect(outcome).toEqual({ kind: "created" });

    const { stdout: log } = await runGit(target, ["log", "--format=%s"]);
    expect(log.trim()).toBe(INITIAL_COMMIT_MESSAGE);
    // Empty: the first real change has a root revision to diff against.
    const { stdout: files } = await runGit(target, [
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
    ]);
    expect(files.trim()).toBe("");
  });

  it("creates a plain folder when the caller declines Git", async () => {
    const target = path.join(dir, "plain");
    const outcome = await ensureProjectDirectory(target, {
      create: true,
      initializeGit: false,
    });
    expect(outcome).toEqual({ kind: "created" });
    expect((await fs.stat(target)).isDirectory()).toBe(true);
    await expect(fs.stat(path.join(target, ".git"))).rejects.toThrow();
  });

  it("creates only the last folder of the path", async () => {
    const target = path.join(dir, "missing-parent", "leaf");
    const outcome = await ensureProjectDirectory(target, { create: true });
    expect(outcome).toMatchObject({ kind: "error", status: 404 });
    await expect(fs.stat(path.dirname(target))).rejects.toThrow();
  });

  it("commits even where the host configures no git identity", async () => {
    // The suite runs with a temporary HOME, so this is that machine: git
    // refuses to commit without a committer, and a fresh host is exactly
    // who this feature is for.
    const target = path.join(dir, "no-identity");
    const outcome = await ensureProjectDirectory(target, { create: true });
    expect(outcome).toEqual({ kind: "created" });
    const { stdout } = await runGit(target, ["log", "--format=%an <%ae>"]);
    expect(stdout.trim()).not.toBe("");
  });

  it("refuses to build a whole tree from one typed path", async () => {
    const target = path.join(dir, "missing-parent", "proj");
    const outcome = await ensureProjectDirectory(target, { create: true });
    expect(outcome).toMatchObject({ kind: "error", status: 404 });
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it("refuses a path that exists as a file", async () => {
    const target = path.join(dir, "a-file");
    await fs.writeFile(target, "");
    const outcome = await ensureProjectDirectory(target, { create: true });
    expect(outcome).toMatchObject({ kind: "error", status: 400 });
  });
});
