// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCorrectionText } from "../../lib/correctionText";
import type { Message } from "../../types";
import { MessageList } from "../MessageList";

function userMessage(
  uuid: string,
  content: string,
  timestamp?: string,
): Message {
  return {
    type: "user",
    uuid,
    timestamp,
    message: { role: "user", content },
  };
}

function assistantMessage(
  uuid: string,
  content: string,
  timestamp?: string,
): Message {
  return {
    type: "assistant",
    uuid,
    timestamp,
    message: { role: "assistant", content },
  };
}

describe("MessageList", () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers correction only for the latest real user message", () => {
    const onCorrect = vi.fn();

    render(
      <MessageList
        messages={[
          userMessage("user-1", "first request"),
          assistantMessage("assistant-1", "response"),
          userMessage("user-2", "second request"),
        ]}
        onCorrectLatestUserMessage={onCorrect}
      />,
    );

    const buttons = screen.getAllByRole("button", {
      name: "Edit latest message",
    });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0] as HTMLElement);

    expect(onCorrect).toHaveBeenCalledWith("user-2", "second request");
  });

  it("passes display text without uploaded-file metadata to correction", () => {
    const onCorrect = vi.fn();

    render(
      <MessageList
        messages={[
          userMessage(
            "user-1",
            "fix typo\n\nUser uploaded files:\n- notes.txt (12 B, text/plain): /uploads/notes.txt",
          ),
        ]}
        onCorrectLatestUserMessage={onCorrect}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit latest message" }),
    );

    expect(onCorrect).toHaveBeenCalledWith("user-1", "fix typo");
  });

  it("renders correction messages with corrected text as the primary content", () => {
    render(
      <MessageList
        messages={[
          userMessage(
            "user-1",
            buildCorrectionText("(testing)", "(test correction)") ?? "",
          ),
        ]}
      />,
    );

    expect(screen.getByText("Correction")).toBeTruthy();
    expect(screen.getByText("(test correction)")).toBeTruthy();
    expect(
      screen.getByText('Change: replace "testing" with "test correction".'),
    ).toBeTruthy();
  });

  it("marks queued messages that are blocked behind an edit", () => {
    render(
      <MessageList
        messages={[]}
        deferredMessages={[
          {
            tempId: "temp-3",
            content: "third",
            timestamp: "2026-04-25T00:00:00.000Z",
            blockedByEdit: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("Queued (after edit)")).toBeTruthy();
  });

  it("keeps the latest stale message age visible in the right rail", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T12:10:00.000Z"));
    const { container } = render(
      <MessageList
        messages={[
          userMessage(
            "user-1",
            "stale request",
            "2026-04-26T12:00:00.000Z",
          ),
        ]}
      />,
    );

    const row = container.querySelector('[data-render-id="user-1"]');

    expect(row?.classList.contains("has-message-age")).toBe(true);
    expect(row?.classList.contains("is-message-age-visible")).toBe(true);
    expect(row?.querySelector(".message-age")?.textContent).toBe("10m");
  });
});
