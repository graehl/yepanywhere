const SCRIPTLESS_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
].join("; ");

/**
 * Put untrusted HTML after a client-owned CSP so iframe srcdoc previews cannot
 * inherit network or application authority from the trusted YA document.
 * The iframe's sandbox must still withhold scripts; it grants only
 * `allow-same-origin`, so the viewer can search the preview
 * (SCRIPTLESS_PREVIEW_SANDBOX in ArtifactPreview.tsx).
 */
export function createScriptlessHtmlPreviewDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SCRIPTLESS_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"></head><body>${keepFragmentLinksInSrcdoc(html)}</body></html>`;
}

/**
 * A srcdoc document resolves URLs against the embedding YA page, so a
 * `#section` link would navigate the frame to the YA route instead of
 * scrolling. A `<base>` cannot fix that: the frame inherits the app's
 * `base-uri` policy, which refuses `about:srcdoc`. Addressing the fragment on
 * `about:srcdoc` itself keeps it a same-document scroll.
 */
function keepFragmentLinksInSrcdoc(html: string): string {
  if (!/href\s*=\s*["']?\s*#/i.test(html)) return html;
  // DOMParser builds an inert document: nothing runs or loads.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const anchor of parsed.querySelectorAll("a[href], area[href]")) {
    const href = anchor.getAttribute("href")!.trim();
    if (href.startsWith("#"))
      anchor.setAttribute("href", `about:srcdoc${href}`);
  }
  return parsed.documentElement.outerHTML;
}
