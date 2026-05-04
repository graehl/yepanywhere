import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionMessages } from "../useSessionMessages";

const apiMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: apiMocks,
}));

describe("useSessionMessages cache", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as { __YA_SESSION_LOAD_CACHE__?: unknown })
      .__YA_SESSION_LOAD_CACHE__;
  });

  it("reuses the warm session cache on remount and fetches only deltas", async () => {
    apiMocks.getSession.mockResolvedValue({
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

    expect(second.result.current.messages).toHaveLength(1);

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.getSession).toHaveBeenNthCalledWith(
      2,
      "proj-1",
      "sess-1",
      "msg-1",
      { tailCompactions: 2 },
    );
  });
});
