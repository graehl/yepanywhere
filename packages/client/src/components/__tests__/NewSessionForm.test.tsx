// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSessionForm } from "../NewSessionForm";

const {
  mockNavigate,
  mockUpdateSetting,
  mockStartSession,
  mockStartDetachedSession,
  mockAddProject,
  providersState,
  serverSettingsState,
  filterDropdownState,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUpdateSetting: vi.fn(),
  mockStartSession: vi.fn(),
  mockStartDetachedSession: vi.fn(),
  mockAddProject: vi.fn(),
  providersState: {
    providers: [] as Array<{
      name: string;
      displayName: string;
      installed: boolean;
      authenticated: boolean;
      enabled?: boolean;
      supportsPermissionMode?: boolean;
      supportsThinkingToggle?: boolean;
      models?: Array<{ id: string; name: string; description?: string }>;
    }>,
    loading: false,
  },
  serverSettingsState: {
    settings: null as {
      newSessionDefaults?: {
        provider?: "claude" | "codex";
        model?: string;
        permissionMode?: "default";
      };
    } | null,
    isLoading: true,
  },
  filterDropdownState: {
    selected: [] as string[],
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../api/client", () => ({
  api: {
    addProject: mockAddProject,
    startSession: mockStartSession,
    startDetachedSession: mockStartDetachedSession,
    createDetachedSession: vi.fn(),
    createSession: vi.fn(),
    queueMessage: vi.fn(),
  },
}));

vi.mock("../../hooks/useConnection", () => ({
  useConnection: () => ({
    upload: vi.fn(),
  }),
}));

vi.mock("../../hooks/useDraftPersistence", () => ({
  useDraftPersistence: () => {
    const [value, setValue] = useState("");
    const clearInput = useCallback(() => setValue(""), []);
    const clearDraft = useCallback(() => setValue(""), []);
    const restoreFromStorage = useCallback(() => {}, []);

    const controls = useMemo(
      () => ({
        clearInput,
        clearDraft,
        restoreFromStorage,
      }),
      [clearDraft, clearInput, restoreFromStorage],
    );

    return [value, setValue, controls] as const;
  },
}));

vi.mock("../../hooks/useModelSettings", () => ({
  useModelSettings: () => ({
    thinkingMode: "off",
    cycleThinkingMode: vi.fn(),
    thinkingLevel: "high",
  }),
  getThinkingSetting: () => "off",
  getModelSetting: () => "opus",
}));

