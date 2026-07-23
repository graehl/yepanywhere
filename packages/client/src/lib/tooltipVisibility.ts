const CLIPPING_OVERFLOW = new Set(["auto", "scroll", "hidden", "clip"]);
const VISIBILITY_SLOP_PX = 1;

function clipsAxis(value: string): boolean {
  return CLIPPING_OVERFLOW.has(value);
}

/**
 * True only when the element's full content box is visible in its own
 * scrollport, every clipping ancestor, and the viewport. Unmeasurable targets
 * are deliberately not treated as visible: absence of evidence must not
 * suppress a useful full-content tooltip.
 */
export function isElementFullyScrollVisible(target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect();
  const hasMeasuredBox =
    rect.width > 0 ||
    rect.height > 0 ||
    target.clientWidth > 0 ||
    target.clientHeight > 0;
  if (!hasMeasuredBox) return false;

  if (
    (target.clientWidth > 0 &&
      target.scrollWidth > target.clientWidth + VISIBILITY_SLOP_PX) ||
    (target.clientHeight > 0 &&
      target.scrollHeight > target.clientHeight + VISIBILITY_SLOP_PX)
  ) {
    return false;
  }

  if (
    rect.left < -VISIBILITY_SLOP_PX ||
    rect.top < -VISIBILITY_SLOP_PX ||
    rect.right > window.innerWidth + VISIBILITY_SLOP_PX ||
    rect.bottom > window.innerHeight + VISIBILITY_SLOP_PX
  ) {
    return false;
  }

  for (
    let ancestor = target.parentElement;
    ancestor && ancestor !== document.body;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    const clipsX = clipsAxis(style.overflowX || style.overflow);
    const clipsY = clipsAxis(style.overflowY || style.overflow);
    if (!clipsX && !clipsY) continue;
    const ancestorRect = ancestor.getBoundingClientRect();
    if (
      (clipsX &&
        (rect.left < ancestorRect.left - VISIBILITY_SLOP_PX ||
          rect.right > ancestorRect.right + VISIBILITY_SLOP_PX)) ||
      (clipsY &&
        (rect.top < ancestorRect.top - VISIBILITY_SLOP_PX ||
          rect.bottom > ancestorRect.bottom + VISIBILITY_SLOP_PX))
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Prefer an explicit omitted-content preview when one exists. Otherwise expose
 * the full text only when the rendered surface is clipped by itself, an
 * ancestor, or the viewport.
 */
export function getVisibilityAwareTooltipText(
  target: HTMLElement,
  fullText: string | null | undefined,
  omittedContentPreview?: string | null,
): string | null {
  if (omittedContentPreview) return omittedContentPreview;
  if (!fullText || isElementFullyScrollVisible(target)) return null;
  return fullText;
}
