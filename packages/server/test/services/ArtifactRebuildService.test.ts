import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ArtifactRebuildService,
  parseArtifactRebuildDescriptor,
  type RebuildDescriptor,
} from "../../src/services/ArtifactRebuildService.js";

describe("artifact rebuild hooks", () => {
  let root: string;
  let artifact: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "artifact-rebuild-"));
    artifact = join(root, "report.html");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function descriptor(argv: string[], extra = "") {
    return `<!doctype html><!-- ya-artifact:v1 ${JSON.stringify({
      regenerate: {
        hook: "report-build",
        registrationVersion: 1,
        proposedRegistration: { cwd: root, argv, outputs: [artifact] },
      },
    })} --><h1>Report${extra}</h1>`;
  }

  /** The approval a user gives after being shown this descriptor. */
  function approval(shown: RebuildDescriptor) {
    return {
      registrationVersion: shown.registrationVersion,
      ...shown.proposedRegistration!,
    };
  }

  it("parses only a well-formed descriptor from a real comment", () => {
    expect(
      parseArtifactRebuildDescriptor(descriptor(["node", "-e", "1"])),
    ).toMatchObject({ hook: "report-build", registrationVersion: 1 });
    expect(
      parseArtifactRebuildDescriptor(
        '<!-- ya-artifact:v1 {"regenerate":{"hook":"../x","registrationVersion":1}} -->',
      ),
    ).toBeUndefined();
    expect(
      parseArtifactRebuildDescriptor("<!-- ya-artifact:v1 not json -->"),
    ).toBeUndefined();
    expect(
      parseArtifactRebuildDescriptor(
        '<!-- ya-artifact:v1 {"regenerate":{"hook":"h","registrationVersion":1,"proposedRegistration":{"cwd":"relative","argv":["x"]}}} -->',
      ),
    ).toBeUndefined();
  });

  it("refuses to run before approval and runs the approved command afterwards", async () => {
    const service = new ArtifactRebuildService(join(root, "state"));
    const script = join(root, "build.mjs");
    await writeFile(
      script,
      `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], process.argv[3]); console.log("built");`,
    );
    const html = descriptor([process.execPath, script, artifact, "rebuilt"]);
    await writeFile(artifact, html);
    const parsed = parseArtifactRebuildDescriptor(html)!;
    expect(await service.status(artifact, parsed)).toMatchObject({
      registered: false,
      matches: false,
    });
    await expect(service.run(artifact, parsed)).rejects.toThrow(/approve/);

    // An approval of a different proposal registers nothing.
    const other = parseArtifactRebuildDescriptor(
      descriptor([process.execPath, script, artifact, "other"]),
    )!;
    expect(
      await service.register(artifact, parsed, approval(other)),
    ).toBeUndefined();
    expect((await service.status(artifact, parsed)).registered).toBe(false);

    expect(
      await service.register(artifact, parsed, approval(parsed)),
    ).toMatchObject({
      registered: true,
      matches: true,
    });
    const result = await service.run(artifact, parsed);
    expect(result).toMatchObject({ ok: true, exitCode: 0, timedOut: false });
    expect(result.log).toContain("built");
    expect(await readFile(artifact, "utf8")).toBe("rebuilt");

    // The registry survives a fresh service instance.
    const reloaded = new ArtifactRebuildService(join(root, "state"));
    expect(await reloaded.status(artifact, parsed)).toMatchObject({
      registered: true,
      matches: true,
    });
    // A changed proposal no longer matches the approval.
    const changed = parseArtifactRebuildDescriptor(
      descriptor([process.execPath, script, artifact, "other"]),
    )!;
    expect(await reloaded.status(artifact, changed)).toMatchObject({
      registered: true,
      matches: false,
    });
    await expect(reloaded.run(artifact, changed)).rejects.toThrow(/approve/);
  });

  it("reports a failing command and bounds its runtime", async () => {
    const service = new ArtifactRebuildService(join(root, "state"));
    const failing = parseArtifactRebuildDescriptor(
      descriptor([
        process.execPath,
        "-e",
        "console.error('boom'); process.exit(3)",
      ]),
    )!;
    await service.register(artifact, failing, approval(failing));
    expect(await service.run(artifact, failing)).toMatchObject({
      ok: false,
      exitCode: 3,
    });
    const slow = parseArtifactRebuildDescriptor(
      `<!-- ya-artifact:v1 ${JSON.stringify({
        regenerate: {
          hook: "slow",
          registrationVersion: 1,
          proposedRegistration: {
            cwd: root,
            argv: [process.execPath, "-e", "setTimeout(() => {}, 60000)"],
            timeoutSeconds: 1,
          },
        },
      })} -->`,
    )!;
    await service.register(artifact, slow, approval(slow));
    const result = await service.run(artifact, slow);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 20000);
});