vi.mock("../../hooks/useProviders", () => ({
  useProviders: () => providersState,
  getAvailableProviders: (providers: typeof providersState.providers) =>
    providers.filter((provider) => provider.installed && provider.authenticated),
  getDefaultProvider: (providers: typeof providersState.providers) =>
    providers.find((provider) => provider.name === "claude") ?? providers[0] ?? null,
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("../../hooks/useRemoteExecutors", () => ({
  useRemoteExecutors: () => ({
    executors: [],
    loading: false,
  }),
}));

vi.mock("../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: serverSettingsState.settings,
    isLoading: serverSettingsState.isLoading,
    error: null,
    updateSettings: vi.fn(),
    updateSetting: mockUpdateSetting,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToastContext: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../FilterDropdown", () => ({
  FilterDropdown: ({
    options,
    selected,
    onChange,
  }: {
    options: Array<{ value: string; label: string }>;
    selected: string[];
    onChange: (selected: string[]) => void;
  }) => {
    filterDropdownState.selected = selected;
    return (
      <div>
        <div data-testid="filter-selected">{selected[0] ?? ""}</div>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange([option.value])}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("../../lib/newSessionPrefill", () => ({
  clearNewSessionPrefill: vi.fn(),
  getNewSessionPrefill: () => "",
}));

vi.mock("../VoiceInputButton", () => ({
  VoiceInputButton: () => <button type="button">voice</button>,
}));

const chooserProjects = [
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
] as const;

describe("NewSessionForm", () => {
  beforeEach(() => {
    providersState.providers = [
      {
        name: "claude",
        displayName: "Claude",
        installed: true,
        authenticated: true,
        supportsPermissionMode: true,
        supportsThinkingToggle: true,
        models: [
          { id: "default", name: "Default" },
          { id: "opus", name: "Opus" },
        ],
      },
      {
        name: "codex",
        displayName: "Codex",
        installed: true,
        authenticated: true,
        supportsPermissionMode: true,
        supportsThinkingToggle: true,
        models: [
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
        ],
      },
    ];
    providersState.loading = false;
    serverSettingsState.settings = null;
    serverSettingsState.isLoading = true;
    filterDropdownState.selected = [];
    mockNavigate.mockReset();
    mockUpdateSetting.mockReset();
    mockStartSession.mockReset();
    mockStartDetachedSession.mockReset();
    mockAddProject.mockReset();
    mockStartSession.mockResolvedValue({
      sessionId: "session-1",
      processId: "process-1",
      projectId: "project-1",
      permissionMode: "default",
      modeVersion: 0,
    });
    mockStartDetachedSession.mockResolvedValue({
      sessionId: "session-detached",
      processId: "process-detached",
      projectId: "detached-project",
      permissionMode: "default",
      modeVersion: 0,
    });
    mockAddProject.mockResolvedValue({
      project: {
        id: "project-added",
        name: "added-project",
        path: "/tmp/added-project",
        sessionCount: 0,
        activeOwnedCount: 0,
        activeExternalCount: 0,
        lastActivity: null,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps an explicit Claude selection when saved Codex defaults load later", async () => {
    const { rerender } = render(<NewSessionForm projectId="project-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Claude" }));

    expect(screen.getByRole("button", { name: "Claude" }).className).toContain(
      "selected",
    );
    expect(screen.getByTestId("filter-selected").textContent).toBe("opus");

    serverSettingsState.settings = {
      newSessionDefaults: {
        provider: "codex",
        model: "gpt-5.3-codex",
        permissionMode: "default",
      },
    };
    serverSettingsState.isLoading = false;

    rerender(<NewSessionForm projectId="project-1" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Claude" }).className,
      ).toContain("selected");
      expect(screen.getByRole("button", { name: "Codex" }).className).not.toContain(
        "selected",
      );
      expect(screen.getByTestId("filter-selected").textContent).toBe("opus");
    });
  });

  it("does not reuse the Claude fallback model when switching to Codex", async () => {
    serverSettingsState.isLoading = false;

    render(
      <NewSessionForm
        projectId="project-1"
        selectedProject={chooserProjects[0]}
        projects={[...chooserProjects]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Codex" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Codex" }).className).toContain(
        "selected",
      );
      expect(screen.getByTestId("filter-selected").textContent).toBe("gpt-5.4");
    });
  });

  it("submits the selected Claude provider and model to startSession", async () => {
    serverSettingsState.settings = {
      newSessionDefaults: {
        provider: "codex",
        model: "gpt-5.3-codex",
        permissionMode: "default",
      },
    };
    serverSettingsState.isLoading = false;

    render(
      <NewSessionForm
        projectId="project-1"
        selectedProject={chooserProjects[0]}
        projects={[...chooserProjects]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Opus" }));
    fireEvent.change(screen.getByPlaceholderText("newSessionPlaceholder"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "newSessionStartAction" }));

    await waitFor(() => {
      expect(mockStartSession).toHaveBeenCalledTimes(1);
    });

    expect(mockStartSession).toHaveBeenCalledWith(
      "project-1",
      "hello",
      expect.objectContaining({
        provider: "claude",
        model: "opus",
      }),
    );
  });

  it("shows detached and recent project choices in the default launcher", () => {
    render(<NewSessionForm projects={[...chooserProjects]} />);

    expect(
      screen.getByPlaceholderText("newSessionProjectPathPlaceholder"),
    ).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: /newSessionProjectDetached/i }),
    );

    expect(screen.getAllByText("newSessionProjectDetached")).toHaveLength(2);
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
  });

  it("keeps the drafted prompt when switching from detached to a project", async () => {
    const onProjectChange = vi.fn();

    render(
      <NewSessionForm
        projects={[...chooserProjects]}
        onProjectChange={onProjectChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("newSessionPlaceholder"), {
      target: { value: "draft the migration plan" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /newSessionProjectDetached/i }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Alpha/i })[0]!);

    expect(onProjectChange).toHaveBeenCalledWith("project-1");
    expect(
      (
        screen.getByPlaceholderText(
          "newSessionPlaceholder",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("draft the migration plan");
  });

  it("resolves a typed project path before starting the session", async () => {
    render(<NewSessionForm projects={[...chooserProjects]} />);

    fireEvent.change(
      screen.getByPlaceholderText("newSessionProjectPathPlaceholder"),
      {
        target: { value: "/tmp/added-project" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("newSessionPlaceholder"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "newSessionStartAction" }));

    await waitFor(() => {
      expect(mockAddProject).toHaveBeenCalledWith("/tmp/added-project");
      expect(mockStartSession).toHaveBeenCalledWith(
        "project-added",
        "hello",
        expect.any(Object),
      );
    });
  });

  it("starts a detached session when no project is selected", async () => {
    render(<NewSessionForm projects={[...chooserProjects]} />);

    fireEvent.change(screen.getByPlaceholderText("newSessionPlaceholder"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "newSessionStartAction" }));

    await waitFor(() => {
      expect(mockStartDetachedSession).toHaveBeenCalledWith(
        "hello",
        expect.any(Object),
      );
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/detached-project/sessions/session-detached",
      expect.any(Object),
    );
  });
});
