import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FixedFontMathToggle,
  mayHaveFixedFontRichContent,
  renderFixedFontMath,
  renderFixedFontRichContent,
} from "../FixedFontMathToggle";

describe("FixedFontMathToggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses a precomputed render result for toggle state and display", () => {
    render(
      <FixedFontMathToggle
        sourceText="plain text"
        precomputedRendered={{
          html: "<strong>precomputed</strong>",
          changed: true,
        }}
        sourceView={<pre>plain text</pre>}
        renderRenderedView={(html) => (
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: test-controlled precomputed HTML
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      />,
    );

    expect(screen.getByText("precomputed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show source" })).toBeTruthy();
  });
});

describe("fixed-font LaTeX delimiters", () => {
  const bracketedMath = [
    "Let \\(R=\\max S_{\\text{read}}\\).",
    "",
    "\\[",
    "(R+1)+(L-1-W)",
    "\\]",
  ].join("\n");

  it("renders bracketed inline and display math in math-only mode", () => {
    const rendered = renderFixedFontMath(bracketedMath);

    expect(rendered.changed).toBe(true);
    expect(rendered.html).toContain('class="katex"');
    expect(rendered.html).toContain('class="katex-display"');
    expect(rendered.html).not.toContain("\\(R=");
    expect(rendered.html).not.toContain("\\[");
  });

  it("renders multiline bracketed display math in rich mode", () => {
    const rendered = renderFixedFontRichContent(bracketedMath);

    expect(rendered.changed).toBe(true);
    expect(rendered.html).toContain('class="katex-display"');
    expect(rendered.html).not.toContain("\\[");
    expect(rendered.html).not.toContain("\\]");
  });

  it("does not treat escaped or unclosed bracket delimiters as math", () => {
    expect(renderFixedFontMath(String.raw`literal \\(x\\)`)).toMatchObject({
      changed: false,
    });
    expect(renderFixedFontMath(String.raw`unclosed \(x`)).toMatchObject({
      changed: false,
    });
    expect(renderFixedFontMath("\\[\n\n\\]")).toMatchObject({
      changed: false,
    });
  });
});

describe("mayHaveFixedFontRichContent", () => {
  it("rejects plain output without running the rich renderer", () => {
    expect(mayHaveFixedFontRichContent("plain output\nwithout markup")).toBe(
      false,
    );
  });

  it("accepts common markdown and math candidates conservatively", () => {
    expect(mayHaveFixedFontRichContent("## Heading")).toBe(true);
    expect(mayHaveFixedFontRichContent("value is $x^2$")).toBe(true);
    expect(mayHaveFixedFontRichContent("value is \\(x^2\\)")).toBe(true);
    expect(mayHaveFixedFontRichContent("\\[\nx^2\n\\]")).toBe(true);
    expect(mayHaveFixedFontRichContent("| a | b |\n| - | - |")).toBe(true);
  });
});
