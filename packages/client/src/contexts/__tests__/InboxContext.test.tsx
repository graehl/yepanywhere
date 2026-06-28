import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClientSummaryHostSourceKey,
  resetClientSummaryStoreForTests,
  setCurrentClientSummarySourceKey,
} from "../../lib/clientSummaryStore";
import {
  InboxProvider,
  type InboxResponse,
  useInboxContext,
} from "../InboxContext";

const { mockGetInbox, remoteState } = vi.hoisted(() => ({
  mockGetInbox: vi.fn<() => Promise<InboxResponse>>(),
  remoteState: {
    connection: null as { connection: object | null } | null,
  },
}));

vi.mock("../../api/client", () => ({
  api: {
    getInbox: mockGetInbox,
  },
}));

vi.mock("../../hooks/useFileActivity", () => ({
  useFileActivity: vi.fn(),
}));

vi.mock("../../lib/connection", () => ({
  isRemoteClient: () => true,
}));

vi.mock("../RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => remoteState.connection,
}));

function InboxConsumer() {
  const { error, loading, needsAttention, totalItems } = useInboxContext();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error?.message ?? ""}</span>
      <span data-testid="total">{String(totalItems)}</span>
      <span data-testid="needs">
        {needsAttention.map((item) => item.sessionTitle).join("|")}
      </span>
    </div>
  );
}

function emptyInbox(overrides: Partial<InboxResponse> = {}): InboxResponse {
  return {
    needsAttention: [],
    active: [],
    recentActivity: [],
    unread8h: [],
    unread24h: [],
    ...overrides,
  };
}

describe("InboxProvider", () => {
  beforeEach(() => {
    resetClientSummaryStoreForTests();
    mockGetInbox.mockReset();
    mockGetInbox.mockResolvedValue({
      needsAttention: [],
      active: [],
      recentActivity: [],
      unread8h: [],
      unread24h: [],
    });
    remoteState.connection = null;
    window.history.replaceState({}, "", "/inbox");
  });

  afterEach(() => {
    cleanup();
    remoteState.connection = null;
    vi.clearAllMocks();
    resetClientSummaryStoreForTests();
  });

  it("does not fetch before remote connection is ready", async () => {
    render(
      <InboxProvider>
        <InboxConsumer />
      </InboxProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockGetInbox).not.toHaveBeenCalled();
  });

  it("fetches once the remote connection becomes available", async () => {
    mockGetInbox.mockResolvedValue(
      emptyInbox({
        active: [
          {
            sessionId: "session-1",
            projectId: "project-1",
            projectName: "Project",
            sessionTitle: "Session 1",
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      }),
    );

    const view = render(
      <InboxProvider>
        <InboxConsumer />
      </InboxProvider>,
    );

    expect(mockGetInbox).not.toHaveBeenCalled();

    remoteState.connection = { connection: {} };
    view.rerender(
      <InboxProvider>
        <InboxConsumer />
      </InboxProvider>,
    );

    await waitFor(() => {
      expect(mockGetInbox).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(view.getByTestId("total").textContent).toBe("1");
    });
  });

  it("resets stable inbox ordering when the summary source changes", async () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");
    remoteState.connection = { connection: {} };
    mockGetInbox
      .mockResolvedValueOnce(
        emptyInbox({
          needsAttention: [
            {
              sessionId: "shared-session",
              projectId: "project-1",
              projectName: "Project",
              sessionTitle: "Mac shared",
              updatedAt: "2026-06-28T00:00:00.000Z",
            },
            {
              sessionId: "mac-other",
              projectId: "project-1",
              projectName: "Project",
              sessionTitle: "Mac other",
              updatedAt: "2026-06-28T00:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        emptyInbox({
          needsAttention: [
            {
              sessionId: "win-new",
              projectId: "project-1",
              projectName: "Project",
              sessionTitle: "Win new",
              updatedAt: "2026-06-28T00:00:00.000Z",
            },
            {
              sessionId: "shared-session",
              projectId: "project-1",
              projectName: "Project",
              sessionTitle: "Win shared",
              updatedAt: "2026-06-28T00:00:00.000Z",
            },
          ],
        }),
      );

    act(() => {
      setCurrentClientSummarySourceKey(macbook);
    });

    const view = render(
      <InboxProvider>
        <InboxConsumer />
      </InboxProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("needs").textContent).toBe(
        "Mac shared|Mac other",
      );
    });

    act(() => {
      setCurrentClientSummarySourceKey(winnative);
    });

    await waitFor(() => {
      expect(mockGetInbox).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(view.getByTestId("needs").textContent).toBe(
        "Win new|Win shared",
      );
    });
  });
});
