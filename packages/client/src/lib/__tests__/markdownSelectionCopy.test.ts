import { describe, expect, it } from "vitest";
import {
  extractMarkdownSnippetsFromSelection,
  getMarkdownForVisibleSelection,
  getMarkdownSnippetForSubElement,
  registerMarkdownCopySource,
} from "../markdownSelectionCopy";

describe("getMarkdownForVisibleSelection", () => {
  it("preserves original ordered-list markers for rendered selections", () => {
    expect(
      getMarkdownForVisibleSelection(
        "1. First item\n1. Second item",
        "First item\nSecond item",
      ),
    ).toBe("1. First item\n1. Second item");
  });

  it("uses the source numbering when copied browser text was renumbered", () => {
    expect(
      getMarkdownForVisibleSelection(
        "1. First item\n1. Second item",
        "1. First item\n2. Second item",
      ),
    ).toBe("1. First item\n1. Second item");
  });

  it("uses rendered prefix context to pick repeated list items", () => {
    expect(
      getMarkdownForVisibleSelection("1. Same\n2. Same", "Same", {
        textBefore: "Same\n",
      }),
    ).toBe("2. Same");
  });

  it("keeps plain partial selections narrow", () => {
    expect(getMarkdownForVisibleSelection("alpha beta gamma", "beta")).toBe(
      "beta",
    );
  });

  it("preserves exact source-mode selections", () => {
    expect(
      getMarkdownForVisibleSelection("The **bold** word", "**bold**", {
        preferExactSource: true,
      }),
    ).toBe("**bold**");
  });
});

describe("extractMarkdownSnippetsFromSelection", () => {
  it("returns per-source markdown snippets for a covered selection", () => {
    const root = document.createElement("div");
    const source = document.createElement("div");
    source.textContent = "First item";
    root.append(source);
    document.body.append(root);
    const unregister = registerMarkdownCopySource(
      source,
      "1. First item\n1. Second item",
    );

    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(extractMarkdownSnippetsFromSelection(root)).toMatchObject([
      {
        markdown: "1. First item",
        selectedText: "First item",
        sourceElement: source,
      },
    ]);

    selection?.removeAllRanges();
    unregister();
    root.remove();
  });

  it("splits a selection across eligible regions and skips separators", () => {
    const root = document.createElement("div");
    const firstSource = document.createElement("span");
    const separator = document.createElement("span");
    const secondSource = document.createElement("span");
    firstSource.textContent = "first quote";
    separator.textContent = " local chrome ";
    secondSource.textContent = "second quote";
    root.append(firstSource, separator, secondSource);
    document.body.append(root);
    const unregisterFirst = registerMarkdownCopySource(
      firstSource,
      "first quote",
    );
    const unregisterSecond = registerMarkdownCopySource(
      secondSource,
      "second quote",
    );

    const range = document.createRange();
    range.setStart(firstSource.firstChild as Node, 0);
    range.setEnd(secondSource.firstChild as Node, "second quote".length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(extractMarkdownSnippetsFromSelection(root)).toMatchObject([
      {
        markdown: "first quote",
        selectedText: "first quote",
        sourceElement: firstSource,
      },
      {
        markdown: "second quote",
        selectedText: "second quote",
        sourceElement: secondSource,
      },
    ]);

    selection?.removeAllRanges();
    unregisterFirst();
    unregisterSecond();
    root.remove();
  });
});

describe("getMarkdownSnippetForSubElement", () => {
  it("recovers markdown for one paragraph of a multi-paragraph source", () => {
    const root = document.createElement("div");
    const content = document.createElement("div");
    const p1 = document.createElement("p");
    p1.textContent = "First paragraph.";
    const p2 = document.createElement("p");
    p2.textContent = "Second paragraph.";
    content.append(p1, p2);
    root.append(content);
    document.body.append(root);
    const unregister = registerMarkdownCopySource(
      content,
      "First paragraph.\n\nSecond paragraph.",
    );

    const snippet = getMarkdownSnippetForSubElement(content, p2);
    expect(snippet?.markdown).toBe("Second paragraph.");
    expect(snippet?.selectedText).toContain("Second paragraph.");
    expect(snippet?.sourceElement).toBe(content);
    expect(snippet?.range.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(snippet?.range.endContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(snippet?.range.toString()).toBe("Second paragraph.");

    unregister();
    root.remove();
  });

  it("returns null for an unregistered source element", () => {
    const content = document.createElement("div");
    const p = document.createElement("p");
    p.textContent = "Orphan paragraph.";
    content.append(p);
    expect(getMarkdownSnippetForSubElement(content, p)).toBeNull();
  });
});
