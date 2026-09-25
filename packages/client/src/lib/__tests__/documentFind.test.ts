import { createDocumentFinder } from "@yep-anywhere/shared/find/documentFind";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// jsdom has no layout: give ranges the empty box a real browser would
// report for off-screen text, so revealing a match takes its fallback path.
beforeAll(() => {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function selected(): string {
  return document.getSelection()?.toString() ?? "";
}

describe("createDocumentFinder", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
  });

  it("counts matches within its root only, smart-case", () => {
    mount("<p>Alpha outside</p>");
    const root = mount("<p>alpha Alpha</p><p>ALPHA beta</p>");
    const finder = createDocumentFinder(root);
    expect(finder.find("alpha")).toEqual({
      total: 3,
      current: 1,
      capped: false,
    });
    // An uppercase letter makes the search case-sensitive, as in isearch.
    expect(finder.find("Alpha").total).toBe(1);
  });

  it("matches across inline markup and any whitespace, not across blocks", () => {
    const root = mount(
      "<p>find <b>this</b>\n   text</p><p>end</p><p>of line</p>",
    );
    const finder = createDocumentFinder(root);
    expect(finder.find("find this text").total).toBe(1);
    expect(selected()).toBe("find this\n   text");
    expect(finder.find("endof").total).toBe(0);
  });

  it("keeps its place while the query grows, and steps with wrap-around", () => {
    const root = mount("<p>cat car cart cat</p>");
    const finder = createDocumentFinder(root);
    expect(finder.find("ca").total).toBe(4);
    expect(finder.step(1).current).toBe(2);
    // "car" still matches at the current place, so isearch stays there.
    expect(finder.find("car")).toMatchObject({ total: 2, current: 1 });
    expect(finder.find("cart")).toMatchObject({ total: 1, current: 1 });
    expect(selected()).toBe("cart");
    expect(finder.find("ca").current).toBe(3);
    expect(finder.step(1).current).toBe(4);
    expect(finder.step(1).current).toBe(1);
    expect(finder.step(-1).current).toBe(4);
  });

  it("ignores script and style text and clears its selection", () => {
    const root = mount(
      "<style>.needle{}</style><script>needle()</script><p>needle</p>",
    );
    const finder = createDocumentFinder(root);
    expect(finder.find("needle").total).toBe(1);
    finder.clear();
    expect(selected()).toBe("");
    expect(finder.find("   ")).toEqual({
      total: 0,
      current: 0,
      capped: false,
    });
  });
});
