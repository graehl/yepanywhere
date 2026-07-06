// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxContent } from "../InboxContent";

const {
  draftSessionIds,
  inboxState,
  mockRefresh,
  mockUseProjectQueues,
  mockUseProjectQueuedSessionIds,
  projectQueueItems,
  queuedSessionIds,
  versionState,
} = vi.hoisted(() => ({
  draftSessionIds: new Set<string>(),
  queuedSessionIds: new Set<string>(),
  projectQueueItems: [] as Array<Record<string, unknown>>,
  mockRefresh: vi.fn(),
  mockUseProjectQueues: vi.fn(),
  mockUseProjectQueuedSessionIds: vi.fn(),
  versionState: {
    version: { capabilities: ["projectQueue"] as string[] } as {
      capabilities?: string[];
    },
  },
  inboxState: {
    needsAttention: [] as Array<Record<string, unknown>>,
    active: [] as Array<Record<string, unknown>>,
    recentActivity: [] as Array<Record<string, unknown>>,
    unread8h: [] as Array<Record<string, unknown>>,
    unread24h: [] as Array<Record<string, unknown>>,
    loading: false,
    error: null as Error | null,
  },
}));

vi.mock("../../contexts/InboxContext", () => ({
  useInboxContext: () => ({
    ...inboxState,
    inbox: {
      needsAttention: inboxState.needsAttention,
      active: inboxState.active,
      recentActivity: inboxState.recentActivity,
      unread8h: inboxState.unread8h,
      unread24h: inboxState.unread24h,
    },
    refresh: mockRefresh,
    refetch: mockRefresh,
    totalNeedsAttention: inboxState.needsAttention.length,
    totalActive: inboxState.active.length,
    totalItems:
      inboxState.needsAttention.length +
      inboxState.active.length +
      inboxState.recentActivity.length +
      inboxState.unread8h.length +
      inboxState.unread24h.length,
    enabled: true,
    setEnabled: vi.fn(),
  }),
}));

vi.mock("../../hooks/useProjectQueues", () => ({
  useProjectQueues: (projectIds: string[]) => {
    mockUseProjectQueues(projectIds);
    return {
      queuesByProject: {},
      items: projectQueueItems,
      projectStatusesByProject: {},
      recoveredSessionQueues: [],
      loading: false,
      error: null,
      mutatingItemId: null,
      mutatingDispatchState: false,
      mutatingPromoteItemId: null,
      dispatchState: { status: "running" },
      refetch: vi.fn(),
      pauseDispatch: vi.fn(),
      resumeDispatch: vi.fn(),
      promoteNow: vi.fn(),
      updateItem: vi.fn(),
      deleteItem: vi.fn(),
      retryItem: vi.fn(),
      moveItemToTop: vi.fn(),
    };
  },
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({ version: versionState.version }),
}));

vi.mock("../../lib/clientSummaryStore", () => ({
  useDraftSessionIds: () => draftSessionIds,
  useProjectQueuedSessionIds: (projectIds: string[]) => {
    mockUseProjectQueuedSessionIds(projectIds);
    return queuedSessionIds;
  },
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: { publicSharesEnabled: false },
  }),
}));

vi.mock("../../hooks/usePublicShareStatus", () => ({
  usePublicShareStatus: () => ({
    status: { canCreate: false },
  }),
}));

vi.mock("../FilterDropdown", () => ({
  FilterDropdown: () => <div data-testid="filter-dropdown" />,
}));

