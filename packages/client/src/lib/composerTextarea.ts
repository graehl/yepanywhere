const EXPANDED_COMPOSER_MAX_VIEWPORT_RATIO = 0.5;
const FALLBACK_TEXTAREA_LINE_HEIGHT_PX = 20;

export function clearTextareaContentsUndoably(
  textarea: HTMLTextAreaElement,
): void {
  const previousLength = textarea.value.length;
  if (previousLength === 0) return;

  textarea.focus();
  textarea.setSelectionRange(0, previousLength);

  // React state-only clears bypass native undo; this legacy edit command still
  // participates in the browser textarea undo stack.
  try {
    if (document.execCommand?.("delete")) {
      return;
    }
  } catch {
    // Fall back to a direct textarea edit below.
  }

  textarea.setRangeText("", 0, previousLength, "start");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function replaceTextareaRangeUndoably(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  replacement: string,
): void {
  textarea.focus();
  textarea.setSelectionRange(start, end);

  // React state-only replacements bypass native undo; edit the textarea first
  // so browsers that still wire execCommand into the undo stack can preserve it.
  try {
    const command = replacement ? "insertText" : "delete";
    if (document.execCommand?.(command, false, replacement)) {
      return;
    }
  } catch {
    // Fall back to a direct textarea edit below.
  }

  textarea.setRangeText(replacement, start, end, "end");
}

export function getInsertedTextForEdit(
  previousText: string,
  nextText: string,
  start: number,
  end: number,
): string {
  const replacementLength = Math.max(0, end - start);
  const insertedLength =
    nextText.length - previousText.length + replacementLength;
  if (insertedLength <= 0) {
    return "";
  }
  return nextText.slice(start, start + insertedLength);
}

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTextareaMinimumHeight(textarea: HTMLTextAreaElement): number {
  const computed = window.getComputedStyle(textarea);
  const fontSize =
    readPixelValue(computed.fontSize) || FALLBACK_TEXTAREA_LINE_HEIGHT_PX;
  const lineHeight = readPixelValue(computed.lineHeight) || fontSize * 1.35;
  const verticalPadding =
    readPixelValue(computed.paddingTop) +
    readPixelValue(computed.paddingBottom);
  const verticalBorder =
    readPixelValue(computed.borderTopWidth) +
    readPixelValue(computed.borderBottomWidth);
  return lineHeight * textarea.rows + verticalPadding + verticalBorder;
}

function getComposerChromeHeight(textarea: HTMLTextAreaElement): number {
  const composer = textarea.closest(".message-input");
  if (!(composer instanceof HTMLElement)) return 0;
  return Math.max(
    0,
    composer.getBoundingClientRect().height -
      textarea.getBoundingClientRect().height,
  );
}

function getExpandedComposerMaxTextareaHeight(
  textarea: HTMLTextAreaElement,
  minimumHeight: number,
): number {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const chromeHeight = getComposerChromeHeight(textarea);
  return Math.max(
    minimumHeight,
    Math.floor(
      viewportHeight * EXPANDED_COMPOSER_MAX_VIEWPORT_RATIO - chromeHeight,
    ),
  );
}

export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement,
  collapsed: boolean | undefined,
): void {
  if (collapsed) {
    textarea.style.height = "";
    textarea.style.overflowY = "";
    return;
  }

  const minimumHeight = getTextareaMinimumHeight(textarea);
  textarea.style.height = "auto";
  const contentHeight = Math.max(textarea.scrollHeight, minimumHeight);
  const maxHeight = getExpandedComposerMaxTextareaHeight(
    textarea,
    minimumHeight,
  );
  const nextHeight = Math.min(contentHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > nextHeight + 1 ? "auto" : "hidden";
}

export function countDraftLines(text: string): number {
  return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
}

function getTextareaLineHeightPx(textarea: HTMLTextAreaElement): number {
  const computed = window.getComputedStyle(textarea);
  const fontSize =
    readPixelValue(computed.fontSize) || FALLBACK_TEXTAREA_LINE_HEIGHT_PX;
  return readPixelValue(computed.lineHeight) || fontSize * 1.35;
}

export function scrollCollapsedTextareaToCursor(
  textarea: HTMLTextAreaElement,
): void {
  const value = textarea.value;
  const caret = Math.max(
    0,
    Math.min(textarea.selectionStart ?? value.length, value.length),
  );
  const lineHeight = getTextareaLineHeightPx(textarea);
  const maxScrollTop = Math.max(
    0,
    textarea.scrollHeight - textarea.clientHeight,
  );
  if (caret >= value.length) {
    textarea.scrollTop = maxScrollTop;
    return;
  }

  const hardLineIndex = countDraftLines(value.slice(0, caret)) - 1;
  textarea.scrollTop = Math.min(
    maxScrollTop,
    Math.max(0, hardLineIndex * lineHeight),
  );
}
