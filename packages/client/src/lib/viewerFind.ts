import {
  createDocumentFinder,
  type DocumentFinder,
  type FindCounts,
} from "@yep-anywhere/shared/find/documentFind";
import {
  FIND_PROTOCOL,
  type FindReport,
  type FindRequest,
} from "@yep-anywhere/shared/find/protocol";

/**
 * What a viewer's find field searches. Each viewer names exactly one:
 * - `element`: content rendered in YA's own page (source, text, Markdown);
 * - `frame`: the same-origin scriptless HTML preview, searched directly;
 * - `agent`: an artifact-origin frame, reached through the find agent the
 *   artifact server appends to framed HTML.
 */
export type ViewerFindSource =
  | { kind: "element"; element: HTMLElement }
  | { kind: "frame"; frame: HTMLIFrameElement }
  | { kind: "agent"; frame: HTMLIFrameElement };

export interface ViewerFindTarget {
  find(query: string): Promise<FindCounts>;
  step(direction: 1 | -1): Promise<FindCounts>;
  clear(): void;
  /** Return keyboard focus to the searched content. */
  focusContent(): void;
  /** Selected text in the searched content, to seed a new search. */
  selection(): string;
  /** Deliver a report from the agent frame; other targets ignore it. */
  receive(report: FindReport): void;
}

function localTarget(
  finder: () => DocumentFinder | null,
  focusContent: () => void,
  selection: () => string,
): ViewerFindTarget {
  const run = (search: (finder: DocumentFinder) => FindCounts) => {
    const current = finder();
    return Promise.resolve(
      current ? search(current) : { total: 0, current: 0, capped: false },
    );
  };
  return {
    find: (query) => run((f) => f.find(query)),
    step: (direction) => run((f) => f.step(direction)),
    clear: () => finder()?.clear(),
    focusContent,
    selection,
    receive: () => {},
  };
}

/** The frame's document when it is same-origin and loaded, else null. */
export function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

function agentTarget(frame: HTMLIFrameElement): ViewerFindTarget {
  let seq = 0;
  const pending = new Map<number, (counts: FindCounts) => void>();
  // A frame already removed (the viewer closing) has nothing left to clear.
  const post = (request: FindRequest) => {
    if (frame.isConnected)
      frame.contentWindow?.postMessage(request, new URL(frame.src).origin);
  };
  const ask = (build: (seq: number) => FindRequest) =>
    new Promise<FindCounts>((resolve) => {
      seq += 1;
      pending.set(seq, resolve);
      post(build(seq));
    });
  return {
    find: (query) =>
      ask((id) => ({ protocol: FIND_PROTOCOL, type: "find", seq: id, query })),
    step: (direction) =>
      ask((id) => ({
        protocol: FIND_PROTOCOL,
        type: "step",
        seq: id,
        direction,
      })),
    clear: () => post({ protocol: FIND_PROTOCOL, type: "clear" }),
    focusContent: () => frame.focus(),
    // The agent sends its selection with the open request instead.
    selection: () => "",
    receive: (report) => {
      if (report.type !== "result") return;
      const resolve = pending.get(report.seq);
      pending.delete(report.seq);
      resolve?.({
        total: report.total,
        current: report.current,
        capped: report.capped,
      });
    },
  };
}

export function createViewerFindTarget(
  source: ViewerFindSource,
): ViewerFindTarget {
  if (source.kind === "agent") return agentTarget(source.frame);
  if (source.kind === "element") {
    const { element } = source;
    const finder = createDocumentFinder(element);
    return localTarget(
      () => finder,
      () => element.focus({ preventScroll: true }),
      () => {
        const selection = element.ownerDocument.getSelection();
        return selection?.anchorNode && element.contains(selection.anchorNode)
          ? selection.toString()
          : "";
      },
    );
  }
  const { frame } = source;
  // A reload replaces the frame's document, so the finder follows it.
  let finder: { doc: Document; finder: DocumentFinder } | null = null;
  const current = () => {
    const doc = frameDocument(frame);
    if (!doc) return null;
    if (finder?.doc !== doc)
      finder = {
        doc,
        finder: createDocumentFinder(doc, { injectHighlightStyle: true }),
      };
    return finder.finder;
  };
  return localTarget(
    current,
    () => frame.focus(),
    () => frameDocument(frame)?.getSelection()?.toString() ?? "",
  );
}
