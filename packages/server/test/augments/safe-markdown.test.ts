import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "../../src/augments/safe-markdown.js";

describe("renderSafeMarkdown — math", () => {
  it("renders inline $…$ through katex", () => {
    const html = renderSafeMarkdown("price: $x^2 + 1$ end");
    // placeholder is substituted with katex HTML
    expect(html).not.toContain("yepkatex-placeholder");
    expect(html).toContain('class="katex"');
    expect(html).toContain("end</p>");
  });

  it("renders block $$…$$ in display mode", () => {
    const html = renderSafeMarkdown("$$\n\\frac{1}{2}\n$$");
    expect(html).toContain("katex-display");
    expect(html).not.toContain("yepkatex-placeholder");
  });

  it("does not treat currency-like $100 and $200 as math", () => {
    const html = renderSafeMarkdown("price is $100 and $200 total");
    expect(html).not.toContain("katex");
    expect(html).toContain("$100");
    expect(html).toContain("$200");
  });

  it("does not treat $ with trailing space as inline math", () => {
    const html = renderSafeMarkdown("single dollar $ followed by text$");
    expect(html).not.toContain("katex");
  });

  it("escapes katex-invalid input as an error span rather than crashing", () => {
    const html = renderSafeMarkdown("bad: $\\undefinedmacro{x}$ done");
    // katex prints the error span itself (has class "katex-error") when
    // throwOnError: false; our sanitize pass strips style attrs it
    // disallows but keeps span+class.
    expect(html).toContain("done");
  });

  it("blocks javascript: hrefs in katex \\href (trust: false)", () => {
    // If trust were left enabled, \href could emit a dangerous link.
    const html = renderSafeMarkdown("$\\href{javascript:alert(1)}{x}$");
    // The rendered output must not produce an executable link href.
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("still renders non-math markdown unchanged", () => {
    const html = renderSafeMarkdown("**bold** and `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("strips inline HTML in surrounding prose", () => {
    const html = renderSafeMarkdown("plain <script>bad()</script> $y$ end");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="katex"');
  });

  it("handles multiple inline math spans in a single call", () => {
    const html = renderSafeMarkdown("$a$ and $b$ and $c$");
    // three independent katex renders
    const count = (html.match(/class="katex"/g) ?? []).length;
    expect(count).toBe(3);
  });
});
