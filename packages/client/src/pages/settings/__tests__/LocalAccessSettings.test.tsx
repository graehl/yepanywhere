// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { APPROVAL_AUDIT_LOG_CAPABILITY } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileAccessInfo, ServerSettings } from "../../../api/client";
import { LocalAccessSettings } from "../LocalAccessSettings";

const {
  hookState,
  mockDisconnect,
  mockGetFileAccessInfo,
  mockUpdateSetting,
  mockUpdateSettings,
  remoteState,
  versionState,
} = vi.hoisted(() => ({
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
  useOptionalAuth: () => null,
}));

vi.mock("../../../contexts/RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => remoteState.connection,
}));

vi.mock("../../../hooks/useNetworkBinding", () => ({
  useNetworkBinding: () => ({
    binding: null,
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

const baseSettings: ServerSettings = {
  serviceWorkerEnabled: true,
  persistRemoteSessionsToDisk: false,
  fileAccess: {
    projects: true,
    uploads: true,
    temp: true,
    home: false,
    custom: [],
  },
};

function checkboxFor(labelKey: string): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: labelKey,
  }) as HTMLInputElement;
}

describe("LocalAccessSettings", () => {
  beforeEach(() => {
    hookState.settings = { ...baseSettings };
    hookState.isLoading = false;
    hookState.error = null;
    remoteState.connection = { disconnect: mockDisconnect };
    mockGetFileAccessInfo.mockResolvedValue(fileAccessInfo);
    mockUpdateSetting.mockResolvedValue(undefined);
    mockUpdateSettings.mockResolvedValue(undefined);
    versionState.capabilities = [APPROVAL_AUDIT_LOG_CAPABILITY];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    remoteState.connection = null;
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

  it("saves relay-mode file access changes through server settings", async () => {
    render(<LocalAccessSettings />);

    const saveButton = await screen.findByRole("button", {
      name: "localAccessApply",
    });
    expect(saveButton).toHaveProperty("disabled", true);

    fireEvent.click(checkboxFor("fileAccessHome"));

    expect(saveButton).toHaveProperty("disabled", false);
    fireEvent.click(saveButton);

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

  it("shows legacy approval audit logging as read-only without capability", async () => {
    versionState.capabilities = [];
    hookState.settings = {
      ...baseSettings,
      approvalAuditLogEnabled: false,
    };

    render(<LocalAccessSettings />);

    const auditToggle = await screen.findByRole("checkbox", {
      name: "localAccessApprovalAuditTitle",
    });
    expect(auditToggle).toHaveProperty("disabled", true);
    expect(auditToggle).toHaveProperty("checked", true);
    expect(
      screen.getByText("localAccessApprovalAuditUnsupportedDescription"),
    ).toBeTruthy();
  });
});
