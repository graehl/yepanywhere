# Output rendering for agents

How agent output is displayed to users in Yep Anywhere. Use these
formatting features freely when responding through a YA-supervised
session (Claude Code, Codex, Gemini, etc.).

## Markdown (GitHub-flavored)

Text responses are parsed as GFM and rendered as sanitized HTML:

- Headings, **bold**, *italic*, ~~strikethrough~~, `inline code`
- Ordered / unordered / nested / task lists (`- [ ]` / `- [x]`)
- Block quotes
- Tables with header alignment
- Fenced code blocks — tag the fence with a language (` ```ts `,
  ` ```python `, ` ```sh `, etc.) for syntax-highlighted output via
  Shiki
- Links: `[text](https://…)` and autolinked URLs; `http`, `https`,
  `mailto` schemes only

Raw HTML inside markdown is escaped, not passed through. Do not rely on
embedding HTML tags.

## Local file links

Absolute local paths ending in a media extension become in-app preview
affordances:

- `![alt](/path/to/image.png)` — clickable thumbnail (opens modal)
- `[caption](/path/to/clip.mp4)` — clickable video placeholder

Recognized extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`,
`tiff`, `svg`, `mp4`, `webm`, `mov`, `avi`, `mkv`, `ogv`. Other local
paths render as links into the in-app file viewer.

## Tool results

Structured results from Bash, Edit, Write, Read, Grep, Task, etc. have
dedicated renderers (diff views, collapsible panels, status badges).
Do not paraphrase or re-quote tool output in your prose — the client
already displays it richly below your message.

## Sanitization

Rendered HTML is passed through `sanitize-html`. Disallowed tags are
escaped (visible) rather than silently stripped, so oversights surface
in the output.
