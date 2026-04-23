import { act, renderHook } from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionStatusEvent,
  SessionUpdatedEvent,
} from "../../lib/activityBus";
import type { SessionStatus } from "../../types";
import { useSession } from "../useSession";

const fetchNewMessages = vi.fn(async () => {});
const fetchSessionMetadata = vi.fn(async () => {});

let fileActivityOptions:
  | {
      onSessionStatusChange?: (event: SessionStatusEvent) => void;
      onSessionUpdated?: (event: SessionUpdatedEvent) => void;
    }
  | undefined;

let sessionStreamHandler:
  | ((data: { eventType: string; [key: string]: unknown }) => void)
  | null = null;

const PROJECT_ID = "proj-1" as unknown as UrlProjectId;

vi.mock("../useSessionMessages", () => ({
  useSessionMessages: vi.fn(() => ({
    messages: [],
    agentContent: {},
    toolUseToAgent: new Map(),
    loading: false,
    session: {
      id: "sess-1",
      projectId: "proj-1",
      provider: "codex",
      model: "gpt-5.4",
      messages: [],
    },
    setSession: vi.fn(),
    handleStreamingUpdate: vi.fn(),
    handleStreamMessageEvent: vi.fn(),
    handleStreamSubagentMessage: vi.fn(),
    registerToolUseAgent: vi.fn(),
    setAgentContent: vi.fn(),
    setToolUseToAgent: vi.fn(),
    setMessages: vi.fn(),
    fetchNewMessages,
    fetchSessionMetadata,
    pagination: undefined,
    loadingOlder: false,
    loadOlderMessages: vi.fn(async () => {}),
  })),
}));

vi.mock("../useFileActivity", () => ({
  useFileActivity: vi.fn((options) => {
    fileActivityOptions = options;
  }),
}));

vi.mock("../useSessionStream", () => ({
  useSessionStream: vi.fn((_sessionId, options) => {
    sessionStreamHandler = options.onMessage;
    return { connected: true, reconnect: vi.fn() };
  }),
}));

vi.mock("../useSessionWatchStream", () => ({
  useSessionWatchStream: vi.fn(() => ({ connected: false })),
}));

vi.mock("../useStreamingContent", () => ({
  useStreamingContent: vi.fn(() => ({
    handleStreamEvent: vi.fn(() => false),
    clearStreaming: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

describe("useSession completion reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fileActivityOptions = undefined;
    sessionStreamHandler = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes persisted messages when the live stream completes", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    expect(sessionStreamHandler).not.toBeNull();

    act(() => {
      sessionStreamHandler?.({ eventType: "complete" });
    });

    expect(result.current.processState).toBe("idle");
    expect(result.current.status).toEqual({ owner: "none" });
    expect(fetchNewMessages).toHaveBeenCalledTimes(1);
  });

  it("refreshes persisted messages when ownership drops to none", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    expect(fileActivityOptions?.onSessionStatusChange).toBeDefined();

    act(() => {
      fileActivityOptions?.onSessionStatusChange?.({
        type: "session-status-changed",
        sessionId: "sess-1",
        projectId: PROJECT_ID,
        ownership: { owner: "none" } as SessionStatus,
        timestamp: "2026-04-23T00:00:00.000Z",
      });
    });

    expect(result.current.processState).toBe("idle");
    expect(result.current.status).toEqual({ owner: "none" });
    expect(fetchNewMessages).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for unrelated session status events", () => {
    renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      fileActivityOptions?.onSessionStatusChange?.({
        type: "session-status-changed",
        sessionId: "other-session",
        projectId: PROJECT_ID,
        ownership: { owner: "none" } as SessionStatus,
        timestamp: "2026-04-23T00:00:00.000Z",
      });
    });

    expect(fetchNewMessages).not.toHaveBeenCalled();
  });
});
