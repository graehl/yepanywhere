import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  __resetSessionLoadCacheForTest,
  useSessionMessages,
} from "../useSessionMessages";
import { __resetDeveloperModeForTest } from "../useDeveloperMode";
import {
  createClientSummaryHostSourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  resetClientSummaryStoreForTests,
  setCurrentClientSummarySourceKey,
} from "../../lib/clientSummaryStore";
import {
  selectSessionDetailAgentContent,
  selectSessionDetailMessages,
  selectSessionDetailToolUseToAgentEntries,
} from "../../lib/sessionDetail/selectors";
import { defaultSessionDetailStore } from "../../lib/sessionDetail/sessionDetailStore";
import { UI_KEYS } from "../../lib/storageKeys";
import type { SessionRouteScrollSnapshot } from "../../lib/sessionRouteSnapshots";
import type { Message } from "../../types";

const apiMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: apiMocks,
}));

vi.mock("../useStreamingEnabled", () => ({
  getStreamingEnabled: vi.fn(() => true),
}));

import { getStreamingEnabled } from "../useStreamingEnabled";

function enableSessionTranscriptCache() {
  window.localStorage.setItem(UI_KEYS.sessionTranscriptCache, "true");
}

function scrollSnapshot(): SessionRouteScrollSnapshot {
  return {
    atBottom: false,
    scrollTop: 120,
    scrollHeight: 480,
    clientHeight: 240,
    anchor: {
      id: "msg-1",
      topOffset: 16,
    },
    updatedAtMs: 42,
  };
}

function readStoreMessageIds(
  projectId = "proj-1",
  sessionId = "sess-1",
): string[] | undefined {
  return defaultSessionDetailStore
    .readSelected(
      {
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId,
        sessionId,
      },
      selectSessionDetailMessages,
    )
    ?.map((message) => message.uuid)
    .filter((uuid): uuid is string => typeof uuid === "string");
}

function readStoreAgentContent(projectId = "proj-1", sessionId = "sess-1") {
  return defaultSessionDetailStore.readSelected(
    {
      sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      projectId,
      sessionId,
    },
    selectSessionDetailAgentContent,
  );
}

function readStoreToolUseToAgent(projectId = "proj-1", sessionId = "sess-1") {
  const entries = defaultSessionDetailStore.readSelected(
    {
      sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      projectId,
      sessionId,
    },
    selectSessionDetailToolUseToAgentEntries,
  );
  return entries ? new Map(entries) : undefined;
}

function reactCrossUpdateErrorCalls(error: {
  mock: { calls: Array<readonly unknown[]> };
}) {
  return error.mock.calls.filter(
    ([message]) =>
      typeof message === "string" &&
      message.includes("Cannot update a component"),
  );
}

