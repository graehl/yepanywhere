// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerSettings } from "../../../api/client";
import { RemoteAccessSettings } from "../RemoteAccessSettings";

const { hostIdentityState, hookState, mockUpdateSetting } = vi.hoisted(() => ({
  hostIdentityState: { supported: true },
  hookState: {
    settings: {
      serviceWorkerEnabled: true,
      persistRemoteSessionsToDisk: false,
    } as ServerSettings,
    isLoading: false,
    error: null as string | null,
  },
  mockUpdateSetting: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../../../components/RemoteAccessSetup", () => ({
  RemoteAccessSetup: () => <div>remoteAccessSetup</div>,
}));

vi.mock("../../../contexts/HostIdentityContext", () => ({
  useHostIdentity: () => ({
    supported: hostIdentityState.supported,
    icon: hookState.settings.hostIdentity?.icon ?? null,
  }),
}));

vi.mock("../../../contexts/RemoteConnectionContext", () => ({
  useOptionalRemoteConnection: () => null,
}));

vi.mock("../../../hooks/usePublicShareStatus", () => ({
  usePublicShareStatus: () => ({ status: null }),
}));

vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    ...hookState,
    updateSetting: mockUpdateSetting,
  }),
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: { icon?: string }) =>
      values?.icon ? `${key}:${values.icon}` : key,
  }),
}));

vi.mock("../SettingsPaneTitleContext", () => ({
  useSettingsPaneTitle: vi.fn(),
}));

describe("RemoteAccessSettings host identity", () => {
  beforeEach(() => {
    hostIdentityState.supported = true;
    hookState.settings = {
      serviceWorkerEnabled: true,
      persistRemoteSessionsToDisk: false,
    };
    hookState.isLoading = false;
    hookState.error = null;
    mockUpdateSetting.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hides the control against servers without the capability", () => {
    hostIdentityState.supported = false;

    render(<RemoteAccessSettings />);

    expect(screen.queryByText("hostIdentityTitle")).toBeNull();
  });

  it("persists a selected preset through server settings", async () => {
    render(<RemoteAccessSettings />);

    fireEvent.click(
      screen.getByRole("button", { name: "hostIdentityUsePreset:❤️" }),
    );

    await waitFor(() =>
      expect(mockUpdateSetting).toHaveBeenCalledWith("hostIdentity", {
        icon: "❤️",
      }),
    );
  });

  it("validates and saves a custom marker", async () => {
    render(<RemoteAccessSettings />);
    const input = screen.getByRole("textbox", {
      name: "hostIdentityCustomLabel",
    });

    fireEvent.change(input, { target: { value: "two" } });
    expect(screen.getByText("hostIdentityInvalid")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "hostIdentitySave" }),
    ).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "🧡" } });
    fireEvent.click(screen.getByRole("button", { name: "hostIdentitySave" }));

    await waitFor(() =>
      expect(mockUpdateSetting).toHaveBeenCalledWith("hostIdentity", {
        icon: "🧡",
      }),
    );
  });

  it("clears the server-owned marker", async () => {
    hookState.settings = {
      ...hookState.settings,
      hostIdentity: { icon: "💻" },
    };
    render(<RemoteAccessSettings />);

    fireEvent.click(screen.getByRole("button", { name: "hostIdentityClear" }));

    await waitFor(() =>
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        "hostIdentity",
        undefined,
      ),
    );
  });
});
