// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asClientSummarySourceKey } from "../../lib/clientSummaryStore";
import {
  readSessionRouteSnapshot,
  resetSessionRouteSnapshotsForTests,
  writeSessionRouteSnapshot,
  type SessionRouteSnapshot,
} from "../../lib/sessionRouteSnapshots";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  getSessionDomLingerEnabled,
  getSessionTranscriptCacheEnabled,
  useSessionPerformanceSettings,
} from "../useSessionPerformanceSettings";

const SOURCE = asClientSummarySourceKey("host:a");
const PROJECT_ID = toUrlProjectId("/repo/project-a");

function snapshot(): SessionRouteSnapshot {
  return {
    messages: [
      {
        uuid: "msg-1",
        type: "user",
        timestamp: "2026-07-01T00:00:00.000Z",
        message: { role: "user", content: "hello" },
      },
    ],
    session: {
      id: "session-a",
      projectId: PROJECT_ID,
      provider: "claude",
      title: "Session A",
      fullTitle: "Session A",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      messageCount: 1,
      ownership: { owner: "none" },
    },
    agentContent: {},
    toolUseToAgentEntries: [],
    lastMessageId: "msg-1",
    maxPersistedTimestampMs: 0,
  };
}

describe("useSessionPerformanceSettings", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
    resetSessionRouteSnapshotsForTests();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetSessionRouteSnapshotsForTests();
  });

  it("defaults session retention features to disabled", () => {
    const { result } = renderHook(() => useSessionPerformanceSettings());

    expect(result.current.sessionDomLingerEnabled).toBe(false);
    expect(result.current.sessionTranscriptCacheEnabled).toBe(false);
    expect(getSessionDomLingerEnabled()).toBe(false);
    expect(getSessionTranscriptCacheEnabled()).toBe(false);
  });

  it("reads stored disabled preferences", () => {
    localStorage.setItem(UI_KEYS.sessionDomLinger, "false");
    localStorage.setItem(UI_KEYS.sessionTranscriptCache, "false");

    const { result } = renderHook(() => useSessionPerformanceSettings());

    expect(result.current.sessionDomLingerEnabled).toBe(false);
    expect(result.current.sessionTranscriptCacheEnabled).toBe(false);
    expect(getSessionDomLingerEnabled()).toBe(false);
    expect(getSessionTranscriptCacheEnabled()).toBe(false);
  });

  it("persists and publishes updates", () => {
    const { result: first } = renderHook(() => useSessionPerformanceSettings());
    const { result: second } = renderHook(() =>
      useSessionPerformanceSettings(),
    );

    act(() => {
      first.current.setSessionDomLingerEnabled(false);
      first.current.setSessionTranscriptCacheEnabled(false);
    });

    expect(first.current.sessionDomLingerEnabled).toBe(false);
    expect(first.current.sessionTranscriptCacheEnabled).toBe(false);
    expect(second.current.sessionDomLingerEnabled).toBe(false);
    expect(second.current.sessionTranscriptCacheEnabled).toBe(false);
    expect(localStorage.getItem(UI_KEYS.sessionDomLinger)).toBe("false");
    expect(localStorage.getItem(UI_KEYS.sessionTranscriptCache)).toBe("false");
  });

  it("clears retained session snapshots when transcript cache is disabled", () => {
    const key = {
      sourceKey: SOURCE,
      projectId: PROJECT_ID,
      sessionId: "session-a",
    };
    writeSessionRouteSnapshot(key, snapshot());
    expect(readSessionRouteSnapshot(key)).toBeDefined();

    const { result } = renderHook(() => useSessionPerformanceSettings());
    act(() => {
      result.current.setSessionTranscriptCacheEnabled(false);
    });

    expect(readSessionRouteSnapshot(key)).toBeUndefined();
  });
});
