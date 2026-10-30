import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sendMessageRenderer } from "../SendMessageRenderer";

const renderContext = {
  isStreaming: false,
  theme: "dark" as const,
};

function prepared(input: unknown, result: unknown) {
  return sendMessageRenderer.prepare({
    input,
    result,
    status: "complete",
    isError: false,
  });
}

describe("SendMessageRenderer", () => {
  it("shows recipient, summary and message on a completed row", () => {
    const display = prepared(
      {
        to: "a6f0e85da626bfbf7",
        summary: "User clue: focus lost",
        message: "Focus is lost while an agent is active.",
      },
      {
        success: true,
        message: "Message queued for delivery to a6f0e85da626bfbf7",
        pin: { id: "a6f0e85da626bfbf7" },
      },
    );

    expect(display.kind).toBe("rich");
    const { container } = render(display.renderToolResult(renderContext));
    expect(container.textContent).toContain("a6f0e85da626bfbf7");
    expect(container.textContent).toContain("User clue: focus lost");
    expect(container.textContent).toContain(
      "Focus is lost while an agent is active.",
    );
    expect(display.getUseSummary()).toBe(
      "→ a6f0e85da626bfbf7: User clue: focus lost",
    );
    expect(display.getResultSummary()).toBe(
      "→ a6f0e85da626bfbf7: User clue: focus lost",
    );
  });

  it("collapses a long message behind a toggle", () => {
    const message = `${"word ".repeat(100)}TAIL`;
    const display = prepared({ to: "peer", message }, { success: true });

    const { container } = render(display.renderToolResult(renderContext));
    expect(container.textContent).not.toContain("TAIL");
    fireEvent.click(screen.getByText("Show full message"));
    expect(container.textContent).toContain("TAIL");
  });

  it("reports an unreachable recipient", () => {
    const display = prepared(
      { to: "gone", message: "hello" },
      {
        success: false,
        message: "No agent named 'gone' is reachable.",
        display: "Not sent — no agent named 'gone' is reachable.",
      },
    );

    render(display.renderToolResult(renderContext));
    expect(
      screen.getByText("Not sent — no agent named 'gone' is reachable."),
    ).toBeTruthy();
    expect(display.getResultSummary()).toBe("Not sent → gone");
  });
});
