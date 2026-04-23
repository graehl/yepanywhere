// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";

const mockWindowOpen = vi.fn();
const mockToggleExpanded = vi.fn();

vi.mock("../../contexts/RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => null,
}));

vi.mock("../../hooks/useDrafts", () => ({
  useDrafts: () => new Set<string>(),
}));

vi.mock("../../hooks/useGlobalSessions", () => ({
  useGlobalSessions: () => ({
    sessions: [],
    loading: false,
  }),
}));

vi.mock("../../hooks/useNeedsAttentionBadge", () => ({
  useNeedsAttentionBadge: () => 0,
}));

vi.mock("../../hooks/useRecentProjects", () => ({
  useRecentProjects: () => ({
    recentProjects: [{ id: "project-1" }],
    projects: [{ id: "project-1" }],
    loading: false,
  }),
}));

vi.mock("../../hooks/useRecentProject", () => ({
  resolvePreferredProjectId: () => "project-1",
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "/remote/test",
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: {
      capabilities: [],
    },
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      (
        {
          actionExpandSidebar: "Expand sidebar",
          actionCloseSidebar: "Close sidebar",
          sidebarNewSession: "New Session",
          sidebarInbox: "Inbox",
          sidebarAllSessions: "All Sessions",
          sidebarProjects: "Projects",
          sidebarSettings: "Settings",
          sidebarSectionStarred: "Starred",
          sidebarSectionLast24Hours: "Last 24 Hours",
          sidebarSectionOlder: "Older",
          sidebarEmpty: "No sessions yet",
          actionShowMore: "Show more",
        } as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock("../AgentsNavItem", () => ({
  AgentsNavItem: () => null,
}));

vi.mock("../SessionListItem", () => ({
  SessionListItem: () => null,
}));

describe("Sidebar collapsed toggle", () => {
  beforeEach(() => {
    mockToggleExpanded.mockReset();
    mockWindowOpen.mockReset();
    vi.stubGlobal("open", mockWindowOpen);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderSidebar() {
    render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          onClose={() => {}}
          onNavigate={() => {}}
          isDesktop={true}
          isCollapsed={true}
          onToggleExpanded={mockToggleExpanded}
        />
      </MemoryRouter>,
    );
  }

  it("expands the sidebar on a normal click", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(mockToggleExpanded).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it("opens a new-session window on middle click", () => {
    renderSidebar();

    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    fireEvent.mouseDown(toggle, { button: 1 });
    toggle.dispatchEvent(
      new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 1,
      }),
    );

    expect(mockToggleExpanded).not.toHaveBeenCalled();
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/remote/test/new-session?projectId=project-1&sidebar=expanded",
      "_blank",
      "noopener",
    );
  });
});
