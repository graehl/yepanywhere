import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  disableCodexRolloutsForKilledSession,
  findCodexRolloutPathsForSessionId,
  isCodexRolloutProvider,
  isUnownedHeartbeatResumeEligible,
  killedRolloutTimestamp,
} from "../../src/sessions/resume-exemption.js";
import { isCodexRolloutFileName } from "../../src/utils/codexRolloutFiles.js";

const SESSION_ID = "019f30db-38df-79d0-bd60-64777fb57480";
const OTHER_SESSION_ID = "019f30dd-31af-74a0-bc84-2d1cb6f20985";

describe("resume exemption", () => {
  describe("isUnownedHeartbeatResumeEligible", () => {
    it("requires heartbeat opt-in", () => {
      expect(isUnownedHeartbeatResumeEligible({})).toBe(false);
      expect(
        isUnownedHeartbeatResumeEligible({ heartbeatTurnsEnabled: true }),
      ).toBe(true);
    });

    it("exempts archived sessions even with heartbeat enabled", () => {
      expect(
        isUnownedHeartbeatResumeEligible({
          heartbeatTurnsEnabled: true,
          isArchived: true,
        }),
      ).toBe(false);
    });
  });

  describe("isCodexRolloutProvider", () => {
    it("covers both codex providers and nothing else", () => {
      expect(isCodexRolloutProvider("codex")).toBe(true);
      expect(isCodexRolloutProvider("codex-oss")).toBe(true);
      expect(isCodexRolloutProvider("claude")).toBe(false);
    });
  });

  describe("rollout tombstoning", () => {
    let sessionsDir: string;
    let shardDir: string;

    beforeEach(async () => {
      sessionsDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "ya-resume-exemption-"),
      );
      shardDir = path.join(sessionsDir, "2026", "07", "05");
      await fs.mkdir(shardDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(sessionsDir, { recursive: true, force: true });
    });

    function rolloutName(sessionId: string, ext = ".jsonl"): string {
      return `rollout-2026-07-05T05-58-21-${sessionId}${ext}`;
    }

    it("finds plain and compressed rollouts for the session only", async () => {
      const plain = path.join(shardDir, rolloutName(SESSION_ID));
      const compressed = path.join(
        shardDir,
        rolloutName(SESSION_ID, ".jsonl.zst"),
      );
      const other = path.join(shardDir, rolloutName(OTHER_SESSION_ID));
      await fs.writeFile(plain, "{}\n");
      await fs.writeFile(compressed, "zst");
      await fs.writeFile(other, "{}\n");

      const found = await findCodexRolloutPathsForSessionId(
        sessionsDir,
        SESSION_ID,
      );
      expect(found.sort()).toEqual([compressed, plain].sort());
    });

    it("returns empty for a missing sessions dir", async () => {
      await expect(
        findCodexRolloutPathsForSessionId(
          path.join(sessionsDir, "does-not-exist"),
          SESSION_ID,
        ),
      ).resolves.toEqual([]);
    });

    it("renames the rollout so no discovery or resume path matches it", async () => {
      const plain = path.join(shardDir, rolloutName(SESSION_ID));
      await fs.writeFile(plain, "{}\n");

      const result = await disableCodexRolloutsForKilledSession(
        sessionsDir,
        SESSION_ID,
        new Date("2026-07-19T16:45:00.000Z"),
      );

      expect(result.failed).toEqual([]);
      expect(result.renamed).toHaveLength(1);
      const renamed = result.renamed[0];
      expect(renamed.from).toBe(plain);
      expect(renamed.to).toBe(`${plain}.killed-20260719T164500Z`);
      // Original gone, tombstone present.
      await expect(fs.access(plain)).rejects.toThrow();
      await expect(fs.access(renamed.to)).resolves.toBeUndefined();
      // The tombstoned name is invisible to rollout discovery/resume.
      expect(isCodexRolloutFileName(path.basename(renamed.to))).toBe(false);
      await expect(
        findCodexRolloutPathsForSessionId(sessionsDir, SESSION_ID),
      ).resolves.toEqual([]);
    });

    it("is reversible by stripping the suffix", async () => {
      const plain = path.join(shardDir, rolloutName(SESSION_ID));
      await fs.writeFile(plain, "{}\n");
      const { renamed } = await disableCodexRolloutsForKilledSession(
        sessionsDir,
        SESSION_ID,
      );
      await fs.rename(renamed[0].to, renamed[0].from);
      await expect(
        findCodexRolloutPathsForSessionId(sessionsDir, SESSION_ID),
      ).resolves.toEqual([plain]);
    });

    it("no-ops when the session has no rollout", async () => {
      await expect(
        disableCodexRolloutsForKilledSession(sessionsDir, SESSION_ID),
      ).resolves.toEqual({ renamed: [], failed: [] });
    });
  });

  describe("killedRolloutTimestamp", () => {
    it("is filename-safe basic ISO", () => {
      expect(killedRolloutTimestamp(new Date("2026-07-19T16:45:30.123Z"))).toBe(
        "20260719T164530Z",
      );
    });
  });
});
