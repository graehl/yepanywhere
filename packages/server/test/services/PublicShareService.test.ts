import type { AppSession, UrlProjectId } from "@yep-anywhere/shared";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PUBLIC_SHARE_SECRET_BITS,
  PUBLIC_SHARE_SECRET_BYTES,
  PublicShareService,
} from "../../src/services/PublicShareService.js";

const projectId = "cHJvamVjdA" as UrlProjectId;

function makeSession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    id: "session-1",
    projectId,
    title: "Test session",
    fullTitle: "Test session",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:01:00.000Z",
    messageCount: 0,
    ownership: { owner: "self", processId: "proc-1" },
    provider: "codex",
    messages: [],
    pendingInputType: "tool-approval",
    activity: "waiting-input",
    lastSeenAt: "2026-05-01T00:00:30.000Z",
    hasUnread: true,
    ...overrides,
  } as AppSession;
}

describe("PublicShareService", () => {
  let service: PublicShareService;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "public-shares-test-"));
    service = new PublicShareService({ dataDir: testDir });
    await service.initialize();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("generates a 512-bit URL secret and stores only its hash", async () => {
    const { secret, secretBits } = await service.createShare({
      mode: "frozen",
      title: "Share me",
      source: {
        projectId,
        sessionId: "session-1",
        projectName: "project",
        provider: "codex",
      },
      snapshot: makeSession(),
    });

    expect(secretBits).toBe(PUBLIC_SHARE_SECRET_BITS);
    expect(Buffer.from(secret, "base64url")).toHaveLength(
      PUBLIC_SHARE_SECRET_BYTES,
    );

    const persisted = await fs.readFile(
      path.join(testDir, "public-shares.json"),
      "utf-8",
    );
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain("secretHash");
  });

  it("rejects missing, short, and guessed secrets", async () => {
    await service.createShare({
      mode: "frozen",
      source: {
        projectId,
        sessionId: "session-1",
        projectName: "project",
        provider: "codex",
      },
      snapshot: makeSession(),
    });

    expect(service.getRecordBySecret("")).toBeNull();
    expect(service.getRecordBySecret("short")).toBeNull();
    expect(
      service.getRecordBySecret(Buffer.alloc(64, 1).toString("base64url")),
    ).toBeNull();
  });

  it("stores frozen shares as sanitized read-only snapshots", async () => {
    const session = makeSession({
      messages: [
        {
          type: "user",
          uuid: "message-1",
          message: { role: "user", content: "hello" },
          timestamp: "2026-05-01T00:00:00.000Z",
        },
      ] as AppSession["messages"],
    }) as AppSession & {
      heartbeatTurnText?: string;
      heartbeatTurnsAfterMinutes?: number;
      heartbeatTurnsEnabled?: boolean;
    };
    session.heartbeatTurnsEnabled = true;
    session.heartbeatTurnsAfterMinutes = 5;
    session.heartbeatTurnText = "heartbeat";

    const { secret } = await service.createShare({
      mode: "frozen",
      title: "Frozen",
      source: {
        projectId,
        sessionId: "session-1",
        projectName: "project",
        provider: "codex",
      },
      snapshot: session,
    });

    const share = service.getFrozenShareBySecret(secret);
    expect(share?.share.mode).toBe("frozen");
    expect(share?.session.ownership).toEqual({ owner: "none" });
    expect(share?.session.messages).toHaveLength(1);
    expect(share?.session.pendingInputType).toBeUndefined();
    expect(share?.session.activity).toBeUndefined();
    expect(share?.session.lastSeenAt).toBeUndefined();
    expect(share?.session.hasUnread).toBeUndefined();
    expect(
      (share?.session as typeof session).heartbeatTurnsEnabled,
    ).toBeUndefined();
  });

  it("builds live responses from the current session", async () => {
    const { secret } = await service.createShare({
      mode: "live",
      title: "Live",
      source: {
        projectId,
        sessionId: "session-1",
        projectName: "project",
        provider: "codex",
      },
    });
    const record = service.getRecordBySecret(secret);

    expect(record?.frozenSession).toBeUndefined();
    const response = service.buildLiveResponse(
      record!,
      makeSession({ updatedAt: "2026-05-01T00:02:00.000Z" }),
    );

    expect(response.share.mode).toBe("live");
    expect(response.share.updatedAt).toBe("2026-05-01T00:02:00.000Z");
    expect(response.session.ownership).toEqual({ owner: "none" });
  });

  it("summarizes and revokes all shares for a source session", async () => {
    await service.createShare({
      mode: "frozen",
      title: "Frozen",
      source: {
        projectId,
        sessionId: "session-1",
        projectName: "project",
        provider: "codex",
      },
      snapshot: makeSession(),
    });
    await service.createShare({
      mode: "live",
      title: "Live",
      source: {
        projectId,
        sessionId: "session-1",
        projectName: "project",
        provider: "codex",
      },
    });
    await service.createShare({
      mode: "live",
      title: "Other",
      source: {
        projectId,
        sessionId: "session-2",
        projectName: "project",
        provider: "codex",
      },
    });

    expect(service.getSessionShareStatus(projectId, "session-1")).toEqual({
      activeCount: 2,
      frozenCount: 1,
      liveCount: 1,
    });

    await expect(
      service.revokeSessionShares(projectId, "session-1"),
    ).resolves.toEqual({
      activeCount: 0,
      frozenCount: 0,
      liveCount: 0,
      revokedCount: 2,
    });
    expect(service.getSessionShareStatus(projectId, "session-2")).toEqual({
      activeCount: 1,
      frozenCount: 0,
      liveCount: 1,
    });
  });
});
