# Artifact links should open at the requested document anchor

Status: open; reported behavior, root cause unconfirmed.
Contributing-model: 6-Astra.

During paragraph-by-paragraph paper review, the user reports that links to
an HTML artifact's section fragment do not reliably take them to that passage
in the artifact viewer. Long documents make the link ineffective even though
the requested section has an HTML id. Expected: opening a grant URL with
`#section-id` reveals that section, including when the same document is already
open and a different fragment is selected.

Owner: [interactive artifact links](../topics/parked-file-viewer.md#interactive-artifact-links).
Initial source inspection finds no obvious fragment stripping:
`SessionManagedViewer.tsx` passes the supplied URL into the viewer controller;
`ArtifactLinkViewer.tsx` uses `controller.url` as iframe `src`;
`lib/sessionVhostApps.ts` preserves `url.href` for grant URLs and explicitly
copies hashes for rewritten vhost URLs. Do not assume stripping is the cause.

Reproduce through a transcript link and the actual viewer, with an isolated
long HTML fixture containing named anchors. Check first open, another anchor
in the same document, reopening the same anchor after manually scrolling,
minimize/restore, and direct versus hosted relay clients. Verify both the
iframe URL fragment and the target's final visible position after fonts/images
settle. Compare ordinary browser navigation to distinguish document layout
behavior from viewer navigation. Keep cross-origin isolation intact; avoid
parent DOM access or arbitrary delayed scrolling as a workaround.

2026-09-25 finding, fixed in the same change as this note: section links
*inside* the sanitized (scriptless) HTML preview navigated the srcdoc frame to
the embedding YA route plus `#section`, because a srcdoc document resolves
fragments against its parent's URL. The preview wrapper now addresses them on
`about:srcdoc`; see
[active content security](../topics/active-content-security.md). Links inside
the interactive (play) frame were checked in Chromium and scroll correctly on
the artifact origin. What remains open is only the transcript-link case above.
Its likeliest sub-case is re-requesting the anchor the frame already has:
an unchanged iframe `src` does not navigate.

Deferred because the user requested a brief investigation or gap while paper
review continues; a correct fix needs an actual viewer reproduction. A small
standalone excerpt is the current paper-review workaround. Close with a
browser regression covering fragment-only navigation and reopen behavior.

Found 2026-09-21 while reviewing the multilingual PII paper in draft.
