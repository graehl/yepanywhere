// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarSettings } from "../ToolbarSettings";

const state = vi.hoisted(() => {
  const defaultVisibility = {
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
  };
  const defaultPriority = {
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
  };
  return {
    defaultPriority,
    defaultVisibility,
    version: { capabilities: [] as string[] },
    visibility: { ...defaultVisibility },
    priority: { ...defaultPriority },
  };
});

vi.mock("../../../components/SessionToolbarPreview", () => ({
  SessionToolbarPreview: () => <div data-testid="toolbar-preview" />,
  ToolbarControlPreview: ({
    activationLabel,
    controlKey,
    onActivate,
  }: {
    activationLabel?: string;
    controlKey: string;
    onActivate?: () => void;
  }) => (
    <button
      type="button"
      data-testid={`toolbar-control-preview-${controlKey}`}
      aria-label={activationLabel}
      onClick={onActivate}
    >
      {controlKey}
    </button>
  ),
}));

vi.mock("../../../hooks/useSessionToolbarVisibility", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useSessionToolbarVisibility: () => {
      const [, forceRender] = React.useState(0);
      return {
        visibility: state.visibility,
        setControlVisible: (
          key: keyof typeof state.visibility,
          visible: boolean,
        ) => {
          state.visibility = { ...state.visibility, [key]: visible };
          forceRender((value) => value + 1);
        },
        resetVisibility: () => {
          state.visibility = { ...state.defaultVisibility };
          forceRender((value) => value + 1);
        },
      };
    },
  };
});

vi.mock("../../../hooks/useSessionToolbarPriority", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useSessionToolbarPriority: () => {
      const [, forceRender] = React.useState(0);
      return {
        priority: state.priority,
        setControlPriority: (
          key: keyof typeof state.priority,
          value: string,
        ) => {
          state.priority = { ...state.priority, [key]: value };
          forceRender((count) => count + 1);
        },
        resetPriority: () => {
          state.priority = { ...state.defaultPriority };
          forceRender((count) => count + 1);
        },
      };
    },
  };
});

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
    t: (key: string, params?: Record<string, string>) =>
      (
        ({
          appearanceToolbarHiddenHeading: "Hidden",
          appearanceToolbarHiddenDescription: "Off controls",
          appearanceToolbarShownHeading: "Shown",
          appearanceToolbarShownDescription: "On controls",
          appearanceToolbarSideLeft: "Left side",
          appearanceToolbarSideRight: "Right side",
          appearanceToolbarSideNoneHidden: "None hidden",
          appearanceToolbarModeTitle: "Mode Selector",
          appearanceToolbarModeDescription: "Show the permission mode selector",
          appearanceToolbarAttachmentsTitle: "Attachments",
          appearanceToolbarAttachmentsDescription: "Attach files",
          appearanceToolbarSlashTitle: "Slash Menu",
          appearanceToolbarSlashDescription: "Show slash commands",
          appearanceToolbarThinkingTitle: "Thinking Toggle",
          appearanceToolbarThinkingDescription: "Show thinking controls",
          appearanceToolbarRenderModeTitle: "Render Mode",
          appearanceToolbarRenderModeDescription: "Show rendered/source toggle",
          appearanceToolbarMicrophoneTitle: "Microphone",
          appearanceToolbarMicrophoneDescription: "Show microphone",
          appearanceToolbarWaveformTitle: "Live Microphone Waveform",
          appearanceToolbarWaveformDescription: "Show waveform",
          appearanceToolbarShortcutsTitle: "Shortcuts Help",
          appearanceToolbarShortcutsDescription: "Show shortcuts",
          appearanceToolbarContextTitle: "Context Usage",
          appearanceToolbarContextDescription: "Show context usage",
          appearanceToolbarBtwTitle: "/btw Button",
          appearanceToolbarBtwDescription: "Show /btw",
          appearanceToolbarNudgeTitle: "Heartbeat/Nudge Button",
          appearanceToolbarNudgeDescription: "Show nudge",
          appearanceToolbarStatusTitle: "Session Status",
          appearanceToolbarStatusDescription: "Show status",
          appearanceToolbarSteerNowTitle: '"Now" steering selector',
          appearanceToolbarSteerNowDescription: "Show now selector",
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
          appearanceToolbarPriorityPin: "Pin",
          appearanceToolbarPriorityLast: "Last",
          appearanceToolbarPriorityMid: "Mid",
          appearanceToolbarPriorityFirst: "First",
          appearanceToolbarPriorityPinTitle: "Never collapses",
          appearanceToolbarPriorityLastTitle: "Collapses last",
          appearanceToolbarPriorityMidTitle: "Collapses in the middle",
          appearanceToolbarPriorityFirstTitle: "Collapses first",
          appearanceToolbarPriorityAria: `${params?.control} collapse priority`,
          appearanceToolbarControlMenu: `${params?.control} toolbar controls`,
          appearanceToolbarActivateControl: `Edit ${params?.control}`,
          appearanceToolbarShowControl: `Show ${params?.control}`,
          appearanceToolbarShow: "Show",
          appearanceSessionToolbarReset: "Reset",
          appearanceToolbarHide: "Hide",
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
    state.visibility = { ...state.defaultVisibility };
    state.priority = { ...state.defaultPriority };
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

  it("shows priority radios for controls the overflow engine supports", () => {
    render(<ToolbarSettings />);

    expect(screen.getAllByRole("radiogroup")).toHaveLength(11);
    expect(screen.getAllByRole("radio")).toHaveLength(44);
  });

  it("keeps hidden overflow controls priority-editable", () => {
    render(<ToolbarSettings />);

    const row = screen
      .getByText("Render Mode")
      .closest(".session-toolbar-control-row");
    expect(row).toBeTruthy();
    expect(
      within(row as HTMLElement).getByRole("radiogroup", {
        name: "Render Mode collapse priority",
      }),
    ).toBeTruthy();
    expect(
      within(row as HTMLElement).getByRole("button", {
        name: "Show Render Mode",
      }),
    ).toBeTruthy();
  });

  it("opens row controls from the specimen affordance", () => {
    render(<ToolbarSettings />);

    fireEvent.click(screen.getByTestId("toolbar-control-preview-modeSelector"));

    const dialog = screen.getByRole("dialog", {
      name: "Mode Selector toolbar controls",
    });
    expect(within(dialog).getByRole("button", { name: "Hide" })).toBeTruthy();
    expect(
      within(dialog).getByRole("radiogroup", {
        name: "Mode Selector collapse priority",
      }),
    ).toBeTruthy();
  });

  it("keeps rows in their entry section after visibility changes", () => {
    render(<ToolbarSettings />);

    const shownZone = screen
      .getByText("Shown")
      .closest(".session-toolbar-zone");
    const hiddenZone = screen
      .getByText("Hidden")
      .closest(".session-toolbar-zone");
    expect(shownZone).toBeTruthy();
    expect(hiddenZone).toBeTruthy();

    const modeRow = within(shownZone as HTMLElement)
      .getByText("Mode Selector")
      .closest(".session-toolbar-control-row");
    expect(modeRow).toBeTruthy();

    fireEvent.click(
      within(modeRow as HTMLElement).getByRole("button", { name: "Hide" }),
    );

    expect(
      within(shownZone as HTMLElement).getByText("Mode Selector"),
    ).toBeTruthy();
    expect(
      within(modeRow as HTMLElement).getByRole("button", {
        name: "Show Mode Selector",
      }),
    ).toBeTruthy();
    expect(
      within(hiddenZone as HTMLElement).queryByText("Mode Selector"),
    ).toBeNull();
  });
});
