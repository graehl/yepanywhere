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

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
      key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
      get length() {
        return store.size;
      },
    },
  });
}

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
    installLocalStorageMock();
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

  it("clears deferred queue chips when the queued turn is echoed as a user message", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      sessionStreamHandler?.({
        eventType: "deferred-queue",
        messages: [
          {
            tempId: "temp-queued",
            content: "i see it already.",
            timestamp: "2026-04-24T00:00:00.000Z",
          },
        ],
      });
    });

    expect(result.current.deferredMessages).toHaveLength(1);

    act(() => {
      sessionStreamHandler?.({
        eventType: "message",
        type: "user",
        uuid: "uuid-queued",
        tempId: "temp-queued",
        message: {
          role: "user",
          content: "i see it already.",
        },
      });
    });

    expect(result.current.deferredMessages).toEqual([]);
  });

  it("does not re-add a promoted queued chip after the user echo already arrived", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      sessionStreamHandler?.({
        eventType: "message",
        type: "user",
        uuid: "uuid-promoted",
        tempId: "temp-promoted",
        message: {
          role: "user",
          content: "already promoted",
        },
      });
    });

    act(() => {
      result.current.addDeferredMessage({
        tempId: "temp-promoted",
        content: "already promoted",
        timestamp: "2026-04-24T00:00:00.000Z",
        deliveryState: "sending",
      });
    });

    expect(result.current.deferredMessages).toEqual([]);
  });

  it("keeps deferred queue chips on an idle status boundary", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      sessionStreamHandler?.({
        eventType: "deferred-queue",
        messages: [
          {
            tempId: "temp-stale",
            content: "stale queued text",
            timestamp: "2026-04-24T00:00:00.000Z",
          },
        ],
      });
    });

    expect(result.current.deferredMessages).toHaveLength(1);

    act(() => {
      sessionStreamHandler?.({ eventType: "status", state: "idle" });
    });

    expect(result.current.deferredMessages).toMatchObject([
      {
        tempId: "temp-stale",
        content: "stale queued text",
        deliveryState: "queued",
      },
    ]);
  });

  it("marks a promoted deferred queue chip as sending until the user echo arrives", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      result.current.addDeferredMessage({
        tempId: "temp-promoted",
        content: "promote this",
        timestamp: "2026-04-24T00:00:00.000Z",
      });
    });

    act(() => {
      sessionStreamHandler?.({
        eventType: "deferred-queue",
        reason: "promoted",
        tempId: "temp-promoted",
        messages: [],
      });
    });

    expect(result.current.deferredMessages).toMatchObject([
      {
        tempId: "temp-promoted",
        content: "promote this",
        deliveryState: "sending",
      },
    ]);
  });

  it("uses server queue order when a REST sync inserts an edited message", () => {
    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      result.current.addDeferredMessage({
        tempId: "temp-1",
        content: "first",
        timestamp: "2026-04-24T00:00:00.000Z",
      });
      result.current.addDeferredMessage({
        tempId: "temp-3",
        content: "third",
        timestamp: "2026-04-24T00:00:02.000Z",
      });
    });

    act(() => {
      result.current.syncDeferredMessages(
        [
          {
            tempId: "temp-1",
            content: "first",
            timestamp: "2026-04-24T00:00:00.000Z",
          },
          {
            tempId: "temp-2-edited",
            content: "second edited",
            timestamp: "2026-04-24T00:00:01.000Z",
          },
          {
            tempId: "temp-3",
            content: "third",
            timestamp: "2026-04-24T00:00:02.000Z",
          },
        ],
        {
          reason: "queued",
          tempId: "temp-2-edited",
          source: "rest",
        },
      );
    });

    expect(result.current.deferredMessages.map((message) => message.tempId)).toEqual(
      ["temp-1", "temp-2-edited", "temp-3"],
    );
  });

  it("preserves queued attachment metadata across server summaries", () => {
    const attachment = {
      id: "file-1",
      originalName: "notes.txt",
      name: "file-1-notes.txt",
      size: 12,
      mimeType: "text/plain",
      path: "/uploads/notes.txt",
    };

    const { result } = renderHook(() =>
      useSession(PROJECT_ID, "sess-1", {
        owner: "self",
        processId: "proc-1",
      }),
    );

    act(() => {
      result.current.addDeferredMessage({
        tempId: "temp-with-file",
        content: "see attached",
        timestamp: "2026-04-24T00:00:00.000Z",
        attachmentCount: 1,
        attachments: [attachment],
        mode: "acceptEdits",
      });
    });

    act(() => {
      sessionStreamHandler?.({
        eventType: "deferred-queue",
        messages: [
          {
            tempId: "temp-with-file",
            content: "see attached",
            timestamp: "2026-04-24T00:00:01.000Z",
          },
        ],
      });
    });

    expect(result.current.deferredMessages).toMatchObject([
      {
        tempId: "temp-with-file",
        content: "see attached",
        attachmentCount: 1,
        attachments: [attachment],
        mode: "acceptEdits",
        deliveryState: "queued",
      },
    ]);
  });
});
