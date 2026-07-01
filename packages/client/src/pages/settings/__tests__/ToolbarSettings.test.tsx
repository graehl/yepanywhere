// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarSettings } from "../ToolbarSettings";

const state = vi.hoisted(() => ({
  version: { capabilities: [] as string[] },
}));

vi.mock("../../../components/SessionToolbarPreview", () => ({
  SessionToolbarPreview: () => <div data-testid="toolbar-preview" />,
  ToolbarControlPreview: () => <div data-testid="toolbar-control-preview" />,
}));

vi.mock("../../../hooks/useSessionToolbarVisibility", () => ({
  useSessionToolbarVisibility: () => ({
    visibility: {
      modeSelector: true,
      steerNow: true,
      attachments: true,
      slashMenu: true,
      thinkingToggle: true,
      renderMode: false,
      microphone: true,
      waveform: true,
      shortcutsHelp: true,
      contextUsage: true,
      btw: false,
      nudge: false,
      sessionStatus: true,
      projectQueue: true,
    },
    setControlVisible: vi.fn(),
    resetVisibility: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useSessionToolbarPriority", () => ({
  useSessionToolbarPriority: () => ({
    priority: {
      modeSelector: "first",
      steerNow: "pin",
      attachments: "first",
      slashMenu: "mid",
      thinkingToggle: "mid",
      renderMode: "last",
      microphone: "pin",
      waveform: "pin",
      shortcutsHelp: "last",
      contextUsage: "pin",
      btw: "pin",
      nudge: "last",
      sessionStatus: "pin",
      projectQueue: "pin",
    },
    setControlPriority: vi.fn(),
    resetPriority: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: { clientDefaults: {} },
    error: null,
    updateSettings: vi.fn(async () => ({ settings: {} })),
  }),
}));

vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: state.version,
  }),
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      (
        ({
          appearanceToolbarProjectQueueTitle: "Project Queue",
          appearanceToolbarProjectQueueDescription:
            "Send after all sessions in this project are idle",
          appearanceSessionToolbarDescription: "Toolbar controls",
          appearanceToolbarDefaultActionTitle: "Default action",
          appearanceToolbarDefaultActionDescription: "Choose an action",
          appearanceToolbarDefaultActionSteer: "Steer",
          appearanceToolbarDefaultActionQueue: "Queue",
          appearanceToolbarCollapsedButtonTitle: "Collapsed button",
          appearanceToolbarCollapsedButtonDescription: "Choose a button",
          appearanceToolbarCollapsedButtonPrimary: "Primary",
          appearanceToolbarCollapsedButtonAlternate: "Alternate",
          appearanceToolbarCollapsedButtonMicrophone: "Microphone",
          appearanceSessionToolbarReset: "Reset",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock("../SettingsPaneTitleContext", () => ({
  useSettingsPaneTitle: vi.fn(),
}));

vi.mock("../SettingsUndoContext", () => ({
  useSettingsUndoBaseline: vi.fn(),
}));

describe("ToolbarSettings", () => {
  beforeEach(() => {
    state.version = { capabilities: [] };
  });

  afterEach(() => {
    cleanup();
  });

  it("hides the Project Queue option without server capability", () => {
    render(<ToolbarSettings />);

    expect(screen.queryByText("Project Queue")).toBe(null);
  });

  it("shows the Project Queue option with server capability", () => {
    state.version = { capabilities: ["projectQueue"] };

    render(<ToolbarSettings />);

    expect(screen.getByText("Project Queue")).toBeTruthy();
  });
});
