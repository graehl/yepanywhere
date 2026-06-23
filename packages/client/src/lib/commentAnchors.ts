import type { MarkdownSelectionSnippet } from "./markdownSelectionCopy";
import { generateUUID } from "./uuid";

export interface CommentAnchor {
  id: string;
  sourceElement: HTMLElement;
  range: Range;
  quotedText: string;
  lineSignatures: string[];
}

export function quoteMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function createCommentAnchor(
  snippet: MarkdownSelectionSnippet,
): CommentAnchor {
  return {
    id: generateUUID(),
    sourceElement: snippet.sourceElement,
    range: snippet.range,
    quotedText: quoteMarkdown(snippet.markdown),
    lineSignatures: getQuoteLineSignatures(snippet.markdown),
  };
}

export function draftContainsAnchorQuote(
  draft: string,
  anchor: CommentAnchor,
): boolean {
  if (anchor.lineSignatures.length === 0) {
    return false;
  }
  const draftSignatures = new Set(
    draft
      .split("\n")
      .filter((line) => /^>\s?/.test(line))
      .map(normalizeQuoteLineSignature)
      .filter(Boolean),
  );
  return anchor.lineSignatures.some((signature) =>
    draftSignatures.has(signature),
  );
}

function getQuoteLineSignatures(markdown: string): string[] {
  return markdown.split("\n").map(normalizeQuoteLineSignature).filter(Boolean);
}

function normalizeQuoteLineSignature(line: string): string {
  return line.replace(/^>\s?/, "").replace(/\s+/g, " ").trim();
}
