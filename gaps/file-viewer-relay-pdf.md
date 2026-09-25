# Framed PDFs depend on the browser agreeing to run its viewer in a frame

The file viewer shows a PDF by framing it for the browser's built-in viewer.
Chromium refuses that viewer when it is set to download PDFs (the reported
2026-09-25 case: `chrome://settings/content/pdfDocuments`, or the
`AlwaysOpenPdfExternally` policy) and under any sandboxed ancestor frame, and
shows "This content is blocked". A same-origin raw URL and a `blob:` URL both
render under the app's `object-src 'none'` otherwise; an earlier note blamed
that policy, and it did not reproduce.

Landed: `FileViewerEmbeddedMedia` detects a refused frame and shows the
binary card with an "Open in new tab" link, and the opt-in **Draw PDFs with
pdf.js** setting renders PDFs without the browser viewer
([media rendering](../topics/media-rendering-and-routing.md#pdfs-in-the-file-viewer)).

Remaining:

- The pdf.js renderer needs the same-origin server. The relay client and
  public shares keep the browser viewer; serving pdf.js to them would need
  the modules brokered through the relay and a script policy that admits
  them.
- pdf.js pages are images: no text layer (selection, copy, viewer find) and
  no link annotations.
- No zoom control. YA disables pinch-zoom, so a two-column paper drawn at
  phone width is too small to read.
- `LocalFileModal` frames non-project local PDFs from a blob with its own
  iframe and uses neither the refused-frame fallback nor pdf.js.

Found 2026-09-24 while enabling inline PDF, audio, video, and font display.
