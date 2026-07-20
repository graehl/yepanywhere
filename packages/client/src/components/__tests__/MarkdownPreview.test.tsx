import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "../MarkdownPreview";

describe("MarkdownPreview", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    cleanup();
  });

  it("copies semantic HTML without renderer presentation", () => {
    render(
      <MarkdownPreview
        html={
          '<table class="source-table"><tbody><tr><th style="color: red">Header</th></tr></tbody></table>'
        }
      />,
    );
    const preview = screen.getByRole("region", { name: "Markdown preview" });
    const rendered = preview.querySelector(".markdown-rendered");
    if (!rendered) {
      throw new Error("Expected rendered Markdown content");
    }
    const range = document.createRange();
    range.selectNodeContents(rendered);
    document.getSelection()?.addRange(range);
    const copied = new Map<string, string>();

    fireEvent.copy(rendered, {
      clipboardData: {
        setData: (type: string, value: string) => copied.set(type, value),
      },
    });

    expect(copied.get("text/html")).toBe(
      "<table><tbody><tr><th>Header</th></tr></tbody></table>",
    );
    expect(copied.get("text/plain")).toBe("Header");
  });
});