describe("useSessionMessages cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetDeveloperModeForTest();
    resetClientSummaryStoreForTests();
    __resetSessionLoadCacheForTest();
    (getStreamingEnabled as Mock).mockReturnValue(true);
  });

  afterEach(() => {
    // Unmount before resetting shared stores: this afterEach runs before
    // testing-library's auto-cleanup (vitest afterEach hooks are LIFO), and
    // resetting a store a still-mounted hook subscribes to is a state update
    // outside act().
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    __resetDeveloperModeForTest();
    __resetSessionLoadCacheForTest();
    resetClientSummaryStoreForTests();
  });

  it("hydrates retained session snapshots after an initial loading state", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
        {
          uuid: "msg-2",
          type: "assistant",
          timestamp: "2026-05-04T00:01:00.000Z",
          message: { role: "assistant", content: "hi" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 2,
        returnedMessageCount: 2,
        totalCompactions: 0,
      },
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.restoredFromSnapshot).toBe(false);
    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.messages).toEqual([]);
    expect(second.result.current.restoredFromSnapshot).toBe(true);
    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      "msg-1",
      { tailCompactions: 2 },
    );
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["msg-1", "msg-2"]);
    expect(readStoreMessageIds()).toEqual(["msg-1", "msg-2"]);
  });

  it("keeps store-backed warm messages gated until hydration", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    let resolveDelta!: (value: unknown) => void;
    apiMocks.getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelta = resolve;
      }),
    );

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.messages).toEqual([]);
    expect(readStoreMessageIds()).toEqual(["msg-1"]);

    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["msg-1"]);

    await act(async () => {
      resolveDelta({
        session: {
          provider: "claude",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
        messages: [],
        ownership: { owner: "self" },
        pendingInputRequest: null,
        slashCommands: null,
      });
      await apiMocks.getSession.mock.results[1]?.value;
    });
  });

  it("hides stale fallback mirrors across route changes before reveal", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "sess-1-msg",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "first" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    let rejectSecondLoad!: (error: Error) => void;
    const secondLoad = new Promise<never>((_, reject) => {
      rejectSecondLoad = reject;
    });
    apiMocks.getSession.mockReturnValueOnce(secondLoad);

    const rendered = renderHook(
      ({ sessionId }) =>
        useSessionMessages({
          projectId: "proj-1",
          sessionId,
        }),
      {
        initialProps: { sessionId: "sess-1" },
      },
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    expect(
      rendered.result.current.messages.map((message) => message.uuid),
    ).toEqual(["sess-1-msg"]);

    act(() => {
      rendered.rerender({ sessionId: "sess-2" });
    });

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(rendered.result.current.messages).toEqual([]);

    await act(async () => {
      rejectSecondLoad(new Error("load failed"));
      await secondLoad.catch(() => undefined);
    });

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    expect(rendered.result.current.messages).toEqual([]);
  });

  it("mirrors active loads into the session detail store without retaining when cache is disabled", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    expect(rendered.result.current.pagination?.totalMessageCount).toBe(1);

    const storeKey = {
      sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      projectId: "proj-1",
      sessionId: "sess-1",
    };
    expect(
      defaultSessionDetailStore
        .read(storeKey)
        ?.messages.map((message) => message.uuid),
    ).toEqual(["msg-1"]);

    rendered.unmount();

    expect(defaultSessionDetailStore.read(storeKey)).toBeUndefined();
  });

  it("retains the mounted session's store entry against eviction", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    expect(defaultSessionDetailStore.getStats().retainedEntryCount).toBe(1);

    // A TTL sweep far in the future must not evict the mounted entry.
    expect(
      defaultSessionDetailStore.evictExpired({
        nowMs: Date.now() + 60 * 60 * 1000,
      }),
    ).toBe(0);
    expect(readStoreMessageIds()).toEqual(["msg-1"]);

    rendered.unmount();
    expect(defaultSessionDetailStore.getStats().retainedEntryCount).toBe(0);
  });

  it("returns store-selected messages", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:01:00.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });

    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "store-only-msg"]),
    );
  });

  it("returns empty transcript surfaces when store data is missing after reveal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    expect(
      rendered.result.current.messages.map((message) => message.uuid),
    ).toEqual(["msg-1"]);

    act(() => {
      defaultSessionDetailStore.deleteEntry({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      });
    });

    await waitFor(() => expect(rendered.result.current.messages).toEqual([]));
    expect(rendered.result.current.agentContent).toEqual({});
    expect(rendered.result.current.toolUseToAgent.size).toBe(0);
    expect(
      warn.mock.calls.some(
        ([label, payload]) =>
          label === "[SessionDetailStore]" &&
          typeof payload === "object" &&
          payload !== null &&
          "event" in payload &&
          payload.event === "session-detail-store-missing-after-reveal",
      ),
    ).toBe(true);

    warn.mockRestore();
  });

  it("returns store-selected agent content", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    const storeOnlyMessage: Message = {
      uuid: "agent-store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store only" },
    };

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "mergeLoadedAgentContent",
          agentId: "task-store",
          content: {
            messages: [storeOnlyMessage],
            status: "completed",
          },
        },
      );
    });

    await waitFor(() =>
      expect(rendered.result.current.agentContent["task-store"]).toEqual({
        messages: [storeOnlyMessage],
        status: "completed",
      }),
    );
  });

  it("returns store-selected tool-use mappings", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "registerToolUseAgent",
          toolUseId: "toolu_store",
          agentId: "agent-store",
        },
      );
    });

    await waitFor(() =>
      expect(rendered.result.current.toolUseToAgent.get("toolu_store")).toBe(
        "agent-store",
      ),
    );
  });

  it("keeps returned store-backed data coherent across message and subagent transitions", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      rendered.result.current.handleStreamingUpdate({
        uuid: "streaming-1",
        type: "assistant",
        timestamp: "2026-05-04T00:00:30.000Z",
        _isStreaming: true,
        message: { role: "assistant", content: "streaming" },
      });
    });

    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "streaming-1"]),
    );
    expect(readStoreMessageIds()).toEqual(["msg-1", "streaming-1"]);

    act(() => {
      rendered.result.current.clearStreamingPlaceholders();
    });

    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1"]),
    );
    expect(readStoreMessageIds()).toEqual(["msg-1"]);

    const subagentStreamMessage: Message = {
      uuid: "agent-stream-1",
      type: "assistant",
      timestamp: "2026-05-04T00:01:00.000Z",
      message: { role: "assistant", content: "agent stream" },
    };

    act(() => {
      rendered.result.current.handleStreamSubagentMessage(
        subagentStreamMessage,
        "task-1",
      );
    });

    await waitFor(() =>
      expect(rendered.result.current.agentContent["task-1"]).toEqual({
        messages: [subagentStreamMessage],
        status: "running",
      }),
    );
    expect(readStoreAgentContent()?.["task-1"]).toEqual({
      messages: [subagentStreamMessage],
      status: "running",
    });

    const loadedSubagentMessage: Message = {
      uuid: "agent-loaded-1",
      type: "assistant",
      timestamp: "2026-05-04T00:02:00.000Z",
      message: { role: "assistant", content: "agent loaded" },
    };

    act(() => {
      rendered.result.current.mergeLoadedAgentContent("task-1", {
        messages: [loadedSubagentMessage],
        status: "completed",
      });
    });

    await waitFor(() =>
      expect(rendered.result.current.agentContent["task-1"]).toEqual({
        messages: [loadedSubagentMessage, subagentStreamMessage],
        status: "running",
      }),
    );
    expect(readStoreAgentContent()?.["task-1"]).toEqual({
      messages: [loadedSubagentMessage, subagentStreamMessage],
      status: "running",
    });

    act(() => {
      rendered.result.current.registerToolUseAgent("toolu_1", "task-1");
    });

    await waitFor(() =>
      expect(rendered.result.current.toolUseToAgent.get("toolu_1")).toBe(
        "task-1",
      ),
    );
  });

  it("mirrors tool-use mappings from the session detail store after registration", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "registerToolUseAgent",
          toolUseId: "toolu_store",
          agentId: "agent-store",
        },
      );
      rendered.result.current.registerToolUseAgent("toolu_hook", "agent-hook");
    });

    expect(
      Array.from(rendered.result.current.toolUseToAgent.entries()),
    ).toEqual([
      ["toolu_store", "agent-store"],
      ["toolu_hook", "agent-hook"],
    ]);
    expect(Array.from(readStoreToolUseToAgent()?.entries() ?? [])).toEqual([
      ["toolu_store", "agent-store"],
      ["toolu_hook", "agent-hook"],
    ]);
  });

  it("keeps store-backed warm agent content gated until hydration", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });
    let resolveDelta!: (value: unknown) => void;
    apiMocks.getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelta = resolve;
      }),
    );

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const warmMessage: Message = {
      uuid: "agent-warm-1",
      type: "assistant",
      message: { role: "assistant", content: "warm" },
    };
    act(() => {
      first.result.current.mergeLoadedAgentContent("task-warm", {
        messages: [warmMessage],
        status: "completed",
      });
    });
    await waitFor(() =>
      expect(first.result.current.agentContent["task-warm"]).toEqual({
        messages: [warmMessage],
        status: "completed",
      }),
    );
    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.agentContent).toEqual({});
    expect(readStoreAgentContent()?.["task-warm"]).toEqual({
      messages: [warmMessage],
      status: "completed",
    });

    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.agentContent["task-warm"]).toEqual({
      messages: [warmMessage],
      status: "completed",
    });

    await act(async () => {
      resolveDelta({
        session: {
          provider: "codex",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
        messages: [],
        ownership: { owner: "self" },
        pendingInputRequest: null,
        slashCommands: null,
      });
      await apiMocks.getSession.mock.results[1]?.value;
    });
  });

  it("keeps store-selected messages authoritative across stream events", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });
    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "store-only-msg"]),
    );

    act(() => {
      rendered.result.current.handleStreamMessageEvent({
        uuid: "stream-msg",
        type: "assistant",
        timestamp: "2026-05-04T00:01:00.000Z",
        message: { role: "assistant", content: "stream update" },
      });
    });

    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "store-only-msg", "stream-msg"]),
    );
    expect(readStoreMessageIds()).toEqual([
      "msg-1",
      "store-only-msg",
      "stream-msg",
    ]);
  });

  it("mirrors main stream messages from the session detail store after stream events", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });
    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "store-only-msg"]),
    );

    act(() => {
      rendered.result.current.handleStreamMessageEvent({
        uuid: "stream-msg",
        type: "assistant",
        timestamp: "2026-05-04T00:01:00.000Z",
        message: { role: "assistant", content: "stream update" },
      });
    });

    expect(
      rendered.result.current.messages.map((message) => message.uuid),
    ).toEqual(["msg-1", "store-only-msg", "stream-msg"]);
    expect(readStoreMessageIds()).toEqual([
      "msg-1",
      "store-only-msg",
      "stream-msg",
    ]);
  });

  it("keeps store-selected messages authoritative across catch-up", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });
    await waitFor(() =>
      expect(result.current.messages.map((message) => message.uuid)).toEqual([
        "msg-1",
        "store-only-msg",
      ]),
    );

    apiMocks.getSession.mockClear();
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [
        {
          uuid: "msg-2",
          type: "assistant",
          timestamp: "2026-05-04T00:01:00.000Z",
          message: { role: "assistant", content: "hi" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });

    await act(async () => {
      await result.current.fetchNewMessages();
    });

    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "proj-1",
      "sess-1",
      "msg-1",
    );
    expect(result.current.messages.map((message) => message.uuid)).toEqual([
      "msg-1",
      "store-only-msg",
      "msg-2",
    ]);
    expect(readStoreMessageIds()).toEqual(["msg-1", "store-only-msg", "msg-2"]);
    expect(reactCrossUpdateErrorCalls(error)).toHaveLength(0);
  });

  it("keeps store-selected messages authoritative across older-page prepend", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: true,
        truncatedBeforeMessageId: "msg-1",
        totalMessageCount: 2,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-03T23:59:00.000Z",
      },
      messages: [
        {
          uuid: "older-msg",
          type: "assistant",
          timestamp: "2026-05-03T23:59:00.000Z",
          message: { role: "assistant", content: "before" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 3,
        returnedMessageCount: 3,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });
    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "store-only-msg"]),
    );

    await act(async () => {
      await rendered.result.current.loadOlderMessages();
    });

    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      undefined,
      {
        tailCompactions: 2,
        beforeMessageId: "msg-1",
      },
    );
    expect(
      rendered.result.current.messages.map((message) => message.uuid),
    ).toEqual(["older-msg", "msg-1", "store-only-msg"]);
    expect(readStoreMessageIds()).toEqual([
      "older-msg",
      "msg-1",
      "store-only-msg",
    ]);
  });

  it("returns retained scroll snapshots through the store selector", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const retainedScroll = scrollSnapshot();
    act(() => {
      first.result.current.updateRouteScrollSnapshot(retainedScroll);
    });
    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.restoredFromSnapshot).toBe(true);
    expect(second.result.current.initialScrollSnapshot).toEqual(retainedScroll);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
  });

  it("reuses the warm session cache before a slow delta fetch resolves", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    let resolveDelta!: (value: unknown) => void;
    apiMocks.getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelta = resolve;
      }),
    );

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      1,
      "proj-1",
      "sess-1",
      undefined,
      { tailCompactions: 2 },
    );

    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.messages).toEqual([]);
    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });
    expect(second.result.current.messages).toEqual([]);
    expect(readStoreMessageIds()).toEqual(["msg-1", "store-only-msg"]);

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      "msg-1",
      { tailCompactions: 2 },
    );

    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["msg-1", "store-only-msg"]);

    await act(async () => {
      resolveDelta({
        session: {
          provider: "claude",
          updatedAt: "2026-05-04T00:01:00.000Z",
        },
        messages: [
          {
            uuid: "msg-2",
            type: "assistant",
            timestamp: "2026-05-04T00:01:00.000Z",
            message: { role: "assistant", content: "hi" },
          },
        ],
        ownership: { owner: "self" },
        pendingInputRequest: null,
        slashCommands: null,
      });
      await apiMocks.getSession.mock.results[1]?.value;
    });

    await waitFor(() => expect(second.result.current.messages).toHaveLength(3));
    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["msg-1", "store-only-msg", "msg-2"]);
    expect(readStoreMessageIds()).toEqual(["msg-1", "store-only-msg", "msg-2"]);
    expect(second.result.current.pagination?.totalMessageCount).toBe(1);
  });

  it("does not reuse warm cached messages across summary sources", async () => {
    enableSessionTranscriptCache();

    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "mac-msg",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "mac" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [
        {
          uuid: "win-msg",
          type: "user",
          timestamp: "2026-05-04T00:01:00.000Z",
          message: { role: "user", content: "win" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(
      first.result.current.messages.map((message) => message.uuid),
    ).toEqual(["mac-msg"]);
    first.unmount();

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.messages).toEqual([]);
    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["win-msg"]);
    second.unmount();
  });

  it("does not restore retained messages when transcript cache is disabled", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-07-01T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-07-01T00:01:00.000Z",
      },
      messages: [
        {
          uuid: "fresh-msg",
          type: "assistant",
          timestamp: "2026-07-01T00:01:00.000Z",
          message: { role: "assistant", content: "fresh" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    window.localStorage.setItem(UI_KEYS.sessionTranscriptCache, "false");

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.restoredFromSnapshot).toBe(false);
    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      undefined,
      { tailCompactions: 2 },
    );
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["fresh-msg"]);
  });

  it("does not use durable recap overlays as warm-cache cursors", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "assistant",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "assistant", content: "work" },
        },
        {
          uuid: "recap-1",
          id: "recap-1",
          type: "system",
          subtype: "away_summary",
          timestamp: "2026-05-04T00:01:00.000Z",
          content: "Recap overlay.",
          yaRecapSource: "ya-synthetic",
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 2,
        returnedMessageCount: 2,
        totalCompactions: 0,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      "msg-1",
      { tailCompactions: 2 },
    );
  });

  it("keeps warm cached messages when an incremental refresh has no delta", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: true,
        truncatedBeforeMessageId: "older-msg",
        totalMessageCount: 10,
        returnedMessageCount: 1,
        totalCompactions: 2,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.messages).toEqual([]);

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        second.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1"]),
    );
    expect(second.result.current.pagination?.truncatedBeforeMessageId).toBe(
      "older-msg",
    );
    expect(readStoreMessageIds()).toEqual(["msg-1"]);
  });

  it("keeps store-backed warm full-window data coherent when refresh returns a compacted tail", async () => {
    enableSessionTranscriptCache();

    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:02:00.000Z",
      },
      messages: [
        {
          uuid: "older-msg",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "older" },
        },
        {
          uuid: "tail-msg-1",
          type: "assistant",
          timestamp: "2026-05-04T00:01:00.000Z",
          message: { role: "assistant", content: "tail one" },
        },
        {
          uuid: "tail-msg-2",
          type: "assistant",
          timestamp: "2026-05-04T00:02:00.000Z",
          message: { role: "assistant", content: "tail two" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 3,
        returnedMessageCount: 3,
        totalCompactions: 2,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:03:00.000Z",
      },
      messages: [
        {
          uuid: "tail-msg-1",
          type: "assistant",
          timestamp: "2026-05-04T00:01:00.000Z",
          message: { role: "assistant", content: "tail one" },
        },
        {
          uuid: "tail-msg-2",
          type: "assistant",
          timestamp: "2026-05-04T00:02:00.000Z",
          message: { role: "assistant", content: "tail two" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: true,
        truncatedBeforeMessageId: "tail-msg-1",
        totalMessageCount: 3,
        returnedMessageCount: 2,
        totalCompactions: 2,
      },
    });

    const first = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(
      first.result.current.messages.map((message) => message.uuid),
    ).toEqual(["older-msg", "tail-msg-1", "tail-msg-2"]);
    first.unmount();

    const second = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.messages).toEqual([]);
    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      "tail-msg-2",
      { tailCompactions: 2 },
    );
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(
      second.result.current.messages.map((message) => message.uuid),
    ).toEqual(["older-msg", "tail-msg-1", "tail-msg-2"]);
    expect(readStoreMessageIds()).toEqual([
      "older-msg",
      "tail-msg-1",
      "tail-msg-2",
    ]);
    expect(second.result.current.pagination).toMatchObject({
      hasOlderMessages: false,
      totalMessageCount: 3,
      returnedMessageCount: 3,
    });
    expect(
      second.result.current.pagination?.truncatedBeforeMessageId,
    ).toBeUndefined();
  });

  it("uses selector-backed pagination when loading older messages", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: true,
        truncatedBeforeMessageId: "msg-1",
        totalMessageCount: 2,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "older-msg",
          type: "assistant",
          timestamp: "2026-05-03T23:59:00.000Z",
          message: { role: "assistant", content: "before" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 2,
        returnedMessageCount: 2,
        totalCompactions: 0,
      },
    });

    const rendered = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    expect(rendered.result.current.pagination?.hasOlderMessages).toBe(true);
    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyCatchupMessages",
          messages: [],
          pagination: {
            hasOlderMessages: true,
            truncatedBeforeMessageId: "store-cursor",
            totalMessageCount: 3,
            returnedMessageCount: 2,
            totalCompactions: 0,
          },
        },
      );
    });
    await waitFor(() =>
      expect(
        rendered.result.current.messages.map((message) => message.uuid),
      ).toEqual(["msg-1", "store-only-msg"]),
    );

    await act(async () => {
      await rendered.result.current.loadOlderMessages();
    });

    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      undefined,
      {
        tailCompactions: 2,
        beforeMessageId: "store-cursor",
      },
    );
    expect(
      rendered.result.current.messages.map((message) => message.uuid),
    ).toEqual(["older-msg", "msg-1", "store-only-msg"]);
    expect(readStoreMessageIds()).toEqual([
      "older-msg",
      "msg-1",
      "store-only-msg",
    ]);
    expect(rendered.result.current.pagination?.hasOlderMessages).toBe(false);
    expect(rendered.result.current.pagination?.returnedMessageCount).toBe(2);
  });

  it("mirrors incremental catch-up messages into the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: {
            uuid: "store-only-msg",
            type: "assistant",
            timestamp: "2026-05-04T00:00:30.000Z",
            message: { role: "assistant", content: "store update" },
          },
        },
      );
    });
    await waitFor(() =>
      expect(result.current.messages.map((message) => message.uuid)).toEqual([
        "msg-1",
        "store-only-msg",
      ]),
    );

    apiMocks.getSession.mockClear();
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:01:00.000Z",
      },
      messages: [
        {
          uuid: "msg-2",
          type: "assistant",
          timestamp: "2026-05-04T00:01:00.000Z",
          message: { role: "assistant", content: "hi" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
    });

    await act(async () => {
      await result.current.fetchNewMessages();
    });

    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "proj-1",
      "sess-1",
      "msg-1",
    );
    expect(result.current.messages.map((message) => message.uuid)).toEqual([
      "msg-1",
      "store-only-msg",
      "msg-2",
    ]);
    expect(readStoreMessageIds()).toEqual(["msg-1", "store-only-msg", "msg-2"]);
  });

  it("coalesces concurrent incremental refreshes", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "claude",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "msg-1",
          type: "user",
          timestamp: "2026-05-04T00:00:00.000Z",
          message: { role: "user", content: "hello" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    apiMocks.getSession.mockClear();
    let resolveRefresh!: (value: unknown) => void;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    apiMocks.getSession.mockReturnValueOnce(refreshPromise);

    const first = result.current.fetchNewMessages();
    const second = result.current.fetchNewMessages();

    expect(second).toBe(first);
    expect(apiMocks.getSession).toHaveBeenCalledTimes(1);
    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "proj-1",
      "sess-1",
      "msg-1",
    );

    await act(async () => {
      resolveRefresh({
        session: {
          provider: "claude",
          updatedAt: "2026-05-04T00:01:00.000Z",
        },
        messages: [],
        ownership: { owner: "self" },
        pendingInputRequest: null,
        slashCommands: null,
      });
      await Promise.all([first, second]);
    });

    expect(apiMocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("suppresses Codex live streaming messages when response streaming is disabled", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleStreamMessageEvent({
        uuid: "codex-item-1",
        type: "assistant",
        _isStreaming: true,
        message: { role: "assistant", content: "Hel" },
      });
    });
    expect(result.current.messages).toHaveLength(1);

    (getStreamingEnabled as Mock).mockReturnValue(false);

    act(() => {
      result.current.handleStreamMessageEvent({
        uuid: "codex-item-1",
        type: "assistant",
        _isStreaming: true,
        message: { role: "assistant", content: "Hello" },
      });
    });
    expect(result.current.messages).toEqual([]);

    act(() => {
      result.current.handleStreamMessageEvent({
        uuid: "codex-item-1",
        type: "assistant",
        message: { role: "assistant", content: "Hello" },
      });
    });

    expect(result.current.messages).toMatchObject([
      {
        uuid: "codex-item-1",
        type: "assistant",
        message: { content: "Hello" },
      },
    ]);
  });

  it("suppresses buffered Codex live streaming messages when response streaming is disabled", async () => {
    (getStreamingEnabled as Mock).mockReturnValue(false);

    let resolveLoad!: (value: unknown) => void;
    apiMocks.getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    act(() => {
      result.current.handleStreamMessageEvent({
        uuid: "codex-buffered-1",
        type: "assistant",
        _isStreaming: true,
        message: { role: "assistant", content: "partial" },
      });
    });

    await act(async () => {
      resolveLoad({
        session: {
          provider: "codex",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
        messages: [],
        ownership: { owner: "self" },
        pendingInputRequest: null,
        slashCommands: null,
        pagination: {
          hasOlderMessages: false,
          totalMessageCount: 0,
          returnedMessageCount: 0,
          totalCompactions: 0,
        },
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toEqual([]);
  });

  it("suppresses Codex subagent live streaming messages when response streaming is disabled", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleStreamSubagentMessage(
        {
          uuid: "codex-subagent-1",
          type: "assistant",
          _isStreaming: true,
          message: { role: "assistant", content: "partial" },
        },
        "task-1",
      );
    });
    expect(result.current.agentContent["task-1"]?.messages).toHaveLength(1);

    (getStreamingEnabled as Mock).mockReturnValue(false);

    act(() => {
      result.current.handleStreamSubagentMessage(
        {
          uuid: "codex-subagent-1",
          type: "assistant",
          _isStreaming: true,
          message: { role: "assistant", content: "partial done" },
        },
        "task-1",
      );
    });

    expect(result.current.agentContent).toEqual({});

    act(() => {
      result.current.handleStreamSubagentMessage(
        {
          uuid: "codex-subagent-1",
          type: "assistant",
          message: { role: "assistant", content: "done" },
        },
        "task-1",
      );
    });

    expect(result.current.agentContent["task-1"]?.messages).toMatchObject([
      {
        uuid: "codex-subagent-1",
        message: { content: "done" },
      },
    ]);
  });

  it("mirrors subagent stream events from the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const storeOnlyMessage: Message = {
      uuid: "agent-store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store only" },
    };
    const streamMessage: Message = {
      uuid: "agent-stream-1",
      type: "assistant",
      message: { role: "assistant", content: "stream" },
    };

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "mergeLoadedAgentContent",
          agentId: "task-store",
          content: {
            messages: [storeOnlyMessage],
            status: "completed",
          },
        },
      );
      result.current.handleStreamSubagentMessage(streamMessage, "task-1");
    });

    expect(result.current.agentContent["task-store"]).toEqual({
      messages: [storeOnlyMessage],
      status: "completed",
    });
    expect(result.current.agentContent["task-1"]).toEqual({
      messages: [streamMessage],
      status: "running",
    });
    expect(
      defaultSessionDetailStore.read({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      })?.agentContent,
    ).toMatchObject({
      "task-1": {
        messages: [streamMessage],
        status: "running",
      },
      "task-store": {
        messages: [storeOnlyMessage],
        status: "completed",
      },
    });
  });

  it("upserts main streaming placeholders through the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const first: Message = {
      uuid: "streaming-1",
      type: "assistant",
      _isStreaming: true,
      message: { role: "assistant", content: "partial" },
    };
    const updated: Message = {
      ...first,
      message: { role: "assistant", content: "partial done" },
    };
    const storeOnlyMessage: Message = {
      uuid: "store-only-1",
      type: "user",
      message: { role: "user", content: "store-only" },
    };

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: storeOnlyMessage,
        },
      );
      result.current.handleStreamingUpdate(first);
      result.current.handleStreamingUpdate(updated);
    });

    expect(result.current.messages.map((message) => message.uuid)).toEqual([
      "store-only-1",
      "streaming-1",
    ]);
    expect(result.current.messages[0]?._source).toBe("sdk");
    expect(result.current.messages[1]).toEqual(updated);
    expect(
      defaultSessionDetailStore
        .read({
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        })
        ?.messages.map((message) => message.uuid),
    ).toEqual(["store-only-1", "streaming-1"]);
  });

  it("clears main streaming placeholders through the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [
        {
          uuid: "durable-1",
          type: "assistant",
          message: { role: "assistant", content: "done" },
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const streaming: Message = {
      uuid: "streaming-1",
      type: "assistant",
      _isStreaming: true,
      message: { role: "assistant", content: "partial" },
    };
    const storeOnlyMessage: Message = {
      uuid: "store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store-only" },
    };

    act(() => {
      result.current.handleStreamingUpdate(streaming);
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "applyStreamMessage",
          message: storeOnlyMessage,
        },
      );
      result.current.clearStreamingPlaceholders();
    });

    expect(result.current.messages.map((message) => message.uuid)).toEqual([
      "durable-1",
      "store-only-1",
    ]);
    expect(
      defaultSessionDetailStore
        .read({
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        })
        ?.messages.map((message) => message.uuid),
    ).toEqual(["durable-1", "store-only-1"]);
  });

  it("updates session metadata through the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        id: "sess-1",
        projectId: "proj-1",
        provider: "codex",
        title: "Before",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateSession((previous) =>
        previous
          ? {
              ...previous,
              title: "After",
              model: "gpt-5.4",
            }
          : previous,
      );
    });

    expect(result.current.session).toMatchObject({
      title: "After",
      model: "gpt-5.4",
    });
    expect(
      defaultSessionDetailStore.read({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      })?.session,
    ).toMatchObject({
      title: "After",
      model: "gpt-5.4",
    });
  });

  it("mirrors loaded subagent content from the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const loadedMessage: Message = {
      uuid: "agent-loaded-1",
      type: "assistant",
      message: { role: "assistant", content: "loaded" },
    };
    const storeOnlyMessage: Message = {
      uuid: "agent-store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store only" },
    };

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "mergeLoadedAgentContent",
          agentId: "task-store",
          content: {
            messages: [storeOnlyMessage],
            status: "completed",
          },
        },
      );
      result.current.mergeLoadedAgentContent("task-1", {
        messages: [loadedMessage],
        status: "completed",
      });
    });

    expect(result.current.agentContent["task-store"]).toEqual({
      messages: [storeOnlyMessage],
      status: "completed",
    });
    expect(result.current.agentContent["task-1"]).toEqual({
      messages: [loadedMessage],
      status: "completed",
    });
    expect(
      defaultSessionDetailStore.read({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      })?.agentContent,
    ).toMatchObject({
      "task-1": {
        messages: [loadedMessage],
        status: "completed",
      },
      "task-store": {
        messages: [storeOnlyMessage],
        status: "completed",
      },
    });
  });

  it("mirrors agent context usage from the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const contextUsage = { inputTokens: 1200, percentage: 24 };
    const storeOnlyMessage: Message = {
      uuid: "agent-store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store only" },
    };

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "mergeLoadedAgentContent",
          agentId: "task-store",
          content: {
            messages: [storeOnlyMessage],
            status: "completed",
          },
        },
      );
      result.current.updateAgentContextUsage("task-1", contextUsage);
    });

    expect(result.current.agentContent["task-store"]).toEqual({
      messages: [storeOnlyMessage],
      status: "completed",
    });
    expect(result.current.agentContent["task-1"]).toEqual({
      messages: [],
      status: "running",
      contextUsage,
    });
    expect(
      defaultSessionDetailStore.read({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      })?.agentContent,
    ).toMatchObject({
      "task-1": {
        messages: [],
        status: "running",
        contextUsage,
      },
      "task-store": {
        messages: [storeOnlyMessage],
        status: "completed",
      },
    });
  });

  it("upserts subagent streaming placeholders through the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const first: Message = {
      uuid: "agent-streaming-1",
      type: "assistant",
      _isStreaming: true,
      message: { role: "assistant", content: "partial" },
    };
    const updated: Message = {
      ...first,
      message: { role: "assistant", content: "partial done" },
    };
    const storeOnlyMessage: Message = {
      uuid: "agent-store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store only" },
    };

    act(() => {
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "mergeLoadedAgentContent",
          agentId: "task-store",
          content: {
            messages: [storeOnlyMessage],
            status: "completed",
          },
        },
      );
      result.current.handleStreamingUpdate(first, "task-1");
      result.current.handleStreamingUpdate(updated, "task-1");
    });

    expect(result.current.agentContent["task-store"]).toEqual({
      messages: [storeOnlyMessage],
      status: "completed",
    });
    expect(result.current.agentContent["task-1"]).toEqual({
      messages: [updated],
      status: "running",
    });
    expect(
      defaultSessionDetailStore.read({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      })?.agentContent["task-1"],
    ).toEqual({
      messages: [updated],
      status: "running",
    });
  });

  it("clears subagent streaming placeholders through the session detail store", async () => {
    apiMocks.getSession.mockResolvedValueOnce({
      session: {
        provider: "codex",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      messages: [],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      slashCommands: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 0,
        returnedMessageCount: 0,
        totalCompactions: 0,
      },
    });

    const { result } = renderHook(() =>
      useSessionMessages({
        projectId: "proj-1",
        sessionId: "sess-1",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const durableMessage: Message = {
      uuid: "agent-durable-1",
      type: "assistant",
      message: { role: "assistant", content: "done" },
    };
    const streamingMessage: Message = {
      uuid: "agent-streaming-1",
      type: "assistant",
      _isStreaming: true,
      message: { role: "assistant", content: "partial" },
    };
    const storeOnlyMessage: Message = {
      uuid: "agent-store-only-1",
      type: "assistant",
      message: { role: "assistant", content: "store only" },
    };

    act(() => {
      result.current.mergeLoadedAgentContent("task-1", {
        messages: [durableMessage, streamingMessage],
        status: "running",
      });
      defaultSessionDetailStore.dispatch(
        {
          sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
          projectId: "proj-1",
          sessionId: "sess-1",
        },
        {
          type: "mergeLoadedAgentContent",
          agentId: "task-store",
          content: {
            messages: [storeOnlyMessage],
            status: "completed",
          },
        },
      );
      result.current.clearAgentStreamingPlaceholders("task-1");
    });

    expect(result.current.agentContent["task-store"]).toEqual({
      messages: [storeOnlyMessage],
      status: "completed",
    });
    expect(result.current.agentContent["task-1"]).toEqual({
      messages: [durableMessage],
      status: "running",
    });
    expect(
      defaultSessionDetailStore.read({
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        projectId: "proj-1",
        sessionId: "sess-1",
      })?.agentContent,
    ).toMatchObject({
      "task-1": {
        messages: [durableMessage],
        status: "running",
      },
      "task-store": {
        messages: [storeOnlyMessage],
        status: "completed",
      },
    });
  });
});
