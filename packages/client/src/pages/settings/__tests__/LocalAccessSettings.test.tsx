// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutRouter,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  AGENT_SERVER_ACCESS_CAPABILITY,
  APPROVAL_AUDIT_LOG_CAPABILITY,
  SERVER_CAPABILITIES,
  agentApiBootstrapInstructions,
} from "@yep-anywhere/shared";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FileAccessInfo,
  FileAccessSettings,
  ServerSettings,
} from "../../../api/client";
import { LocalAccessSettings } from "../LocalAccessSettings";
import {
  type SettingsUndoRegistration,
  SettingsUndoProvider,
} from "../SettingsUndoContext";

const {
  authState,
  bindingState,
  hookState,
  mockDisconnect,
  mockGetFileAccessInfo,
  mockUpdateSetting,
  mockUpdateSettings,
  remoteState,
  versionState,
} = vi.hoisted(() => ({
  authState: { value: null as unknown },
  bindingState: { value: null as unknown },
  hookState: {
    settings: null as ServerSettings | null,
    isLoading: false,
    error: null as string | null,
  },
  mockDisconnect: vi.fn(),
  mockGetFileAccessInfo: vi.fn(),
  mockUpdateSetting: vi.fn(),
  mockUpdateSettings: vi.fn(),
  remoteState: {
    connection: null as null | { disconnect: () => void },
  },
  versionState: {
    capabilities: [] as string[],
  },
}));

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>(
    "../../../api/client",
  );
  return {
    ...actual,
    api: {
      ...actual.api,
      getFileAccessInfo: mockGetFileAccessInfo,
    },
  };
});

vi.mock("../../../contexts/AuthContext", () => ({
  useOptionalAuth: () => authState.value,
}));

vi.mock("../../../contexts/RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => remoteState.connection,
}));

vi.mock("../../../hooks/useNetworkBinding", () => ({
  useNetworkBinding: () => ({
    binding: bindingState.value,
    loading: false,
    applying: false,
    updateBinding: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useServerInfo", () => ({
  useServerInfo: () => ({
    serverInfo: null,
    loading: false,
  }),
}));

vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    ...hookState,
    updateSetting: mockUpdateSetting,
    updateSettings: mockUpdateSettings,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: {
      capabilities: versionState.capabilities,
    },
  }),
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const fileAccessInfo: FileAccessInfo = {
  envPinned: false,
  envPaths: [],
  tempPaths: ["/tmp"],
  uploadsDir: "/uploads",
  homeDir: "/home/alice",
};

const baseFileAccess: FileAccessSettings = {
  projects: true,
  uploads: true,
  temp: true,
  home: false,
  custom: [],
};

const baseSettings: ServerSettings = {
  serviceWorkerEnabled: true,
  persistRemoteSessionsToDisk: false,
  fileAccess: baseFileAccess,
};

function render(ui: ReactElement) {
  return renderWithoutRouter(<MemoryRouter>{ui}</MemoryRouter>);
}

function checkboxFor(labelKey: string): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: labelKey,
  }) as HTMLInputElement;
}

