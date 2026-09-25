import type { FindCounts } from "@yep-anywhere/shared/find/documentFind";
import { findShortcut } from "@yep-anywhere/shared/find/documentFind";
import {
  FIND_PROTOCOL,
  findSeed,
  isFindReport,
} from "@yep-anywhere/shared/find/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createViewerFindTarget,
  frameDocument,
  type ViewerFindSource,
} from "../lib/viewerFind";

export interface ViewerFind {
  /** The viewer's content can be searched (an agent frame has answered). */
  available: boolean;
  /** Opened by a shortcut or holding a query: shown even without room. */
  active: boolean;
  query: string;
  counts: FindCounts | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setQuery(query: string): void;
  step(direction: 1 | -1): void;
  /** Clear the search and return focus to the content. */
  dismiss(): void;
}

// A search that took longer than a frame waits for a typing pause before the
// next one, so keystrokes into the field are never held behind a scan.
const SLOW_SEARCH_MS = 16;
const SLOW_SEARCH_DELAY_MS = 120;

/**
 * Find-in-viewer for one viewer. Ctrl/Cmd+F opens the field only after the
 * reader has clicked or focused inside that viewer's content, so the
 * browser's own find still owns every other part of the page.
 */
export function useViewerFind(source: ViewerFindSource | null): ViewerFind {
  const target = useMemo(
    () => (source ? createViewerFindTarget(source) : null),
    [source],
  );
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [query, setQueryState] = useState("");
  const [counts, setCounts] = useState<FindCounts | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const request = useRef(0);
  const lastDuration = useRef(0);
  const focusRequest = useRef(false);
  /** The query whose search has been issued to the target, if any. */
  const searchedQuery = useRef<string | null>(null);
  const pendingSearch = useRef<ReturnType<typeof setTimeout>>(undefined);

  const openField = useCallback((seed: string) => {
    const text = findSeed(seed);
    if (text) setQueryState(text);
    setActive(true);
    focusRequest.current = true;
    // Focus now when the field is already shown, so keys typed right after
    // Ctrl+F land in it; an idle field hidden for lack of room is focused
    // once it renders.
    const input = inputRef.current;
    input?.focus();
    if (input && input.ownerDocument.activeElement === input) {
      input.select();
      focusRequest.current = false;
    }
  }, []);

  // The field may mount only once opened; focus it when it does.
  useEffect(() => {
    if (!active || !focusRequest.current) return;
    focusRequest.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!target || !query.trim()) return;
      const id = ++request.current;
      // A step right after typing belongs to the typed query, not to the
      // results of the query before it, so run its pending search first.
      const searched =
        searchedQuery.current === query
          ? Promise.resolve()
          : (() => {
              clearTimeout(pendingSearch.current);
              searchedQuery.current = query;
              return target.find(query);
            })();
      void searched
        .then(() => target.step(direction))
        .then((next) => {
          if (id === request.current) setCounts(next);
        });
    },
    [target, query],
  );

  const onShortcut = useCallback(
    (shortcut: "open" | "next" | "previous", seed: string) => {
      if (shortcut === "open" || !query.trim()) openField(seed);
      else step(shortcut === "next" ? 1 : -1);
    },
    [openField, query, step],
  );

  // Search as the query changes, latest request wins.
  useEffect(() => {
    if (!target) return;
    const id = ++request.current;
    searchedQuery.current = null;
    if (!query.trim()) {
      target.clear();
      setCounts(null);
      return;
    }
    pendingSearch.current = setTimeout(
      () => {
        const started = performance.now();
        searchedQuery.current = query;
        void target.find(query).then((next) => {
          lastDuration.current = performance.now() - started;
          if (id === request.current) setCounts(next);
        });
      },
      lastDuration.current > SLOW_SEARCH_MS ? SLOW_SEARCH_DELAY_MS : 0,
    );
    return () => clearTimeout(pendingSearch.current);
  }, [target, query]);

  // A new target starts clean; the old one drops its highlights.
  useEffect(() => {
    setReady(source?.kind !== "agent");
    setCounts(null);
    return () => target?.clear();
  }, [source, target]);

  // Shortcuts inside content rendered in YA's page.
  useEffect(() => {
    if (source?.kind !== "element") return;
    const { element } = source;
    let inside = false;
    const doc = element.ownerDocument;
    const pointer = (event: PointerEvent) => {
      inside = event.target instanceof Node && element.contains(event.target);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = findShortcut(event);
      const focused = doc.activeElement;
      if (
        !shortcut ||
        !(inside || (focused && element.contains(focused))) ||
        focused === inputRef.current
      )
        return;
      event.preventDefault();
      onShortcut(shortcut, target?.selection() ?? "");
    };
    doc.addEventListener("pointerdown", pointer, true);
    doc.addEventListener("keydown", keydown);
    return () => {
      doc.removeEventListener("pointerdown", pointer, true);
      doc.removeEventListener("keydown", keydown);
    };
  }, [source, target, onShortcut]);

  // Shortcuts inside the same-origin preview frame, re-attached per load.
  useEffect(() => {
    if (source?.kind !== "frame") return;
    const { frame } = source;
    let attached: Document | null = null;
    const keydown = (event: KeyboardEvent) => {
      const shortcut = findShortcut(event);
      if (!shortcut || event.defaultPrevented) return;
      event.preventDefault();
      onShortcut(shortcut, target?.selection() ?? "");
    };
    const attach = () => {
      attached?.removeEventListener("keydown", keydown);
      attached = frameDocument(frame);
      attached?.addEventListener("keydown", keydown);
    };
    attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      attached?.removeEventListener("keydown", keydown);
    };
  }, [source, target, onShortcut]);

  // The agent frame reports readiness, shortcuts and results by message.
  useEffect(() => {
    if (source?.kind !== "agent" || !target) return;
    const { frame } = source;
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !isFindReport(event.data))
        return;
      const report = event.data;
      if (report.type === "ready") setReady(true);
      else if (report.type === "open") onShortcut("open", report.selection);
      else if (report.type === "shortcut")
        onShortcut(report.direction === 1 ? "next" : "previous", "");
      else target.receive(report);
    };
    // The agent announces itself on load; asking again covers a frame that
    // loaded before this listener existed.
    const hello = () =>
      frame.contentWindow?.postMessage(
        { protocol: FIND_PROTOCOL, type: "hello" },
        new URL(frame.src).origin,
      );
    window.addEventListener("message", message);
    frame.addEventListener("load", hello);
    hello();
    return () => {
      window.removeEventListener("message", message);
      frame.removeEventListener("load", hello);
    };
  }, [source, target, onShortcut]);

  const dismiss = useCallback(() => {
    request.current += 1;
    target?.clear();
    setQueryState("");
    setCounts(null);
    setActive(false);
    target?.focusContent();
  }, [target]);

  return {
    available: Boolean(target) && ready,
    active,
    query,
    counts,
    inputRef,
    setQuery: setQueryState,
    step,
    dismiss,
  };
}
