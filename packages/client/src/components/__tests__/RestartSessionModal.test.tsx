// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestartSessionModal } from "../RestartSessionModal";

const { mockRestartSession, serverSettingsState } = vi.hoisted(() => ({
  mockRestartSession: vi.fn(),
  serverSettingsState: {
    settings: null as {
      newSessionDefaults?: {
        provider?: "codex";
        model?: string;
        permissionMode?: "default";
      };
    } | null,
    isLoading: false,
  },
}));

vi.mock("../../api/client", () => ({
  api: {
    restartSession: mockRestartSession,
  },
}));

vi.mock("../../hooks/useModelSettings", () => ({
  getModelSetting: () => "default",
}));

vi.mock("../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: serverSettingsState.settings,
    isLoading: serverSettingsState.isLoading,
    error: null,
    updateSettings: vi.fn(),
    updateSetting: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.level ? `${key}:${params.level}` : key,
  }),
}));

describe("RestartSessionModal", () => {
  beforeEach(() => {
    serverSettingsState.settings = {
      newSessionDefaults: {
        provider: "codex",
        model: "gpt-5.5",
        permissionMode: "default",
      },
    };
    serverSettingsState.isLoading = false;
    mockRestartSession.mockResolvedValue({
      sessionId: "sess-new",
      processId: "proc-new",
      model: "gpt-5.5",
      oldProcessAborted: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses saved new-session model defaults for handoff", async () => {
    render(
      <RestartSessionModal
        projectId="proj-1"
        sessionId="sess-1"
        provider="codex"
        models={[
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "gpt-5.5", name: "GPT-5.5" },
        ]}
        currentModel="gpt-5.4"
        mode="default"
        thinking="off"
        onRestarted={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "sessionRestartStart" }));

    await waitFor(() => {
      expect(mockRestartSession).toHaveBeenCalledWith(
        "proj-1",
        "sess-1",
        expect.objectContaining({
          provider: "codex",
          model: "gpt-5.5",
        }),
      );
    });
  });
});
