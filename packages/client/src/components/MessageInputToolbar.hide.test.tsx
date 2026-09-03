import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type SessionToolbarVisibility,
  SESSION_TOOLBAR_CONTROL_KEYS,
} from "../hooks/useSessionToolbarPresence";
import {
  MessageInputToolbarView,
  type MessageInputToolbarViewProps,
} from "./MessageInputToolbar";

const hiddenVisibility = Object.fromEntries(
  SESSION_TOOLBAR_CONTROL_KEYS.map((key) => [key, false]),
) as SessionToolbarVisibility;

const t = ((key: string) => {
  const copy: Record<string, string> = {
    appearanceToolbarHide: "Hide",
    toolbarAttachFiles: "Attach files",
    toolbarHideControlMenuAria: "Toolbar control actions",
  };
  return copy[key] ?? key;
}) as unknown as MessageInputToolbarViewProps["t"];

const shortcutsControl: MessageInputToolbarViewProps["shortcutsControl"] = {
  open: false,
  isearchScope: null,
  setOpen: vi.fn(),
  settingsOpen: false,
  setSettingsOpen: vi.fn(),
  hasDualActions: false,
  enterActionKind: "send",
  canSwapEnterAction: false,
  queueShortcutLabel: "Queue",
};

function renderToolbar(overrides: Partial<MessageInputToolbarViewProps> = {}) {
  return render(
    <MessageInputToolbarView
      t={t}
      visibility={{ ...hiddenVisibility, attachments: true }}
      attachmentControl={{
        canAttach: true,
        attachmentCount: 0,
        onAttachClick: vi.fn(),
      }}
      shortcutsControl={shortcutsControl}
      actionsControl={{}}
      {...overrides}
    />,
  );
}

describe("MessageInputToolbar quick hide", () => {
  it("offers Hide beside a regular control hint on right-click", () => {
    const onHideControl = vi.fn();
    renderToolbar({ onHideControl });

    fireEvent.contextMenu(screen.getByTitle("Attach files"));

    expect(
      screen.getByRole("dialog", { name: "Toolbar control actions" })
        .textContent,
    ).toContain("Attach files");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHideControl).toHaveBeenCalledWith("attachments");
  });

  it("leaves a specialized desktop context action unchanged", () => {
    const onHideControl = vi.fn();
    const onContextMenu = vi.fn((event) => event.preventDefault());
    renderToolbar({
      visibility: { ...hiddenVisibility, nudge: true },
      onHideControl,
      nudgeControl: {
        enabled: false,
        title: "Configure heartbeat",
        onClick: vi.fn(),
        onContextMenu,
        onTouchStart: vi.fn(),
        onTouchEnd: vi.fn(),
        onClearTouch: vi.fn(),
      },
    });

    fireEvent.contextMenu(screen.getByTitle("Configure heartbeat"));

    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onHideControl).not.toHaveBeenCalled();
  });

  it("adds Hide to a specialized mobile long-press", () => {
    const onHideControl = vi.fn();
    const onContextMenu = vi.fn((event) => event.preventDefault());
    renderToolbar({
      visibility: { ...hiddenVisibility, nudge: true },
      onHideControl,
      nudgeControl: {
        enabled: false,
        title: "Configure heartbeat",
        onClick: vi.fn(),
        onContextMenu,
        onTouchStart: vi.fn(),
        onTouchEnd: vi.fn(),
        onClearTouch: vi.fn(),
      },
    });
    const button = screen.getByTitle("Configure heartbeat");

    fireEvent.touchStart(button);
    fireEvent.contextMenu(button);

    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("dialog", { name: "Toolbar control actions" })
        .textContent,
    ).toContain("Configure heartbeat");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHideControl).toHaveBeenCalledWith("nudge");
  });
});
