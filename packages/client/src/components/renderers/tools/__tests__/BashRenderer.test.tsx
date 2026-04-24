import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bashRenderer } from "../BashRenderer";
import type { BashResult } from "../types";

vi.mock("../../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    enabled: false,
    reportValidationError: vi.fn(),
    isToolIgnored: vi.fn(() => false),
  }),
}));

vi.mock("../../../ui/Modal", () => ({
  Modal: ({
    title,
    children,
  }: {
    title: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{children}</div>
    </div>
  ),
}));

const renderContext = {
  isStreaming: false,
  provider: "codex",
  theme: "dark" as const,
};

describe("BashRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("unwraps exec_command envelopes before rendering ANSI output", () => {
    const output =
      "Chunk ID: ff710e\nWall time: 0.0518 seconds\nProcess exited with code 0\nOutput:\nplain\n\u001b[32mgreen bold\u001b[0m\n";

    const { container } = render(
      <div>
        {bashRenderer.renderCollapsedPreview?.(
          { command: "printf '...'" },
          output as unknown as BashResult,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(container.textContent).not.toContain("Chunk ID:");
    expect(screen.getByText(/plain/)).toBeDefined();

    fireEvent.click(screen.getByRole("button"));

    expect(container.textContent).not.toContain("Chunk ID:");
    expect(container.querySelector(".ansi-fg-green")).not.toBeNull();
  });
});
