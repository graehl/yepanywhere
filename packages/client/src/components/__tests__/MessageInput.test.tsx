// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ComponentProps, useCallback, useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_ISEARCH_GUIDE_EVENT } from "../../lib/sessionIsearchGuide";
import { MessageInput } from "../MessageInput";

vi.mock("../../hooks/useDraftPersistence", () => ({
  useDraftPersistence: () => {
    const [value, setValue] = useState("");
    const setDraft = useCallback((nextValue: string) => setValue(nextValue), []);
    const flushDraft = useCallback(() => {}, []);
    const clearInput = useCallback(() => setValue(""), []);
    const clearDraft = useCallback(() => setValue(""), []);
    const restoreFromStorage = useCallback(() => {}, []);

    const controls = useMemo(
      () => ({
        setDraft,
        flushDraft,
        clearInput,
        clearDraft,
        restoreFromStorage,
      }),
      [setDraft, flushDraft, clearInput, clearDraft, restoreFromStorage],
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
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../VoiceInputButton", async () => {
  const React = await import("react");

  return {
    VoiceInputButton: React.forwardRef((_, ref) => {
      React.useImperativeHandle(ref, () => ({
        stopAndFinalize: () => "",
        toggle: vi.fn(),
        isAvailable: true,
        isListening: false,
      }));

      return <button type="button">voice</button>;
    }),
  };
});

function renderMessageInput(
  onRecallLastSubmission = vi.fn(() => true),
  extraProps: Partial<ComponentProps<typeof MessageInput>> = {},
) {
  const placeholder = extraProps.placeholder ?? "Message";
  render(
    <MessageInput
      onSend={vi.fn()}
      draftKey="test-draft"
      placeholder={placeholder}
      supportsPermissionMode={false}
      supportsThinkingToggle={false}
      onRecallLastSubmission={onRecallLastSubmission}
      {...extraProps}
    />,
  );

  return screen.getByPlaceholderText(
    extraProps.collapsed ? "messageInputContinueAbove" : placeholder,
  );
}

describe("MessageInput", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recalls the last submission from a blank composer with Up or Ctrl+P", () => {
    const onRecallLastSubmission = vi.fn(() => true);
    const textarea = renderMessageInput(onRecallLastSubmission);

    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    fireEvent.keyDown(textarea, { key: "p", ctrlKey: true });

    expect(onRecallLastSubmission).toHaveBeenCalledTimes(2);
  });

  it("keeps Up as native navigation when the composer has text", () => {
    const onRecallLastSubmission = vi.fn(() => true);
    const textarea = renderMessageInput(onRecallLastSubmission);

    fireEvent.change(textarea, { target: { value: "still editing" } });
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(onRecallLastSubmission).not.toHaveBeenCalled();
  });

  it("recalls with Ctrl+P even when accidental text is present", () => {
    const onRecallLastSubmission = vi.fn(() => true);
    const textarea = renderMessageInput(onRecallLastSubmission);

    fireEvent.change(textarea, { target: { value: "oops" } });
    fireEvent.keyDown(textarea, { key: "p", ctrlKey: true });

    expect(onRecallLastSubmission).toHaveBeenCalledTimes(1);
  });

  it("shows the isearch key guide from the shortcut help while search is active", async () => {
    renderMessageInput();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SESSION_ISEARCH_GUIDE_EVENT, {
          detail: { active: true, scope: "all" },
        }),
      );
    });

    expect(await screen.findByText("Previous match")).toBeTruthy();
    expect(screen.getByText("Cancel / restore focus")).toBeTruthy();
    expect(screen.getByText("User turns")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Session keyboard shortcuts" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SESSION_ISEARCH_GUIDE_EVENT, {
          detail: { active: false, scope: "all" },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Previous match")).toBeNull();
    });
    expect(
      screen
        .getByRole("button", { name: "Session keyboard shortcuts" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("keeps stop available while a running composer has queued text", () => {
    const onStop = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      isRunning: true,
      isThinking: true,
      onQueue: vi.fn(),
      onStop,
    });

    fireEvent.change(textarea, { target: { value: "still editable" } });

    fireEvent.click(screen.getByLabelText("toolbarStop"));

    expect(screen.getByLabelText("toolbarQueueLabel")).toBeTruthy();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("stops the current turn with Escape from the composer", () => {
    const onStop = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      isRunning: true,
      isThinking: true,
      onStop,
    });

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone when the current turn is not stoppable", () => {
    const onStop = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      isRunning: true,
      isThinking: false,
      onStop,
    });

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onStop).not.toHaveBeenCalled();
  });

  it("cancels the newest queued message with Ctrl+K", () => {
    const onCancelLatestDeferred = vi.fn(() => true);
    const textarea = renderMessageInput(vi.fn(() => true), {
      onCancelLatestDeferred,
    });

    fireEvent.keyDown(textarea, { key: "k", ctrlKey: true });

    expect(onCancelLatestDeferred).toHaveBeenCalledTimes(1);
  });

  it("clears the composer with Ctrl+G through the textarea undo stack", () => {
    const previousExecCommand = document.execCommand;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const textarea = renderMessageInput();

    try {
      fireEvent.change(textarea, { target: { value: "undoable draft" } });
      fireEvent.keyDown(textarea, { key: "g", ctrlKey: true });

      expect(execCommand).toHaveBeenCalledWith("delete");
      expect((textarea as HTMLTextAreaElement).value).toBe("");
    } finally {
      if (previousExecCommand) {
        Object.defineProperty(document, "execCommand", {
          configurable: true,
          value: previousExecCommand,
        });
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
  });

  it("shows stale last activity in the composer chrome", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T12:06:00.000Z"));

    renderMessageInput(vi.fn(() => true), {
      lastActivityAt: "2026-04-26T12:00:00.000Z",
    });

    expect(screen.getByText("Last activity 6m")).toBeTruthy();
  });

  it("keeps a send affordance visible when the composer is collapsed", () => {
    const onSend = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      onSend,
      collapsed: true,
      placeholder: "messageInputContinueAbove",
    });

    fireEvent.change(textarea, { target: { value: "collapsed send" } });
    fireEvent.click(screen.getByLabelText("toolbarSend"));

    expect(onSend).toHaveBeenCalledWith("collapsed send");
  });

  it("keeps a queue affordance visible when the running composer is collapsed", () => {
    const onQueue = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      onQueue,
      collapsed: true,
      placeholder: "messageInputContinueAbove",
    });

    fireEvent.change(textarea, { target: { value: "collapsed queue" } });
    fireEvent.click(screen.getByLabelText("toolbarQueueLabel"));

    expect(onQueue).toHaveBeenCalledWith("collapsed queue");
  });

  it("keeps queue available when the primary steer action downgrades", () => {
    const onQueue = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      supportsSteering: true,
      onQueue,
      primaryActionKind: "queue",
    });

    fireEvent.change(textarea, { target: { value: "queue fallback" } });
    fireEvent.click(screen.getByLabelText("toolbarQueueLabel"));

    expect(screen.getAllByLabelText("toolbarQueueLabel")).toHaveLength(1);
    expect(onQueue).toHaveBeenCalledWith("queue fallback");
  });

  it("routes the primary downgraded steer action to queue", () => {
    const onQueue = vi.fn();
    const onSend = vi.fn();
    const textarea = renderMessageInput(vi.fn(() => true), {
      onSend,
      supportsSteering: true,
      onQueue,
      primaryActionKind: "queue",
    });

    fireEvent.change(textarea, { target: { value: "queue from primary" } });
    fireEvent.click(screen.getByLabelText("Queue from primary action"));

    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).toHaveBeenCalledWith("queue from primary");
  });
});
