// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_LOCAL_KEYS, UI_KEYS } from "../../lib/storageKeys";
import { NewSessionPage } from "../NewSessionPage";
import type { ActingPrincipal } from "@yep-anywhere/shared";
import { writeNewSessionProjectSnapshot } from "../../lib/newSessionProjectSnapshot";

const identity = vi.hoisted(() => ({
  principal: { username: null } as ActingPrincipal,
  resolved: false,
}));

const { projectFetch, projectsState, recentSessionsState, versionState } =
  vi.hoisted(() => ({
    projectFetch: { settled: false },
    versionState: { capabilities: [] as string[] },
    projectsState: {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          path: "/tmp/alpha",
          sessionCount: 3,
          activeOwnedCount: 0,
          activeExternalCount: 0,
          lastActivity: "2026-04-23T10:00:00.000Z",
        },
        {
          id: "project-2",
          name: "Beta",
          path: "/tmp/beta",
          sessionCount: 1,
          activeOwnedCount: 0,
          activeExternalCount: 0,
          lastActivity: "2026-04-22T10:00:00.000Z",
        },
      ],
      loading: false,
      complete: true,
      error: null as Error | null,
    },
    recentSessionsState: {
      recentSessions: [] as Array<{ projectId: string }>,
      recentProjectIds: [] as string[],
      isLoadingVisits: false,
      isLoading: false,
      error: null as Error | null,
    },
  }));

const { projectAppInfo } = vi.hoisted(() => ({
  projectAppInfo: vi.fn(async (_projectId: string) => ({
    declaration: { name: "app" },
    state: "running",
  })),
}));

vi.mock("../../api/projectApp", () => ({
  projectAppApi: { info: projectAppInfo },
}));

vi.mock("../../components/NewSessionForm", () => ({
  NewSessionForm: ({
    incomingShareFiles,
    projectId,
    selectedProject,
    onProjectChange,
  }: {
    incomingShareFiles?: readonly File[];
    projectId?: string;
    selectedProject?: { name: string } | null;
    onProjectChange?: (projectId: string | null) => void;
  }) => (
    <div>
      <div data-testid="incoming-share-files">
        {incomingShareFiles?.length ?? 0}
      </div>
      <div data-testid="form-project-id">{projectId ?? "none"}</div>
      <div data-testid="form-project-name">
        {selectedProject?.name ?? "none"}
      </div>
      <button type="button" onClick={() => onProjectChange?.("project-2")}>
        Select Beta
      </button>
      <button type="button" onClick={() => onProjectChange?.(null)}>
        Select No Project
      </button>
    </div>
  ),
}));

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToastContext: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../hooks/useDocumentTitle", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({ version: versionState }),
}));

vi.mock("../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => identity,
}));

vi.mock("../../hooks/useProjects", () => ({
  useProjects: () => projectsState,
  useProject: (projectId: string | undefined) => {
    const project =
      projectsState.projects.find((candidate) => candidate.id === projectId) ??
      null;
    const missing = Boolean(projectId) && !project;
    return {
      project,
      loading: missing && !projectFetch.settled,
      error: missing && projectFetch.settled ? new Error("not found") : null,
    };
  },
}));

