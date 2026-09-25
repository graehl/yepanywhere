/**
 * Incremental find over the text a document renders, scoped to one root.
 *
 * YA viewers use it directly on their own content and on same-origin preview
 * frames; the artifact-frame agent bundles the same module to answer find
 * requests inside a cross-origin frame. Matches are painted with the CSS
 * Custom Highlight API, so the searched document is never mutated; browsers
 * without it get the current match as the selection instead.
 */

export interface FindCounts {
  /** Matches found, at most FIND_MATCH_LIMIT. */
  total: number;
  /** One-based index of the current match; 0 when there is none. */
  current: number;
  /** True when counting stopped at FIND_MATCH_LIMIT. */
  capped: boolean;
}

export interface DocumentFinder {
  /** Search for `query`, keeping the current match when it still matches. */
  find(query: string): FindCounts;
  /** Move to the next (1) or previous (-1) match, wrapping around. */
  step(direction: 1 | -1): FindCounts;
  /** Remove highlights and forget the matches. */
  clear(): void;
}

export interface DocumentFinderOptions {
  /** Add the highlight colors to the searched document itself. */
  injectHighlightStyle?: boolean;
}

export const FIND_MATCH_LIMIT = 5000;
export const FIND_HIGHLIGHT = "yep-find";
export const FIND_CURRENT_HIGHLIGHT = "yep-find-current";
const STYLE_ID = "yep-find-highlight-style";
const HIGHLIGHT_CSS = `::highlight(${FIND_HIGHLIGHT}){background-color:rgba(255,212,0,.5);color:inherit}::highlight(${FIND_CURRENT_HIGHLIGHT}){background-color:#ff9632;color:#000}`;
const SKIPPED = "script,style,noscript,template,textarea,select";
// Text in different block elements is joined with a separator so a match
// cannot span, say, the end of one paragraph and the start of the next.
const INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "CITE",
  "CODE",
  "DATA",
  "DEL",
  "DFN",
  "EM",
  "FONT",
  "I",
  "INS",
  "KBD",
  "LABEL",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
]);
const EMPTY: FindCounts = { total: 0, current: 0, capped: false };

/** The highlight members of a (possibly frame's) window, absent in old browsers. */
type HighlightWindow = {
  CSS?: { highlights?: HighlightRegistry };
  Highlight?: typeof Highlight;
};

function highlightWindow(doc: Document): HighlightWindow | null {
  return doc.defaultView as HighlightWindow | null;
}

interface TextIndex {
  nodes: Text[];
  /** Offset of each node's first character in `text`. */
  starts: number[];
  text: string;
}

/** Lowercase without changing length, so offsets stay valid. */
function foldCase(value: string): string {
  const lower = value.toLowerCase();
  if (lower.length === value.length) return lower;
  let folded = "";
  for (const char of value) {
    const next = char.toLowerCase();
    folded += next.length === char.length ? next : char;
  }
  return folded;
}

function queryPattern(query: string, caseSensitive: boolean): RegExp {
  const source = (caseSensitive ? query : foldCase(query))
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(source, "g");
}

function blockOf(element: Element): Element {
  let block = element;
  while (INLINE_TAGS.has(block.tagName) && block.parentElement)
    block = block.parentElement;
  return block;
}

function indexText(root: Node, doc: Document): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  const visible = new Map<Element, boolean>();
  let length = 0;
  let previousBlock: Element | null = null;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || !text.data || parent.closest(SKIPPED)) continue;
    const block = blockOf(parent);
    let shown = visible.get(block);
    if (shown === undefined) {
      shown =
        typeof block.checkVisibility === "function"
          ? block.checkVisibility({ visibilityProperty: true })
          : true;
      visible.set(block, shown);
    }
    if (!shown) continue;
    if (previousBlock && previousBlock !== block) {
      parts.push("\n");
      length += 1;
    }
    previousBlock = block;
    nodes.push(text);
    starts.push(length);
    parts.push(text.data);
    length += text.data.length;
  }
  return { nodes, starts, text: parts.join("") };
}

/** The node holding offset `at`; a separator maps to the next node's start. */
function locate(index: TextIndex, at: number, end: boolean): [Text, number] {
  let low = 0;
  let high = index.nodes.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (index.starts[middle]! <= (end ? at - 1 : at)) low = middle;
    else high = middle - 1;
  }
  const node = index.nodes[low]!;
  const offset = Math.min(
    Math.max(at - index.starts[low]!, 0),
    node.data.length,
  );
  return [node, offset];
}

function scrollParent(element: Element, doc: Document): Element {
  const view = doc.defaultView;
  for (
    let current = element.parentElement;
    current && view;
    current = current.parentElement
  ) {
    const style = view.getComputedStyle(current);
    if (
      /(auto|scroll)/.test(style.overflowY + style.overflowX) &&
      (current.scrollHeight > current.clientHeight ||
        current.scrollWidth > current.clientWidth)
    )
      return current;
  }
  return doc.scrollingElement ?? doc.documentElement;
}

