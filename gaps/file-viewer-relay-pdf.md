# Framed PDFs depend on the browser agreeing to run its viewer in a frame

The file viewer shows a PDF by framing it and letting the browser's built-in
viewer render it. Chromium refuses that viewer in some framings and shows
"This content is blocked" instead. The one reproduced refusal is any
sandboxed ancestor frame (see also the artifact PDF hand-off in
`topics/active-content-security.md`). A same-origin raw URL and a `blob:` URL
both render under the app's `object-src 'none'` in Playwright's Chromium 1208,
with and without the out-of-process PDF viewer feature. An earlier note blamed
that policy for blocked relay PDFs; it did not reproduce.

`FileViewerEmbeddedMedia` now detects a refused frame (the frame exposes no
PDF document) and falls back to the binary card plus an "Open in new tab"
link, which works because a top-level tab has no framing ancestry.

Remaining:

- A user report on 2026-09-25 (stock Chrome, `localhost:3400` file page for a
  PDF opened from a session link) showed the blocked page while the same URL
  and click path render in Playwright's Chromium. Its trigger is unconfirmed;
  candidates are a tab still running pre-2026-09-24 client code under
  `--no-frontend-reload`, a Chrome PDF setting or policy, or a sandboxed
  ancestor.
- `LocalMediaModal` frames non-project local PDFs with its own iframe and does
  not yet use the fallback.
- Rendering PDFs inline where the browser refuses needs a bundled JavaScript
  renderer such as pdf.js.

Found 2026-09-24 while enabling inline PDF, audio, video, and font display.
