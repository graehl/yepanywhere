const PRESENTATION_ATTRIBUTES = new Set([
  "background",
  "bgcolor",
  "class",
  "color",
  "fill",
  "style",
  "stroke",
]);
const TABLE_CONTEXT_ELEMENTS = new Set([
  "COLGROUP",
  "TABLE",
  "TBODY",
  "TFOOT",
  "THEAD",
  "TR",
]);

function rangeIsWithin(root: HTMLElement, range: Range): boolean {
  return (
    (range.startContainer === root || root.contains(range.startContainer)) &&
    (range.endContainer === root || root.contains(range.endContainer))
  );
}

function removeKatexVisualBranches(fragment: DocumentFragment): void {
  for (const visualMath of fragment.querySelectorAll(".katex-html")) {
    visualMath.remove();
  }
}

function removePresentation(fragment: DocumentFragment): void {
  removeKatexVisualBranches(fragment);

  for (const stylesheet of fragment.querySelectorAll(
    'style, link[rel~="stylesheet"]',
  )) {
    stylesheet.remove();
  }

  for (const element of fragment.querySelectorAll("*")) {
    for (const attribute of element.getAttributeNames()) {
      if (PRESENTATION_ATTRIBUTES.has(attribute.toLowerCase())) {
        element.removeAttribute(attribute);
      }
    }
  }
}

function cloneWithTableContext(
  range: Range,
  root: HTMLElement,
): DocumentFragment {
  const fragment = range.cloneContents();
  const commonElement =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!commonElement || !TABLE_CONTEXT_ELEMENTS.has(commonElement.tagName)) {
    return fragment;
  }

  let wrapped: Node = fragment;
  let context: Element | null = commonElement;
  while (context && context !== root) {
    const wrapper = context.cloneNode(false) as Element;
    wrapper.append(wrapped);
    wrapped = wrapper;
    if (context.tagName === "TABLE") {
      break;
    }
    context = context.parentElement;
  }

  const contextualFragment = root.ownerDocument.createDocumentFragment();
  contextualFragment.append(wrapped);
  return contextualFragment;
}

export function copySemanticHtmlSelectionToClipboard(
  event: ClipboardEvent,
  root: HTMLElement,
): boolean {
  if (event.defaultPrevented || !event.clipboardData) {
    return false;
  }

  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!rangeIsWithin(root, range)) {
      return false;
    }

    const fragment = cloneWithTableContext(range, root);
    removePresentation(fragment);
    const container = root.ownerDocument.createElement("div");
    container.append(fragment);
    if (container.innerHTML) {
      htmlParts.push(container.innerHTML);
      textParts.push(range.toString());
    }
  }

  if (htmlParts.length === 0) {
    return false;
  }

  event.clipboardData.setData("text/html", htmlParts.join("<br><br>"));
  event.clipboardData.setData("text/plain", textParts.join("\n\n"));
  event.preventDefault();
  return true;
}
