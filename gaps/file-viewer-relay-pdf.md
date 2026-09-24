# Relay-only file viewer PDFs are blocked by the inherited app CSP

The file viewer frames a PDF's own `/files/raw` response when the transport
has same-origin URLs, so Chromium's PDF viewer loads under the raw response's
headers. Over the relay the raw URL is not addressable, so the viewer frames a
`blob:` URL instead. A blob document inherits the creating page's policy,
including `object-src 'none'`, and Chromium then shows "This content is
blocked" in place of its PDF viewer.

Candidate resolutions: render relayed PDFs with a bundled JavaScript renderer
(pdf.js), or allow `object-src blob:` in the app policies after an
active-content review (`topics/active-content-security.md`). Neither was
verified: headless Chromium has no PDF viewer to test against.

Found 2026-09-24 while enabling inline PDF, audio, video, and font display.
Contributing-model: opus-5.5