/** Scroll the match into view only when it is not already fully visible. */
function reveal(range: Range, doc: Document): void {
  const anchor =
    range.startContainer.parentElement ?? (range.startContainer as Element);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    anchor.scrollIntoView?.({ block: "center", inline: "nearest" });
    return;
  }
  const container = scrollParent(anchor, doc);
  const isPage =
    container === doc.scrollingElement || container === doc.documentElement;
  const view = isPage
    ? {
        top: 0,
        left: 0,
        bottom: doc.defaultView?.innerHeight ?? 0,
        right: doc.defaultView?.innerWidth ?? 0,
      }
    : container.getBoundingClientRect();
  if (rect.top < view.top || rect.bottom > view.bottom)
    container.scrollTop +=
      (rect.top + rect.bottom) / 2 - (view.top + view.bottom) / 2;
  if (rect.left < view.left || rect.right > view.right)
    container.scrollLeft +=
      (rect.left + rect.right) / 2 - (view.left + view.right) / 2;
}

export function createDocumentFinder(
  root: Node,
  options: DocumentFinderOptions = {},
): DocumentFinder {
  const doc =
    root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document);
  let matches: Range[] = [];
  let starts: number[] = [];
  let current = -1;
  let anchor = -1;
  let capped = false;
  let selected = false;

  const counts = (): FindCounts => ({
    total: matches.length,
    current: current + 1,
    capped,
  });

  const paint = () => {
    const view = highlightWindow(doc);
    const registry = view?.CSS?.highlights;
    if (registry && view?.Highlight) {
      if (options.injectHighlightStyle && !doc.getElementById(STYLE_ID)) {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = HIGHLIGHT_CSS;
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      registry.set(FIND_HIGHLIGHT, new view.Highlight(...matches));
      const focus = new view.Highlight(
        ...(current >= 0 ? [matches[current]!] : []),
      );
      focus.priority = 1;
      registry.set(FIND_CURRENT_HIGHLIGHT, focus);
    } else if (current >= 0) {
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(matches[current]!.cloneRange());
      selected = true;
    }
    if (current >= 0) reveal(matches[current]!, doc);
  };

  const clear = () => {
    const registry = highlightWindow(doc)?.CSS?.highlights;
    registry?.delete(FIND_HIGHLIGHT);
    registry?.delete(FIND_CURRENT_HIGHLIGHT);
    if (selected) doc.getSelection()?.removeAllRanges();
    selected = false;
    matches = [];
    starts = [];
    current = -1;
    anchor = -1;
    capped = false;
  };

  const find = (query: string): FindCounts => {
    if (!query.trim()) {
      clear();
      return EMPTY;
    }
    const caseSensitive = query !== query.toLowerCase();
    const index = indexText(root, doc);
    const haystack = caseSensitive ? index.text : foldCase(index.text);
    const pattern = queryPattern(query, caseSensitive);
    const found: Range[] = [];
    const foundStarts: number[] = [];
    capped = false;
    for (
      let match = pattern.exec(haystack);
      match;
      match = pattern.exec(haystack)
    ) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (found.length === FIND_MATCH_LIMIT) {
        capped = true;
        break;
      }
      const range = doc.createRange();
      const [startNode, startOffset] = locate(index, match.index, false);
      const [endNode, endOffset] = locate(
        index,
        match.index + match[0].length,
        true,
      );
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      found.push(range);
      foundStarts.push(match.index);
    }
    matches = found;
    starts = foundStarts;
    // Isearch keeps its place: extending the query stays on the current
    // match while it still matches, else moves to the next one after it.
    const from = anchor >= 0 ? anchor : 0;
    const next = starts.findIndex((start) => start >= from);
    current = matches.length ? (next >= 0 ? next : 0) : -1;
    anchor = current >= 0 ? starts[current]! : anchor;
    paint();
    return counts();
  };

  const step = (direction: 1 | -1): FindCounts => {
    if (!matches.length) return counts();
    current = (current + direction + matches.length) % matches.length;
    anchor = starts[current]!;
    paint();
    return counts();
  };

  return { find, step, clear };
}

export type FindShortcut = "open" | "next" | "previous";

/**
 * The find keys a viewer honours while its content has focus: Ctrl/Cmd+F
 * opens find, and Ctrl/Cmd+G or F3 (with Shift for previous) step through
 * matches, as browsers do.
 */
export function findShortcut(event: KeyboardEvent): FindShortcut | null {
  if (event.altKey || event.isComposing) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && !event.shiftKey && key === "f") return "open";
  if ((mod && key === "g") || event.key === "F3")
    return event.shiftKey ? "previous" : "next";
  return null;
}