vi.mock("../../hooks/useRecentSessions", () => ({
  useRecentSessions: () => ({
    ...recentSessionsState,
    recordVisit: vi.fn(),
    clearRecents: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
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

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderPage(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/new-session"
          element={
            <>
              <NewSessionPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NewSessionPage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const localStorageMock = {
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
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    window.localStorage.clear();
    versionState.capabilities = [];
    projectFetch.settled = false;
    identity.resolved = false;
    projectsState.loading = false;
    projectsState.complete = true;
    recentSessionsState.recentSessions = [];
    recentSessionsState.recentProjectIds = [];
    recentSessionsState.isLoadingVisits = false;
    recentSessionsState.isLoading = false;
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("hides app composing by default even on a capable server", () => {
    versionState.capabilities = ["project-service"];
    localStorage.setItem(UI_KEYS.sessionRightPane, "true");
    renderPage("/new-session?projectId=project-1");
    expect(screen.queryByRole("link", { name: "projectAppLabel" })).toBeNull();
  });

  it("offers the App button only after opting into app composing", async () => {
    versionState.capabilities = ["project-service"];
    localStorage.setItem(UI_KEYS.projectAppComposing, "true");
    renderPage("/new-session?projectId=project-1");
    expect(
      (
        await screen.findByRole("link", { name: "projectAppLabel" })
      ).getAttribute("href"),
    ).toBe("/projects/project-1/app?compose=1");
    expect(projectAppInfo).toHaveBeenCalledWith("project-1");
  });

  it("hides the App button for a project without an app", async () => {
    versionState.capabilities = ["project-service"];
    localStorage.setItem(UI_KEYS.projectAppComposing, "true");
    projectAppInfo.mockResolvedValueOnce({
      declaration: undefined,
      state: "missing",
    } as never);
    renderPage("/new-session?projectId=project-1");
    await waitFor(() => expect(projectAppInfo).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "projectAppLabel" })).toBeNull();
  });

  it("keeps app composing hidden when the server lacks support", () => {
    localStorage.setItem(UI_KEYS.projectAppComposing, "true");
    renderPage("/new-session?projectId=project-1");
    expect(screen.queryByRole("link", { name: "projectAppLabel" })).toBeNull();
    expect(projectAppInfo).not.toHaveBeenCalled();
  });

  it("uses the stored recent project when opened without a project", async () => {
    window.localStorage.setItem(BROWSER_LOCAL_KEYS.recentProject, "project-2");

    renderPage("/new-session");

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/new-session?projectId=project-2",
      );
    });
    expect(screen.getByTestId("form-project-name").textContent).toBe("Beta");
    expect(screen.getByTestId("incoming-share-files").textContent).toBe("0");
  });

  it("records an explicit query project as the recent project", async () => {
    renderPage("/new-session?projectId=project-1");

    await waitFor(() => {
      expect(
        window.localStorage.getItem(BROWSER_LOCAL_KEYS.recentProject),
      ).toBe("project-1");
    });
  });

  it("waits for collection completion before replacing an undiscovered preference", async () => {
    projectsState.complete = false;
    localStorage.setItem(BROWSER_LOCAL_KEYS.recentProject, "undiscovered");
    recentSessionsState.recentProjectIds = ["project-2"];
    const view = () => (
      <MemoryRouter initialEntries={["/new-session"]}>
        <NewSessionPage />
        <LocationProbe />
      </MemoryRouter>
    );
    const { rerender } = render(view());
    expect(screen.getByTestId("location").textContent).toBe("/new-session");
    expect(localStorage.getItem(BROWSER_LOCAL_KEYS.recentProject)).toBe(
      "undiscovered",
    );
    projectsState.complete = true;
    rerender(view());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/new-session?projectId=project-2",
      ),
    );
  });

  it("stores dropdown project changes and updates the URL", async () => {
    renderPage("/new-session?detached=1");

    fireEvent.click(screen.getByRole("button", { name: "Select Beta" }));

    expect(screen.getByTestId("location").textContent).toBe(
      "/new-session?projectId=project-2",
    );
    expect(window.localStorage.getItem(BROWSER_LOCAL_KEYS.recentProject)).toBe(
      "project-2",
    );
  });

  it("selects the recent project before session titles finish loading", async () => {
    recentSessionsState.recentProjectIds = ["project-2"];
    recentSessionsState.isLoading = true;
    renderPage("/new-session");
    await waitFor(() =>
      expect(screen.getByTestId("form-project-id").textContent).toBe(
        "project-2",
      ),
    );
    expect(screen.getByTestId("form-project-name").textContent).toBe("Beta");
  });

  it("shows the composer before the selected project's record arrives", () => {
    renderPage("/new-session?projectId=project-late");
    expect(screen.getByTestId("form-project-id").textContent).toBe(
      "project-late",
    );
    expect(screen.getByTestId("form-project-name").textContent).toBe("none");
    expect(screen.queryByText("newSessionLoading")).toBeNull();
  });

  it("does not hide a server rejection behind a cached project", () => {
    identity.resolved = true;
    const cached = {
      ...projectsState.projects[0]!,
      id: "project-late",
      name: "Cached project",
    };
    writeNewSessionProjectSnapshot("local", identity.principal, [cached], []);
    const view = () => (
      <MemoryRouter initialEntries={["/new-session?projectId=project-late"]}>
        <NewSessionPage />
      </MemoryRouter>
    );
    const { rerender } = render(view());
    expect(screen.getByTestId("form-project-name").textContent).toBe(
      "Cached project",
    );
    projectFetch.settled = true;
    rerender(view());
    expect(screen.queryByTestId("form-project-id")).toBeNull();
    expect(screen.getByText(/newSessionErrorPrefix/).textContent).toContain(
      "not found",
    );
  });

  it("reports a selected project that failed to load", () => {
    projectFetch.settled = true;
    renderPage("/new-session?projectId=project-missing");
    expect(screen.queryByTestId("form-project-id")).toBeNull();
    expect(screen.getByText(/newSessionErrorPrefix/).textContent).toContain(
      "not found",
    );
  });

  it("keeps an explicit detached selection instead of restoring recents", async () => {
    window.localStorage.setItem(BROWSER_LOCAL_KEYS.recentProject, "project-1");
    renderPage("/new-session?projectId=project-1");

    fireEvent.click(screen.getByRole("button", { name: "Select No Project" }));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/new-session?detached=1",
      );
    });
    expect(screen.getByTestId("form-project-id").textContent).toBe("none");
  });
});
