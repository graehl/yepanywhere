# Local-File Source Highlighting

> Proposal for syntax-highlighted previews of common source-file extensions
> served through the authenticated local-file route.

Topic: local-file-source-highlighting

## Proposal

`/api/local-file` should eventually offer a lightweight highlighted preview for
common source and config files by reusing the server's existing Shiki
highlighting service. YA already uses Shiki for FileViewer, Read, Write, and Edit
augments, so this should not add a new dependency or a second highlighter.

The feature should be an additive preview mode. Unknown non-media extensions can
continue to serve as `text/plain; charset=utf-8`; recognized Shiki extensions
may serve a small standalone HTML document that mirrors the current rendered
Markdown document shell.

## Constraints

- Do not weaken the local-resource path policy. Highlighting changes only
  presentation after the route has accepted the path.
- Keep `.md` / `.markdown` behavior intact: `render=1` renders Markdown as a
  document with a Raw action, and raw Markdown remains available.
- Keep media extensions on the media route. `/api/local-file` should not become
  an image/video preview endpoint.
- Cap highlighted file size or line count using the existing highlighter limits
  so direct browser gestures cannot make a large source file expensive to open.

## Candidate Shape

Add a query parameter such as `highlight=1` for local-file source previews. If
Shiki returns no language for the path, fall back to the current plain-text
response. For Markdown, `render=1` should continue to take precedence over
source highlighting because rendered Markdown preview is required behavior.
