# Relative filename display

## Contract

File paths shown in the UI must be the shortest unambiguous form:

1. **Project-relative** — if the file is under the session's project root,
   strip the prefix and show `src/foo.ts` (no leading slash).
2. **Home-relative** — if outside the project but under `~`, show `~/...`.
3. **Absolute** — fallback when neither applies.

The compact display label (visible text) may still be filename-only for
space reasons. The full display path must appear in the tooltip (`title`
attribute) so the user can identify the file without opening it.

## Implementation

### Shared utility

`packages/client/src/lib/text.ts` — `makeDisplayPath(filePath, projectPath)`:
- Tries project-relative first (strips `projectPath + "/"` prefix).
- Falls back to `shortenPath()` for home-relative.
- Used by Read, Write, and Edit tool renderers.

### Tool renderers

| Tool | Compact label | Tooltip (`title`) | Detail / modal |
|------|---------------|-------------------|----------------|
| Read | filename only | `makeDisplayPath`  | — |
| Write | filename only | `makeDisplayPath`  | — |
| Edit | — | — | `makeDisplayPath` in diff modal header |

### Server-rendered file-link anchors

`packages/shared/src/filePathDetection.ts` — `transformFilePathsToHtml()`
generates `<a class="file-link">` tags. These carry `title` with the full
absolute path (not project-relative), because the server does not have
per-request project path context at augment time. <!-- assumed -->

`packages/server/src/augments/safe-markdown.ts` — local-file markdown
links (`[label](./path)`) get `title` set to the href (absolute path)
when the markdown does not supply an explicit title.

## projectPath availability

`projectPath` comes from `SessionMetadataContext` (populated in
`SessionPage` from the project API). It is `null` when no project is
associated with the session. `makeDisplayPath` handles `null` gracefully
by falling back to `shortenPath`.
