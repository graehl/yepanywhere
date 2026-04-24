import { type ReactNode, useMemo } from "react";
import katex from "katex";
import { useRenderModeToggle } from "../../contexts/RenderModeContext";
import { RenderModeGlyph } from "./RenderModeGlyph";

interface FixedFontMathToggleProps {
  sourceText: string;
  sourceView: ReactNode;
  renderRenderedView: (html: string) => ReactNode;
}

export interface RenderedMathResult {
  html: string;
  changed: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderKatexHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      output: "html",
      strict: "ignore",
      trust: false,
    });
  } catch {
    const wrapped = displayMode ? `$$${tex}$$` : `$${tex}$`;
    return `<span class="fixed-font-math-error">${escapeHtml(wrapped)}</span>`;
  }
}

function tryMatchBlockMath(
  sourceText: string,
  start: number,
): { end: number; html: string } | null {
  if (!sourceText.startsWith("$$", start)) {
    return null;
  }

  const end = sourceText.indexOf("$$", start + 2);
  if (end < 0) {
    return null;
  }

  const tex = sourceText.slice(start + 2, end).trim();
  if (!tex) {
    return null;
  }

  return {
    end: end + 2,
    html: renderKatexHtml(tex, true),
  };
}

function tryMatchInlineMath(
  sourceText: string,
  start: number,
): { end: number; html: string } | null {
  if (sourceText[start] !== "$") {
    return null;
  }

  const next = sourceText[start + 1];
  if (!next || /\s/.test(next)) {
    return null;
  }

  let end = start + 1;
  while (end < sourceText.length) {
    const char = sourceText[end];
    if (char === "\n") {
      return null;
    }
    if (char === "$") {
      break;
    }
    end += 1;
  }

  if (end >= sourceText.length || sourceText[end] !== "$") {
    return null;
  }

  const prev = sourceText[end - 1];
  if (!prev || /\s/.test(prev)) {
    return null;
  }

  const after = sourceText[end + 1];
  if (after && (/\d/.test(after) || after === "$")) {
    return null;
  }

  const tex = sourceText.slice(start + 1, end);
  if (!tex) {
    return null;
  }

  return {
    end: end + 1,
    html: renderKatexHtml(tex, false),
  };
}

export function renderFixedFontMath(sourceText: string): RenderedMathResult {
  let html = "";
  let changed = false;
  let plainStart = 0;
  let cursor = 0;

  while (cursor < sourceText.length) {
    const blockMatch = tryMatchBlockMath(sourceText, cursor);
    const inlineMatch = blockMatch ? null : tryMatchInlineMath(sourceText, cursor);
    const match = blockMatch ?? inlineMatch;

    if (!match) {
      cursor += 1;
      continue;
    }

    html += escapeHtml(sourceText.slice(plainStart, cursor));
    html += match.html;
    changed = true;
    cursor = match.end;
    plainStart = cursor;
  }

  html += escapeHtml(sourceText.slice(plainStart));
  return { html, changed };
}

export function FixedFontMathToggle({
  sourceText,
  sourceView,
  renderRenderedView,
}: FixedFontMathToggleProps) {
  const rendered = useMemo(() => renderFixedFontMath(sourceText), [sourceText]);
  const { showRendered, toggleLocalMode } = useRenderModeToggle(rendered.changed, {
    renderWhenDisabled: false,
    resetDependencies: [sourceText],
  });

  return (
    <div className="fixed-font-render-toggle">
      {showRendered && rendered.changed
        ? renderRenderedView(rendered.html)
        : sourceView}
      {rendered.changed && (
        <button
          type="button"
          className={`fixed-font-render-toggle__button ${showRendered ? "is-rendered" : ""}`}
          onClick={toggleLocalMode}
          aria-label={showRendered ? "Show source" : "Show rendered math"}
          title={showRendered ? "Show source" : "Show rendered math"}
          aria-pressed={showRendered}
        >
          <RenderModeGlyph />
        </button>
      )}
    </div>
  );
}
