// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxContent } from "../InboxContent";

const {
  draftSessionIds,
  inboxState,
  mockRefresh,
  mockUseProjectQueues,
  mockUseProjectQueuedSessionIds,
  queuedSessionIds,
} = vi.hoisted(() => ({
  draftSessionIds: new Set<string>(),
  queuedSessionIds: new Set<string>(),
  mockRefresh: vi.fn(),
  mockUseProjectQueues: vi.fn(),
  mockUseProjectQueuedSessionIds: vi.fn(),
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

vi.mock("../../hooks/useDrafts", () => ({
  useDrafts: () => draftSessionIds,
}));

vi.mock("../../hooks/useProjectQueues", () => ({
  useProjectQueues: (projectIds: string[]) => {
    mockUseProjectQueues(projectIds);
    return {
      queuesByProject: {},
      items: [],
      loading: false,
      error: null,
      mutatingItemId: null,
      refetch: vi.fn(),
      updateItem: vi.fn(),
      deleteItem: vi.fn(),
      retryItem: vi.fn(),
    };
  },
}));

vi.mock("../../lib/clientSummaryStore", () => ({
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
    hasDraft,
    hasProjectQueue,
    sessionId,
    title,
  }: {
    hasDraft?: boolean;
    hasProjectQueue?: boolean;
    sessionId: string;
    title: string;
  }) => (
    <li data-testid={`session-${sessionId}`}>
      {title}
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

describe("InboxContent", () => {
  beforeEach(() => {
    inboxState.needsAttention = [];
    inboxState.active = [];
    inboxState.recentActivity = [];
    inboxState.unread8h = [];
    inboxState.unread24h = [];
    inboxState.loading = false;
    inboxState.error = null;
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

    render(<InboxContent />);

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

    render(<InboxContent projectId="project-1" />);

    expect(mockUseProjectQueues).toHaveBeenCalledWith(["project-1"]);
    expect(mockUseProjectQueuedSessionIds).toHaveBeenCalledWith(["project-1"]);
    expect(screen.getByTestId("session-visible-session")).toBeTruthy();
    expect(screen.queryByTestId("session-hidden-session")).toBe(null);
  });
});
