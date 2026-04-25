// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, useCallback, useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageInput } from "../MessageInput";

vi.mock("../../hooks/useDraftPersistence", () => ({
  useDraftPersistence: () => {
    const [value, setValue] = useState("");
    const setDraft = useCallback((nextValue: string) => setValue(nextValue), []);
    const clearInput = useCallback(() => setValue(""), []);
    const clearDraft = useCallback(() => setValue(""), []);
    const restoreFromStorage = useCallback(() => {}, []);

    const controls = useMemo(
      () => ({ setDraft, clearInput, clearDraft, restoreFromStorage }),
      [setDraft, clearInput, clearDraft, restoreFromStorage],
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
  render(
    <MessageInput
      onSend={vi.fn()}
      draftKey="test-draft"
      placeholder="Message"
      supportsPermissionMode={false}
      supportsThinkingToggle={false}
      onRecallLastSubmission={onRecallLastSubmission}
      {...extraProps}
    />,
  );

  return screen.getByPlaceholderText("Message");
}

describe("MessageInput", () => {
  afterEach(() => {
    cleanup();
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
});
