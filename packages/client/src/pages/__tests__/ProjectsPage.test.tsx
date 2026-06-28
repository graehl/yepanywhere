// @vitest-environment jsdom

import type { ProjectQueueItemSummary } from "@yep-anywhere/shared";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ProjectsPage } from "../ProjectsPage";

const state = vi.hoisted(() => ({
  projects: [
    {
      id: "project-1",
      name: "Alpha",
      path: "/tmp/alpha",
      sessionCount: 2,
      activeOwnedCount: 0,
      activeExternalCount: 0,
      lastActivity: null,
    },
  ],
  queueItems: [] as ProjectQueueItemSummary[],
  inboxCountsByProject: new Map<
    string,
    { needsAttention: number; active: number; total: number }
  >(),
}));

vi.mock("../../api/client", () => ({
  api: {
    addProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock("../../lib/clientSummaryStore", () => ({
  useInboxCountsByProject: () => state.inboxCountsByProject,
}));

vi.mock("../../hooks/useProjects", () => ({
  useProjects: () => ({
    projects: state.projects,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../hooks/useProjectQueues", () => ({
  useProjectQueues: () => ({
    queuesByProject: { "project-1": state.queueItems },
    items: state.queueItems,
    loading: false,
    error: null,
    mutatingItemId: null,
    refetch: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    retryItem: vi.fn(),
  }),
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
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

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));

function makeItem(status: ProjectQueueItemSummary["status"]) {
  return {
    id: "queue-1",
    projectId: "project-1" as ProjectQueueItemSummary["projectId"],
    target: { type: "existing-session", sessionId: "session-abcdef" },
    messagePreview: "Queued project work",
    message: { text: "Queued project work" },
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    status,
    attachmentCount: 0,
  } satisfies ProjectQueueItemSummary;
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    state.queueItems = [makeItem("queued")];
    state.inboxCountsByProject = new Map();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders project queue items and project card queue counts", () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Project Queue" })).toBeTruthy();
    expect(screen.getByText("Queued project work")).toBeTruthy();
    expect(screen.getByTitle("Project Queue items: 1").textContent).toBe("1");
  });
});
