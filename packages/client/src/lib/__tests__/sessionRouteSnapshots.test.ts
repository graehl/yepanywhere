// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { asClientSummarySourceKey } from "../clientSummaryStore";
import {
  readSessionRouteSnapshot,
  resetSessionRouteSnapshotsForTests,
  writeSessionRouteSnapshot,
  type SessionRouteSnapshot,
} from "../sessionRouteSnapshots";

const SOURCE_A = asClientSummarySourceKey("host:a");
const SOURCE_B = asClientSummarySourceKey("host:b");
const PROJECT_ID = toUrlProjectId("/repo/project-a");

function snapshot(uuid: string): SessionRouteSnapshot {
  return {
    messages: [
      {
        uuid,
        type: "user",
        timestamp: "2026-06-30T00:00:00.000Z",
        message: { role: "user", content: uuid },
      },
    ],
    session: {
      id: "session-a",
      projectId: PROJECT_ID,
      provider: "claude",
      title: "Session A",
      fullTitle: "Session A",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      messageCount: 1,
      ownership: { owner: "none" },
    },
    agentContent: {},
    toolUseToAgentEntries: [],
    lastMessageId: uuid,
    maxPersistedTimestampMs: 0,
  };
}

describe("sessionRouteSnapshots", () => {
  beforeEach(() => {
    resetSessionRouteSnapshotsForTests();
  });

  it("keeps snapshots source-scoped", () => {
    writeSessionRouteSnapshot(
      { sourceKey: SOURCE_A, projectId: "project-a", sessionId: "session-a" },
      snapshot("source-a"),
    );

    expect(
      readSessionRouteSnapshot({
        sourceKey: SOURCE_A,
        projectId: "project-a",
        sessionId: "session-a",
      })?.lastMessageId,
    ).toBe("source-a");
    expect(
      readSessionRouteSnapshot({
        sourceKey: SOURCE_B,
        projectId: "project-a",
        sessionId: "session-a",
      }),
    ).toBeUndefined();
  });

  it("expires snapshots by TTL", () => {
    const key = {
      sourceKey: SOURCE_A,
      projectId: "project-a",
      sessionId: "session-a",
    };
    writeSessionRouteSnapshot(key, snapshot("msg-1"), {
      ttlMs: 10,
      nowMs: 0,
    });

    expect(readSessionRouteSnapshot(key, { nowMs: 9 })).toBeDefined();
    expect(readSessionRouteSnapshot(key, { nowMs: 11 })).toBeUndefined();
  });

  it("evicts least recently used snapshots by entry cap", () => {
    writeSessionRouteSnapshot(
      { sourceKey: SOURCE_A, projectId: "project-a", sessionId: "one" },
      snapshot("one"),
      { maxEntries: 2, nowMs: 0 },
    );
    writeSessionRouteSnapshot(
      { sourceKey: SOURCE_A, projectId: "project-a", sessionId: "two" },
      snapshot("two"),
      { maxEntries: 2, nowMs: 1 },
    );
    expect(
      readSessionRouteSnapshot(
        { sourceKey: SOURCE_A, projectId: "project-a", sessionId: "one" },
        { nowMs: 2 },
      )?.lastMessageId,
    ).toBe("one");
    writeSessionRouteSnapshot(
      { sourceKey: SOURCE_A, projectId: "project-a", sessionId: "three" },
      snapshot("three"),
      { maxEntries: 2, nowMs: 3 },
    );

    expect(
      readSessionRouteSnapshot(
        {
          sourceKey: SOURCE_A,
          projectId: "project-a",
          sessionId: "one",
        },
        { nowMs: 4 },
      ),
    ).toBeDefined();
    expect(
      readSessionRouteSnapshot(
        {
          sourceKey: SOURCE_A,
          projectId: "project-a",
          sessionId: "two",
        },
        { nowMs: 4 },
      ),
    ).toBeUndefined();
    expect(
      readSessionRouteSnapshot(
        {
          sourceKey: SOURCE_A,
          projectId: "project-a",
          sessionId: "three",
        },
        { nowMs: 4 },
      ),
    ).toBeDefined();
  });

  it("refuses snapshots over the byte cap", () => {
    const key = {
      sourceKey: SOURCE_A,
      projectId: "project-a",
      sessionId: "session-a",
    };

    expect(
      writeSessionRouteSnapshot(key, snapshot("message-too-large"), {
        maxBytes: 10,
      }),
    ).toBe(false);
    expect(readSessionRouteSnapshot(key)).toBeUndefined();
  });
});