vi.mock("../SessionListItem", () => ({
  SessionListItem: ({
    activity,
    hasCustomTitle,
    hasDraft,
    hasProjectQueue,
    isStarred,
    sessionId,
    showActivityIndicator,
    title,
  }: {
    activity?: string;
    hasCustomTitle?: boolean;
    hasDraft?: boolean;
    hasProjectQueue?: boolean;
    isStarred?: boolean;
    sessionId: string;
    showActivityIndicator?: boolean;
    title: string;
  }) => (
    <li data-testid={`session-${sessionId}`}>
      {title}
      {showActivityIndicator && activity === "in-turn" ? (
        <span data-testid={`thinking-${sessionId}`}>Thinking</span>
      ) : null}
      {hasCustomTitle ? <span>Custom</span> : null}
      {isStarred ? <span>Star</span> : null}
      {hasDraft ? <span>Draft</span> : null}
      {hasProjectQueue ? <span>Q</span> : null}
    </li>
  ),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

function makeInboxItem(
  sessionId: string,
  projectId: string,
): Record<string, unknown> {
  return {
    sessionId,
    projectId,
    projectName: `Project ${projectId}`,
    sessionTitle: `Session ${sessionId}`,
    updatedAt: "2026-06-28T00:00:00.000Z",
    hasUnread: true,
  };
}

function makeProject(projectId: string) {
  return {
    id: projectId,
    path: `/tmp/${projectId}`,
    name: `Project ${projectId}`,
    sessionCount: 0,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
  };
}

function makeProjectQueueItem(
  itemId: string,
  projectId: string,
  messagePreview: string,
): Record<string, unknown> {
  return {
    id: itemId,
    projectId,
    target: { type: "new-session" },
    messagePreview,
    message: { text: messagePreview },
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    status: "queued",
    attachmentCount: 0,
  };
}

function renderInbox(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("InboxContent", () => {
  beforeEach(() => {
    inboxState.needsAttention = [];
    inboxState.active = [];
    inboxState.recentActivity = [];
    inboxState.unread8h = [];
    inboxState.unread24h = [];
    inboxState.loading = false;
    inboxState.error = null;
    projectQueueItems.length = 0;
    versionState.version = { capabilities: ["projectQueue"] };
    draftSessionIds.clear();
    queuedSessionIds.clear();
    mockRefresh.mockReset();
    mockUseProjectQueues.mockReset();
    mockUseProjectQueuedSessionIds.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("marks inbox rows with Project Queue items from store decorations", () => {
    inboxState.needsAttention = [
      makeInboxItem("queued-session", "project-1"),
      makeInboxItem("plain-session", "project-2"),
    ];
    draftSessionIds.add("plain-session");
    queuedSessionIds.add("queued-session");

    renderInbox(<InboxContent />);

    expect(mockUseProjectQueues).toHaveBeenCalledWith([
      "project-1",
      "project-2",
    ]);
    expect(mockUseProjectQueuedSessionIds).toHaveBeenCalledWith([
      "project-1",
      "project-2",
    ]);
    expect(screen.getByTestId("session-queued-session").textContent).toContain(
      "Q",
    );
    expect(screen.getByTestId("session-plain-session").textContent).toContain(
      "Draft",
    );
    expect(
      screen.getByTestId("session-plain-session").textContent,
    ).not.toContain("Q");
  });

  it("feeds only the visible filtered projects into queue decorations", () => {
    inboxState.needsAttention = [
      makeInboxItem("visible-session", "project-1"),
      makeInboxItem("hidden-session", "project-2"),
    ];

    renderInbox(<InboxContent projectId="project-1" />);

    expect(mockUseProjectQueues).toHaveBeenCalledWith(["project-1"]);
    expect(mockUseProjectQueuedSessionIds).toHaveBeenCalledWith(["project-1"]);
    expect(screen.getByTestId("session-visible-session")).toBeTruthy();
    expect(screen.queryByTestId("session-hidden-session")).toBe(null);
  });

  it("renders custom titles from inbox-only rows", () => {
    inboxState.needsAttention = [
      {
        ...makeInboxItem("renamed-session", "project-1"),
        sessionTitle: "Generated title",
        customTitle: "Renamed title",
      },
    ];

    renderInbox(<InboxContent />);

    expect(screen.getByTestId("session-renamed-session").textContent).toContain(
      "Renamed title",
    );
    expect(screen.getByTestId("session-renamed-session").textContent).toContain(
      "Custom",
    );
    expect(
      screen.getByTestId("session-renamed-session").textContent,
    ).not.toContain("Generated title");
  });

  it("passes starred state through to inbox rows", () => {
    inboxState.needsAttention = [
      {
        ...makeInboxItem("starred-session", "project-1"),
        isStarred: true,
      },
    ];

    renderInbox(<InboxContent />);

    expect(screen.getByTestId("session-starred-session").textContent).toContain(
      "Star",
    );
  });

  it("shows the active thinking indicator for real running inbox rows", () => {
    inboxState.active = [
      {
        ...makeInboxItem("running-session", "project-1"),
        activity: "in-turn",
      },
    ];

    renderInbox(<InboxContent />);

    expect(screen.getByTestId("thinking-running-session")).toBeTruthy();
  });

  it("hides the active thinking indicator for queue-only inbox rows", () => {
    inboxState.active = [
      {
        ...makeInboxItem("queued-session", "project-1"),
        activity: "in-turn",
        activityInferredFromInboxTier: true,
      },
    ];
    queuedSessionIds.add("queued-session");

    renderInbox(<InboxContent />);

    expect(screen.getByTestId("session-queued-session").textContent).toContain(
      "Q",
    );
    expect(screen.queryByTestId("thinking-queued-session")).toBe(null);
  });

  it("renders pending new-session Project Queue items in Active", () => {
    projectQueueItems.push(
      makeProjectQueueItem("queue-new-session", "project-1", "Build the docs"),
    );

    renderInbox(<InboxContent projects={[makeProject("project-1")]} />);

    expect(mockUseProjectQueues).toHaveBeenCalledWith(["project-1"]);
    expect(screen.getByText("Build the docs")).toBeTruthy();
    expect(screen.getByText("projectQueueTargetNewSession")).toBeTruthy();
    expect(screen.getByText("projectQueueStatusQueued")).toBeTruthy();

    const link = screen.getByRole("link", { name: /Build the docs/ });
    expect(link.getAttribute("href")).toBe(
      "/projects?queueItem=queue-new-session",
    );
  });

  it("hides project queue rows and decorations without the server capability", () => {
    versionState.version = { capabilities: [] };
    inboxState.needsAttention = [
      makeInboxItem("queued-session", "project-1"),
    ];
    queuedSessionIds.add("queued-session");
    projectQueueItems.push(
      makeProjectQueueItem("queue-new-session", "project-1", "Build the docs"),
    );

    renderInbox(<InboxContent projects={[makeProject("project-1")]} />);

    expect(mockUseProjectQueues).toHaveBeenCalledWith([]);
    expect(mockUseProjectQueuedSessionIds).toHaveBeenCalledWith([]);
    expect(
      screen.getByTestId("session-queued-session").textContent,
    ).not.toContain("Q");
    expect(screen.queryByText("Build the docs")).toBe(null);
  });
});
