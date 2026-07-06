// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_QUEUE_CAPABILITY } from "../../lib/projectQueueVisibility";
import { GlobalSessionsPage } from "../GlobalSessionsPage";

const {
  mockNavigate,
  mockSetNewSessionPrefill,
  globalSessionsState,
  mockLoadMore,
  mockUseProjectQueues,
  sessionCollectionState,
  versionState,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSetNewSessionPrefill: vi.fn(),
  mockLoadMore: vi.fn(),
  mockUseProjectQueues: vi.fn(),
  versionState: {
    version: { capabilities: [] as string[] } as {
      capabilities?: string[];
    },
  },
  sessionCollectionState: {
    records: [] as unknown[],
    queuedSessionIds: new Set<string>(),
  },
  globalSessionsState: {
    sessions: [] as unknown[],
    stats: {
      totalCount: 0,
      unreadCount: 0,
      starredCount: 0,
      archivedCount: 0,
      providerCounts: {},
      executorCounts: {},
    },
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        path: "/tmp/alpha",
        sessionCount: 3,
        lastActivity: "2026-04-21T00:00:00.000Z",
      },
    ],
    loading: false,
    error: null as Error | null,
    hasMore: false,
    loadMore: vi.fn(),
  },
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../api/client", () => ({
  api: {
    updateSessionMetadata: vi.fn(),
    markSessionSeen: vi.fn(),
    markSessionUnread: vi.fn(),
  },
}));

vi.mock("../../components/BulkActionBar", () => ({
  BulkActionBar: () => null,
}));

vi.mock("../../components/FilterDropdown", () => ({
  FilterDropdown: () => <div data-testid="filter-dropdown" />,
}));

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("../../components/SessionListItem", () => ({
  SessionListItem: ({
    sessionId,
    title,
    hasProjectQueue,
  }: {
    sessionId: string;
    title: string;
    hasProjectQueue?: boolean;
  }) => (
    <div data-testid={`session-${sessionId}`}>
      {title}
      {hasProjectQueue ? (
        <span data-testid={`project-queue-${sessionId}`}>Q</span>
      ) : null}
    </div>
  ),
}));

vi.mock("../../hooks/useGlobalSessionsFeed", () => ({
  useGlobalSessionsFeed: () => ({
    query: { scope: "global-sessions" },
    ...globalSessionsState,
  }),
}));

vi.mock("../../hooks/useProjectQueues", () => ({
  useProjectQueues: (projectIds: string[]) => {
    mockUseProjectQueues(projectIds);
    return {
      queuesByProject: {},
      items: [],
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
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY: "local",
  REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY: "remote:none",
  getCurrentClientSummarySourceKey: () => "host:test",
  setCurrentClientSummarySourceKey: vi.fn(),
  useClientSummarySourceKey: () => "host:test",
  useSessionCollectionQueryRecords: () => sessionCollectionState.records,
  useProjectQueuedSessionIds: () => sessionCollectionState.queuedSessionIds,
  useDraftSessionIds: () => new Set<string>(),
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: { publicSharesEnabled: false },
    isLoading: false,
    error: null,
    updateSettings: vi.fn(),
    updateSetting: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        sidebarNewSession: "New Session",
        globalSessionsTitle: "All Sessions",
        globalSessionsSearchPlaceholder: "Search sessions...",
        globalSessionsFilterAgePlaceholder: "Any age",
        globalSessionsClearFilters: "Clear filters",
        globalSessionsStatusAll: "All",
        globalSessionsFilterProjectPlaceholder: "All projects",
        globalSessionsFilterStatus: "Status",
        globalSessionsFilterProvider: "Provider",
        globalSessionsProviderAll: "All providers",
        globalSessionsFilterExecutor: "Machine",
        globalSessionsFilterAge: "Age",
        inboxFilterProject: "Project",
        globalSessionsFilterMachinePlaceholder: "All machines",
        globalSessionsAge3Days: "Older than 3 days",
        globalSessionsAge7Days: "Older than 7 days",
        globalSessionsAge14Days: "Older than 14 days",
        globalSessionsAge30Days: "Older than 30 days",
        globalSessionsProjectCtaHint: "Open session for",
        globalSessionsProjectCtaPromptLabel: "First prompt",
        globalSessionsNoResultsTitle: "No sessions found",
        globalSessionsNoResultsEmpty:
          "Sessions from all your projects will appear here.",
        globalSessionsNoResultsFiltered:
          "Try adjusting your filters or search query.",
        sidebarLoadingSessions: "Loading sessions...",
        projectsErrorPrefix: "Projects error:",
      };
      let text = messages[key] ?? key;
      if (!vars) return text;
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    },
  }),
}));

