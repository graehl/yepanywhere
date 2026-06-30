import type { GitStatusInfo } from "@yep-anywhere/shared";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GIT_STATUS_ENHANCED_CAPABILITY } from "@yep-anywhere/shared";
import { resetRouteRetentionForTests } from "../../lib/routeRetention";
import type { Project } from "../../types";
import { GitStatusPage } from "../GitStatusPage";

const mocks = vi.hoisted(() => ({
  getGitDiff: vi.fn(),
  useProjects: vi.fn(),
  useProject: vi.fn(),
  useVersion: vi.fn(),
  useGitStatus: vi.fn(),
  useNavigationLayout: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: {
    getGitDiff: mocks.getGitDiff,
    checkGitRemote: vi.fn(),
    pullGit: vi.fn(),
    pushGit: vi.fn(),
  },
}));

vi.mock("../../hooks/useDocumentTitle", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("../../hooks/useGitStatus", () => ({
  useGitStatus: mocks.useGitStatus,
}));

vi.mock("../../hooks/useProjects", () => ({
  useProject: mocks.useProject,
  useProjects: mocks.useProjects,
}));

vi.mock("../../hooks/useRelativeNow", () => ({
  useRelativeNow: () => 0,
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: mocks.useVersion,
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("../../layouts", () => ({
  MainContent: ({
    children,
    innerClassName,
  }: {
    children: ReactNode;
    innerClassName?: string;
  }) => <div className={innerClassName}>{children}</div>,
  useNavigationLayout: mocks.useNavigationLayout,
}));

function project(): Project {
  return {
    id: "project-a",
    name: "Project A",
    path: "/repo/project-a",
    sessionCount: 1,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    projectQueueBlockingCount: 0,
    lastActivity: "2026-06-30T00:00:00.000Z",
  };
}

function status(): GitStatusInfo {
  return {
    isGitRepo: true,
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    isClean: false,
    files: [
      {
        path: "a.ts",
        status: "M",
        staged: false,
        linesAdded: 1,
        linesDeleted: 0,
      },
      {
        path: "b.ts",
        status: "A",
        staged: true,
        linesAdded: 3,
        linesDeleted: 0,
      },
    ],
    recentCommits: [],
    checkedRemoteAt: null,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/git-status?projectId=project-a"]}>
      <Routes>
        <Route path="/git-status" element={<GitStatusPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetRouteRetentionForTests();
  mocks.getGitDiff.mockReset();
  mocks.getGitDiff.mockResolvedValue({
    diffHtml: "",
    structuredPatch: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-a", "+b"],
      },
    ],
  });
  mocks.useProjects.mockReturnValue({
    projects: [project()],
    loading: false,
  });
  mocks.useProject.mockReturnValue({ project: project() });
  mocks.useVersion.mockReturnValue({
    version: { capabilities: [GIT_STATUS_ENHANCED_CAPABILITY] },
    loading: false,
    error: null,
  });
  mocks.useGitStatus.mockReturnValue({
    gitStatus: status(),
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.useNavigationLayout.mockReturnValue({
    openSidebar: vi.fn(),
    isWideScreen: true,
    isSidebarCollapsed: false,
    toggleSidebar: vi.fn(),
  });
});

describe("GitStatusPage route retention", () => {
  it("restores the selected file after the route remounts", async () => {
    const first = renderPage();
    await screen.findByRole("button", { name: "gitStatusFullContext" });
    fireEvent.click(screen.getByRole("button", { name: /b\.ts/ }));
    expect(
      screen
        .getByRole("button", { name: /b\.ts/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    first.unmount();

    renderPage();
    await screen.findByRole("button", { name: "gitStatusFullContext" });

    expect(
      screen
        .getByRole("button", { name: /b\.ts/ })
        .getAttribute("aria-current"),
    ).toBe("true");
  });
});
