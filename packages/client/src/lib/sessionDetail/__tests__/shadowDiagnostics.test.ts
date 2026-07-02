import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, SessionMetadata } from "../../../types";
import { UI_KEYS } from "../../storageKeys";
import {
  __resetSessionDetailShadowDiagnosticsForTest,
  isSessionDetailShadowDiagnosticsEnabled,
  reportSessionDetailReturnedDataDivergence,
  reportSessionDetailStoreDivergence,
} from "../shadowDiagnostics";

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

    window.localStorage.setItem(UI_KEYS.sessionDetailShadowDiagnostics, "true");

    expect(isSessionDetailShadowDiagnosticsEnabled()).toBe(true);
  });

  it("dedupes repeated divergence logs for the same boundary and shape", () => {
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = sessionMetadata();
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
      store: {
        messages: [userMessage("store-user-1", "store")],
        session,
        agentContent: {},
        toolUseToAgentEntries: [],
        maxPersistedTimestampMs: Number.NEGATIVE_INFINITY,
      },
    };

    reportSessionDetailStoreDivergence(input);
    reportSessionDetailStoreDivergence(input);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("logs store selector divergence with the same redacted shape", () => {
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = sessionMetadata();
    const liveMessage = userMessage("live-user-1", "secret live text");
    const storeMessage = userMessage("store-user-1", "secret store text");

    reportSessionDetailStoreDivergence({
      boundary: "store-boundary",
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
      store: {
        messages: [storeMessage],
        session,
        agentContent: {},
        toolUseToAgentEntries: [],
        maxPersistedTimestampMs: Number.NEGATIVE_INFINITY,
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]?.[1] as unknown;
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload).toMatchObject({
      event: "session-detail-store-divergence",
      boundary: "store-boundary",
      firstMessageDiff: {
        index: 0,
        live: { id: "live-user-1" },
        store: { id: "store-user-1" },
      },
    });
  });

  it("logs returned-data invariant divergence without transcript text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const returnedMessage = userMessage("returned-user-1", "secret returned");
    const storeMessage = userMessage("store-user-1", "secret store");
    const returnedAgentMessage = userMessage(
      "returned-agent-1",
      "secret returned agent",
    );
    const storeAgentMessage = userMessage(
      "store-agent-1",
      "secret store agent",
    );

    reportSessionDetailReturnedDataDivergence({
      boundary: "returned-detail",
      projectId: "project-1",
      sessionId: "session-1",
      provider: "codex",
      returned: {
        messages: [returnedMessage],
        agentContent: {
          "agent-1": {
            messages: [returnedAgentMessage],
            status: "running",
          },
        },
        toolUseToAgentEntries: [["toolu_returned", "agent-returned"]],
      },
      store: {
        messages: [storeMessage],
        agentContent: {
          "agent-1": {
            messages: [storeAgentMessage],
            status: "running",
          },
        },
        toolUseToAgentEntries: [["toolu_store", "agent-store"]],
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]?.[1] as unknown;
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload).toMatchObject({
      event: "session-detail-returned-data-divergence",
      boundary: "returned-detail",
      firstMessageDiff: {
        index: 0,
        live: { id: "returned-user-1" },
        store: { id: "store-user-1" },
      },
      firstAgentDiff: {
        agentId: "agent-1",
        returned: {
          first: { id: "returned-agent-1" },
        },
        store: {
          first: { id: "store-agent-1" },
        },
      },
      returned: {
        toolUseToAgentEntries: [["toolu_returned", "agent-returned"]],
      },
      store: {
        toolUseToAgentEntries: [["toolu_store", "agent-store"]],
      },
    });
  });
});