describe("LocalAccessSettings", () => {
  beforeEach(() => {
    hookState.settings = {
      ...baseSettings,
      fileAccess: {
        ...baseFileAccess,
        custom: [...baseFileAccess.custom],
      },
    };
    hookState.isLoading = false;
    hookState.error = null;
    remoteState.connection = { disconnect: mockDisconnect };
    mockGetFileAccessInfo.mockResolvedValue(fileAccessInfo);
    mockUpdateSetting.mockResolvedValue(undefined);
    mockUpdateSettings.mockImplementation(
      async (updates: Partial<ServerSettings>) => {
        if (!hookState.settings) throw new Error("settings not initialized");
        hookState.settings = { ...hookState.settings, ...updates };
      },
    );
    versionState.capabilities = [APPROVAL_AUDIT_LOG_CAPABILITY];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    remoteState.connection = null;
    authState.value = null;
    bindingState.value = null;
  });

  describe("password block", () => {
    const enableAuth = vi.fn();
    const changePassword = vi.fn();
    const disableAuth = vi.fn();

    function useDirectAccess(authEnabled: boolean) {
      remoteState.connection = null;
      authState.value = {
        authEnabled,
        isAuthenticated: true,
        isLoading: false,
        localhostOpen: false,
        hasDesktopToken: false,
        authDisabledByEnv: false,
        enableAuth,
        changePassword,
        disableAuth,
        setLocalhostOpen: vi.fn(),
        logout: vi.fn(),
      };
      bindingState.value = {
        localhost: { port: 3400, overriddenByCli: false },
        network: {
          enabled: false,
          host: null,
          port: 3400,
          overriddenByCli: false,
        },
        interfaces: [],
      };
    }

    function feedback(): string | null | undefined {
      return document
        .querySelector("[data-local-access-password-feedback]")
        ?.getAttribute("data-local-access-password-feedback");
    }

    it("gates API discovery separately from the legacy operator token and previews the exact bootstrap", async () => {
      useDirectAccess(false);
      const first = render(<LocalAccessSettings />);
      expect(
        screen.queryByRole("checkbox", { name: "localAccessAgentApiTitle" }),
      ).toBeNull();
      first.unmount();
      versionState.capabilities = [SERVER_CAPABILITIES.agentApiBootstrap.name];
      render(<LocalAccessSettings />);
      const toggle = screen.getByRole("checkbox", {
        name: "localAccessAgentApiTitle",
      });
      expect(toggle).toHaveProperty("checked", false);
      fireEvent.click(toggle);
      expect(mockUpdateSetting).toHaveBeenCalledWith("agentApiEnabled", true);
      expect(
        screen.queryByRole("checkbox", {
          name: "localAccessAgentServerAccessTitle",
        }),
      ).toBeNull();
      const preview = screen
        .getByText("localAccessAgentApiPreview")
        .closest("details")!;
      expect(preview.textContent).toContain(
        agentApiBootstrapInstructions(false),
      );
      expect(preview.textContent).toContain(
        agentApiBootstrapInstructions(true),
      );
    });

    it("offers session API access only once a password is required", async () => {
      versionState.capabilities = [
        APPROVAL_AUDIT_LOG_CAPABILITY,
        AGENT_SERVER_ACCESS_CAPABILITY,
      ];
      useDirectAccess(false);
      const { unmount } = render(<LocalAccessSettings />);
      expect(
        screen.queryByRole("checkbox", {
          name: "localAccessAgentServerAccessTitle",
        }),
      ).toBeNull();
      unmount();

      useDirectAccess(true);
      render(<LocalAccessSettings />);
      const toggle = screen.getByRole("checkbox", {
        name: "localAccessAgentServerAccessTitle",
      });
      expect(toggle).toHaveProperty("checked", false);
      fireEvent.click(toggle);
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        "agentServerAccessEnabled",
        true,
      );
    });

    it("nests the fields under the toggle with live match feedback", async () => {
      useDirectAccess(false);
      render(<LocalAccessSettings />);

      expect(
        document.querySelector("[data-local-access-password-block]"),
      ).toBeNull();
      fireEvent.click(checkboxFor("localAccessRequirePasswordTitle"));

      const block = document.querySelector(
        "[data-local-access-password-block]",
      ) as HTMLElement;
      expect(block.textContent).toContain("localAccessPasswordPending");
      const password = screen.getByPlaceholderText(
        "localAccessPasswordPlaceholder",
      );
      const confirm = screen.getByPlaceholderText(
        "localAccessConfirmPasswordPlaceholder",
      );
      const apply = screen.getByRole("button", {
        name: "localAccessPasswordEnableAction",
      });
      expect(block.contains(confirm)).toBe(true);
      expect(block.contains(apply)).toBe(true);

      fireEvent.change(password, { target: { value: "abc" } });
      expect(feedback()).toBe("short");
      fireEvent.change(password, { target: { value: "secret1" } });
      fireEvent.change(confirm, { target: { value: "sec" } });
      expect(feedback()).toBe("none");
      fireEvent.change(confirm, { target: { value: "secret2" } });
      expect(feedback()).toBe("mismatch");
      expect(confirm.getAttribute("aria-invalid")).toBe("true");
      expect((apply as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(confirm, { target: { value: "secret1" } });
      expect(feedback()).toBe("match");
      expect((apply as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(apply);
      await waitFor(() => expect(enableAuth).toHaveBeenCalledWith("secret1"));
    });

    it("offers removal in place when the toggle turns an active password off", async () => {
      useDirectAccess(true);
      render(<LocalAccessSettings />);

      const block = document.querySelector(
        "[data-local-access-password-block]",
      ) as HTMLElement;
      expect(block.textContent).toContain("localAccessPasswordActive");
      fireEvent.click(checkboxFor("localAccessRequirePasswordTitle"));
      expect(block.textContent).toContain("localAccessPasswordDisableWarning");
      fireEvent.click(
        screen.getByRole("button", {
          name: "localAccessPasswordDisableAction",
        }),
      );
      await waitFor(() => expect(disableAuth).toHaveBeenCalledTimes(1));
    });
  });

  it("shows file access controls in relay mode without direct port controls", async () => {
    render(<LocalAccessSettings />);

    const fileAccessPanel = await screen.findByRole("group", {
      name: "fileAccessTitle",
    });
    expect(fileAccessPanel.contains(screen.getByText("fileAccessHome"))).toBe(
      true,
    );
    expect(screen.queryByText("developmentRelayDebugTitle")).toBeNull();
    expect(screen.queryByText("localAccessRelayDebugTitle")).toBeNull();
    expect(screen.queryByText("localAccessListeningPortTitle")).toBeNull();
  });

  it("saves relay-mode file access toggles immediately", async () => {
    render(<LocalAccessSettings />);

    fireEvent.click(checkboxFor("fileAccessHome"));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        fileAccess: {
          projects: true,
          uploads: true,
          temp: true,
          home: true,
          custom: [],
        },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "localAccessApply" }),
    ).toBeNull();
  });

  it("saves custom folders on blur or explicit save", async () => {
    render(<LocalAccessSettings />);

    const customFolders = await screen.findByRole("textbox", {
      name: "fileAccessCustomTitle",
    });
    fireEvent.change(customFolders, {
      target: { value: " /srv/first \n/srv/second" },
    });
    fireEvent.blur(customFolders);

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenLastCalledWith({
        fileAccess: {
          projects: true,
          uploads: true,
          temp: true,
          home: false,
          custom: ["/srv/first", "/srv/second"],
        },
      }),
    );

    fireEvent.change(customFolders, {
      target: { value: "/srv/clicked" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "fileAccessCustomSave" }),
    );

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenLastCalledWith({
        fileAccess: {
          projects: true,
          uploads: true,
          temp: true,
          home: false,
          custom: ["/srv/clicked"],
        },
      }),
    );
  });

  it("undoes an immediately saved custom folder edit", async () => {
    let undoRegistration: SettingsUndoRegistration | null = null;
    render(
      <SettingsUndoProvider
        value={(registration) => {
          undoRegistration = registration;
        }}
      >
        <LocalAccessSettings />
      </SettingsUndoProvider>,
    );

    const customFolders = await screen.findByRole("textbox", {
      name: "fileAccessCustomTitle",
    });
    fireEvent.change(customFolders, {
      target: { value: "/srv/undo-me" },
    });
    fireEvent.blur(customFolders);

    await waitFor(() => expect(undoRegistration?.canUndo).toBe(true));
    const undo = (undoRegistration as SettingsUndoRegistration | null)?.undo;
    expect(undo).toBeTypeOf("function");
    await act(async () => {
      await undo?.();
    });

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenLastCalledWith({
        fileAccess: baseFileAccess,
      }),
    );
  });

  it("updates approval audit logging when the server supports it", async () => {
    hookState.settings = {
      ...baseSettings,
      approvalAuditLogEnabled: false,
    };

    render(<LocalAccessSettings />);

    const auditToggle = await screen.findByRole("checkbox", {
      name: "localAccessApprovalAuditTitle",
    });
    expect(auditToggle).toHaveProperty("disabled", false);
    expect(auditToggle).toHaveProperty("checked", false);

    fireEvent.click(auditToggle);

    expect(mockUpdateSetting).toHaveBeenCalledWith(
      "approvalAuditLogEnabled",
      true,
    );
  });
});