vi.mock("../../layouts", () => ({
  MainContent: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  useNavigationLayout: () => ({
    openSidebar: vi.fn(),
    isWideScreen: true,
    toggleSidebar: vi.fn(),
    isSidebarCollapsed: false,
  }),
}));

vi.mock("../../lib/newSessionPrefill", () => ({
  setNewSessionPrefill: mockSetNewSessionPrefill,
}));

function makeSessionRecord(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    title: `Session ${id}`,
    fullTitle: `Session ${id}`,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    messageCount: 1,
    provider: "claude",
    projectId: "project-1",
    projectName: "Alpha",
    ownership: { owner: "none" },
    isArchived: false,
    isStarred: false,
    observedAt: 1,
    ...overrides,
  };
}

describe("GlobalSessionsPage", () => {
  beforeEach(() => {
    globalSessionsState.sessions = [];
    sessionCollectionState.records = [];
    sessionCollectionState.queuedSessionIds = new Set<string>();
    globalSessionsState.projects = [
      {
        id: "project-1",
        name: "Alpha",
        path: "/tmp/alpha",
        sessionCount: 3,
        lastActivity: "2026-04-21T00:00:00.000Z",
      },
    ];
    globalSessionsState.loading = false;
    globalSessionsState.error = null;
    globalSessionsState.hasMore = false;
    globalSessionsState.loadMore = mockLoadMore;
    versionState.version = { capabilities: [PROJECT_QUEUE_CAPABILITY] };
    mockNavigate.mockReset();
    mockSetNewSessionPrefill.mockReset();
    mockLoadMore.mockReset();
    mockUseProjectQueues.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderPage(initialEntry: string) {
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/sessions" element={<GlobalSessionsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the project CTA when arriving from the projects list", () => {
    renderPage("/sessions?project=project-1&source=projects");

    expect(screen.getAllByText("New Session")[0]).toBeDefined();
    expect(screen.getAllByText("Alpha")).toHaveLength(2);
    expect(screen.getByText("Open session for")).toBeDefined();
    expect(screen.getByRole("button", { name: "New Session" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));

    expect(mockSetNewSessionPrefill).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/new-session?projectId=project-1",
    );
  });

  it("shows the project CTA for project-filtered views without a source hint", () => {
    renderPage("/sessions?project=project-1");

    expect(screen.getAllByText("New Session")[0]).toBeDefined();
    expect(screen.getAllByText("Alpha")).toHaveLength(2);
    expect(screen.getByText("Open session for")).toBeDefined();
    expect(screen.getByRole("button", { name: "New Session" })).toBeDefined();
  });

  it("prefills the new session from the active project search query", () => {
    renderPage("/sessions?project=project-1&q=fix%20login%20flow");

    expect(screen.getByText("First prompt")).toBeDefined();
    expect(screen.getByText("fix login flow")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));

    expect(mockSetNewSessionPrefill).toHaveBeenCalledWith(
      "host:test",
      "fix login flow",
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      "/new-session?projectId=project-1",
    );
  });

  it("renders sessions from collection query records", () => {
    globalSessionsState.sessions = [];
    sessionCollectionState.records = [
      makeSessionRecord("collection-only", {
        title: "Collection row",
        fullTitle: "Collection row",
      }),
    ];

    renderPage("/sessions");

    expect(screen.getByTestId("session-collection-only").textContent).toBe(
      "Collection row",
    );
  });

  it("marks sessions with project queue items from store decorations", () => {
    sessionCollectionState.records = [
      makeSessionRecord("queued-session", {
        title: "Queued row",
        fullTitle: "Queued row",
      }),
      makeSessionRecord("plain-session", {
        title: "Plain row",
        fullTitle: "Plain row",
      }),
    ];
    sessionCollectionState.queuedSessionIds = new Set(["queued-session"]);

    renderPage("/sessions");

    expect(mockUseProjectQueues).toHaveBeenCalledWith(["project-1"]);
    expect(screen.getByTestId("project-queue-queued-session")).toBeDefined();
    expect(screen.queryByTestId("project-queue-plain-session")).toBe(null);
  });

  it("hides project queue decorations without the server capability", () => {
    versionState.version = { capabilities: [] };
    sessionCollectionState.records = [
      makeSessionRecord("queued-session", {
        title: "Queued row",
        fullTitle: "Queued row",
      }),
    ];
    sessionCollectionState.queuedSessionIds = new Set(["queued-session"]);

    renderPage("/sessions");

    expect(mockUseProjectQueues).toHaveBeenCalledWith([]);
    expect(screen.queryByTestId("project-queue-queued-session")).toBe(null);
  });
});
