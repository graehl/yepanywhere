import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "../MarkdownPreview";

describe("MarkdownPreview", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the light copy palette only for native serialization", () => {
    vi.useFakeTimers();
    render(<MarkdownPreview html="<table><tr><th>Header</th></tr></table>" />);
    const preview = screen.getByRole("region", { name: "Markdown preview" });

    fireEvent.copy(preview);
    expect(preview.classList.contains("markdown-preview-copy-light")).toBe(
      true,
    );

    vi.runOnlyPendingTimers();
    expect(preview.classList.contains("markdown-preview-copy-light")).toBe(
      false,
    );
  });
});
