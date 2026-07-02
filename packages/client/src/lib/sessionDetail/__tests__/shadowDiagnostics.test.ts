import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, SessionMetadata } from "../../../types";
import { UI_KEYS } from "../../storageKeys";
import {
  __resetSessionDetailShadowDiagnosticsForTest,
  isSessionDetailShadowDiagnosticsEnabled,
  reportSessionDetailShadowDivergence,
} from "../shadowDiagnostics";
import {
  createInitialSessionDetailState,
  reduceSessionDetailState,
} from "../transcriptReducer";

function sessionMetadata(): SessionMetadata {
  return {
    id: "session-1",
    projectId: "project-1",
    provider: "codex",
    title: "Session 1",
    updatedAt: "2026-07-02T00:00:00.000Z",
    createdAt: "2026-07-02T00:00:00.000Z",
    messageCount: 0,
    ownership: { owner: "none" },
  } as SessionMetadata;
}

function userMessage(uuid: string, text: string): Message {
  return {
    uuid,
    type: "user",
    timestamp: "2026-07-02T00:00:00.000Z",
    message: {
      role: "user",
      content: text,
    },
  };
}

describe("session detail shadow diagnostics", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = undefined;
    __resetSessionDetailShadowDiagnosticsForTest();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = undefined;
    __resetSessionDetailShadowDiagnosticsForTest();
    vi.restoreAllMocks();
  });

  it("requires an explicit dev diagnostic opt-in", () => {
    expect(isSessionDetailShadowDiagnosticsEnabled()).toBe(false);

    window.localStorage.setItem(
      UI_KEYS.sessionDetailShadowDiagnostics,
      "true",
    );

    expect(isSessionDetailShadowDiagnosticsEnabled()).toBe(true);
  });

  it("logs compact divergence details without transcript text", () => {
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = sessionMetadata();
    const liveMessage = {
      ...userMessage("live-user-1", "secret live text"),
      _source: "sdk" as const,
    };
    const shadowMessage = userMessage("shadow-user-1", "secret shadow text");
    const shadow = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session,
      messages: [shadowMessage],
    });

    reportSessionDetailShadowDivergence({
      boundary: "test-boundary",
      projectId: "project-1",
      sessionId: "session-1",
      provider: "codex",
      live: {
        messages: [liveMessage],
        session,
        agentContent: {},
        toolUseToAgentEntries: [],
        maxPersistedTimestampMs: Number.NEGATIVE_INFINITY,
      },
      shadow,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]?.[1] as unknown;
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload).toMatchObject({
      event: "session-detail-shadow-divergence",
      boundary: "test-boundary",
      firstMessageDiff: {
        index: 0,
        live: { id: "live-user-1" },
        shadow: { id: "shadow-user-1" },
      },
    });
  });

  it("dedupes repeated divergence logs for the same boundary and shape", () => {
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = sessionMetadata();
    const shadow = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "loadPersistedTranscript",
      session,
      messages: [userMessage("shadow-user-1", "shadow")],
    });
    const input = {
      boundary: "repeat",
      projectId: "project-1",
      sessionId: "session-1",
      provider: "codex",
      live: {
        messages: [userMessage("live-user-1", "live")],
        session,
        agentContent: {},
        toolUseToAgentEntries: [],
        maxPersistedTimestampMs: Number.NEGATIVE_INFINITY,
      },
      shadow,
    };

    reportSessionDetailShadowDivergence(input);
    reportSessionDetailShadowDivergence(input);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
