# Rich-Text Rendering

> Rendering pipeline for agent action panels and file previews, including when
> YA turns raw provider text into sanitized markdown, syntax-highlighted code,
> local file links, media previews, and diff views.

Covers the rendering pipeline for agent action panels — what transforms apply to
command output, file reads, diffs, and edits; which are always-on vs. user-toggleable;
and the rationale for each choice.

## Panel types

| Panel | Where rendered | Source data |
|-------|---------------|-------------|
| **Bash output** | `BashCollapsedPreview` / expand | stdout + stderr from tool result |
| **Read — code file** | `TextFileResult` → `FileModalContent` | `_highlightedContentHtml` from server (Shiki) |
| **Read — markdown file** | `TextFileResult` → `FileModalContent` | `_renderedMarkdownHtml` from server |
| **Read — plain text / log** | `TextFileResult` → `FileModalContent` | raw `file.content` |
| **Edit diff** | `EditCollapsedPreview` → `DiffMathView` | unified-diff string |
| **Diff nested in Bash output** | `BashCollapsedPreview` → `FixedFontMathToggle` | detected via `looksLikeUnifiedDiff` |

## Codex goal tool rows

Codex exposes three model-facing goal tools in persisted thread transcripts:
`create_goal`, `get_goal`, and `update_goal`. They share a dedicated renderer
rather than the generic JSON fallback. A known goal response shows the complete,
pre-wrapped objective, its lifecycle status, token use and budget when present,
remaining tokens, elapsed goal time, and a budget progress indicator. Long
objectives must wrap at phone width without horizontal scrolling.

The renderer accepts the current camel-case response fields and snake-case
equivalents retained by older or partially normalized transcripts. Provider
bookkeeping that does not help supervise the goal — thread ids, timestamps, and
the model-only completion-report instruction — stays out of the visual summary.
An empty `get_goal` response says that no goal is set, pending calls state the
operation in progress, and failures show the provider error rather than a
serialized response object. A failed mutation keeps the requested operation in
its row heading; it must not use the past-tense success heading reserved for a
completed mutation.

The separate Codex app-server `thread/goal/set`, `thread/goal/get`, and
`thread/goal/clear` methods, plus updated/cleared notifications, are control
protocol operations rather than additional model tool rows. This renderer does
not make the YA client depend on those routes or add persistent goal chrome
outside the transcript.

## Thinking block formatting

Thinking blocks are user-visible model reasoning summaries, not normal assistant
prose and not tool output. They may arrive while streaming, so YA keeps their
renderer deliberately smaller than the assistant Markdown path: cheap line-level
transforms only, with no whole-document Markdown reparse requirement.

Current thinking rendering activates an outline view only when the first line is
a standalone `**heading**`. Subsequent standalone `**heading**` lines become
collapsible outline sections; a blank line immediately after a heading is
suppressed so the visual grouping follows the heading/body structure. Inline
backtick spans and fenced or indented fixed-font blocks get monospace treatment.
Non-code lines that are only an HTML comment are treated as display placeholders
and suppressed; comment-like lines inside fenced or indented code remain source
text. Other thinking text remains plain pre-wrapped text.

Provider formats observed so far:

| Provider | Thinking content shape | Markdown-like conventions |
|----------|------------------------|---------------------------|
| Codex | `thinking` content blocks, including reasoning summaries | Often emits standalone `**section**` lines, blank-line-separated prose, and occasional backtick/fenced-code snippets. |
| Claude | Native `thinking` blocks when enabled | Usually plain prose; detailed Markdown conventions not yet catalogued. |
| Grok | ACP `agent_thought_chunk` normalized to YA `thinking` | Structured plan/thought data exists in provider docs; final visible formatting still incomplete. |
| OpenCode | ACP `reasoning` normalized to YA `thinking` for live events | Durable reload handling is incomplete; formatting conventions not yet catalogued. |

## Always-on transforms

These run unconditionally and are not user-configurable:

- **ANSI escape stripping** — applied before all rendering so raw escape codes
  never appear as literal characters. (`stripAnsiEscapes` inside `renderFixedFontRichContent`)
- **Shiki syntax highlighting** — server-side, keyed on file extension, stored as
  `_highlightedContentHtml` on `ReadResultWithAugment`. Applied only to files the
  server recognises as source code.
- **Code-fence language marking** — an assistant code block's info string is
  reduced to one normalized language name, and every rendered block carries it
  as `class="language-<name>"` regardless of which renderer produced the markup.
  See [`code-fence-renderers.md`](code-fence-renderers.md), which also holds the
  proposed per-language renderer registry and Mermaid design.
- **Server markdown rendering** — server-side, for `.md`/`.markdown` files,
  stored as `_renderedMarkdownHtml`. CommonMark embedded HTML is parsed before
  the shared sanitizer, so inert structural markup such as table headers with
  `colspan` or cells with `rowspan` survives while scripts, event attributes,
  unsafe URLs, active embeds, and disallowed elements remain blocked. Assistant
  Markdown, tool-result Markdown, file previews, and persisted reloads use the
  same boundary.
- **Explicit rendered Markdown file links** — project file links open the
  standalone file viewer on browser link gestures, and `.md` / `.markdown`
  local-file links can request a content-only rendered document. That document
  includes a raw link and expands local image links directly. Public-share file
  previews hydrate those local image references through embedded bounded media
  blobs when present, falling back to the share-scoped relay route rather than
  navigating to authenticated local file APIs.
  A rendered local-file URL with `line=N` uses the same source-aligned Markdown
  block boundaries as the shared `FileViewer`, then places the containing block
  about 10% below the viewport top. On arrival, that block has a temporary
  highlight and a short dash extending into the left margin. The first
  subsequent scroll dismisses the highlight with a one-way fade; the dash
  remains as the durable target marker. An out-of-range line leaves the normal
  unmarked document rather than jumping to an unrelated block.
  Its ordinary **Raw** action opens the genuine `text/plain` resource in a
  same-origin tab and uses the still-live rendered document to place that tab's
  requested source line about 10% below the viewport top. The raw response is
  not reconstructed as HTML, so browser Save As and native copy/paste retain
  the exact source text. Modified-link gestures keep normal browser behavior.
  The rendered document is a transitional YA-owned sanitized shell, not a
  general active-file viewer or precedent for returning project HTML inline.
  It must carry the per-response protection in
  [`active-content-security.md`](active-content-security.md) while it remains,
  and should converge on the shared SPA viewer when that preserves the needed
  line/copy behavior.
- **Assistant inline-code project file links** — when authenticated session
  Markdown renders with project context, inline-code filename references such
  as `` `topics/security.md` `` link to the project file viewer only if the
  target currently exists under the project root. The Markdown parser's
  existing `codespan` token is the detection boundary; YA does not reparse raw
  assistant Markdown for this.
- **Confirmed tool-content file links** — completed Bash/Ran command text and
  string tool-result bodies render exact server-confirmed project paths as file
  viewer links. A whole path anchor takes precedence over glossary annotation,
  and activating it does not trigger the containing row's expand action. The
  optional per-body annotation is absent on older servers and ignored in public
  shares, where the same content remains plain.
- **Line numbers** — shown in the plain-text fallback path (no Shiki highlight).

## Math delimiter parity

Every surface that opts into KaTeX accepts the same explicit LaTeX delimiters:
`\(…\)` for inline math and `\[…\]` for display math, alongside `$…$` and
`$$…$$`. This includes completed and streamed assistant Markdown, rendered
Markdown documents and tool results, fixed-font output panels, and Markdown or
non-Markdown edit diffs in their rendered mode. An explicit closing delimiter
must be unescaped; inline bracket math must stay on one line.

Those surfaces share YA's KaTeX font and output-math size setting. An overwide
display formula scrolls horizontally inside its own rendered surface rather
than widening or clipping the surrounding transcript.

Streaming assistant text may remain source-like while its current Markdown
block is incomplete. Once the paragraph or display block completes, its
server-supplied augment must contain KaTeX rather than exposing bracket
delimiters for the client's fallback renderer to rediscover.

In a diff, a multiline display formula renders only when its opening delimiter,
body, and closing delimiter all belong to one lane: added, removed, context, or
unprefixed. The rendered formula retains that lane's gutter and colour. A block
that crosses lanes remains literal so an addition and removal can never be
combined into a formula that exists on neither side.

Thinking summaries and fenced or inline code remain literal under their
separate source-preservation contracts; they are not KaTeX-enabled surfaces.

## File Content Viewer Contract

When a renderer shows file contents outside an inline transcript block, it
should use the shared `FileViewer` surface with a `FileViewerSource` adapter
rather than a bespoke modal. The common primitive is a full-file view with an
optional source span (`line` / `lineEnd`) and an optional compact range-only
mode. Read links, Edit filename links, standalone file pages, and public-share
file links should therefore inherit the same source/preview controls,
large-file windowing, hline span markers, scrollbars, copy affordance, media
hydration, and public-share capability scoping.

When both source and preview exist, the file viewer toolbar uses one **Raw
source** icon toggle instead of a two-label Source/Preview switch. Pressed
means raw source is visible; unpressed means the rendered preview is visible.
The initial source-first HTML and preview-first Markdown defaults remain
unchanged.

Textual file viewers and expanded Edit/Read/Run-style detail viewers expose a
**Select all** control in their top toolbar. `Ctrl/Cmd+A` invokes the same
action while focus belongs to that visible viewer; editable inputs retain
their native select-all behavior. The action creates an ordinary browser
selection spanning the viewer body, so registered source regions immediately
feed the existing floating copy/quote/new-session action cluster. Static HTML
iframe previews do not offer the control because their opaque sandbox is not a
selectable trusted-DOM body.

Ordinary copy from a rendered document uses the registered pre-render source
mapping and writes the best aligned authored span to `text/plain`. For a
Markdown preview that is Markdown; for a rendered math selection it includes
the original TeX expression and delimiters when they can be recovered
unambiguously. It must not be preempted by the preview's rich-text serializer:
source-preserving `Ctrl/Cmd+C` is the default document-copy contract. The
independently enabled blue `</>` selection action invokes the same best-effort
source projection. The purple `Aa` companion serializes the stored selection
ranges as semantic HTML plus visible plain text for users who want the rendered
projection. If the browser cannot write multiple clipboard representations,
the rich action falls back to its visible plain-text representation. These
buttons are default-off; their visibility never changes the keyboard-copy
contract.

The file resource menu's **Copy rendered contents** command is the whole-file
counterpart to the purple rich-selection action. For Markdown it consumes the
server render result; for static HTML it parses the document in a detached DOM.
It serializes semantic body HTML and visible plain text as though the rendered
body had been selected and copied, without visibly opening the preview.

Semantic rich-text copy from Σ-rendered fixed-font/diff views must not carry
YA's display presentation into the destination. Its handler serializes the
selected rendered fragment through a positive allowlist of inert structural,
text, table, and MathML elements and narrowly semantic attributes. URL-bearing
attributes, forms and controls, event handlers, active embeds, images, scripts,
styles, and unknown elements cannot enter the clipboard payload; unknown
containers contribute only their safe descendant text and markup. The handler
keeps the existing source-aware `text/plain` fallback. It does not rely on
Chromium's default computed-style clipboard payload, which can transfer only
part of a foreground/background pair into editors such as Jira. Table headers
and inline/block code still declare paired themed colors for correct rendering
inside YA; those declarations never enter the explicit clipboard HTML.

KaTeX display output contains both an accessible MathML branch and its styled
visual HTML branch. Semantic clipboard HTML keeps only the MathML branch before
removing presentation attributes, so pasted math remains portable without an
unstyled duplicate visual tree.

### Edit preview expansion and truncation

Edit diff previews expose the following interaction contract:

- An ordinary click on the diff, or Enter/Space on its keyboard tap target,
  opens the complete diff modal. Buttons and links inside the preview retain
  their own actions and do not open that modal.
- Completing a non-collapsed text selection inside the fixed-font diff also
  opens the complete modal in the same source or rendered representation as the
  preview. The same text remains selected by a live browser range owned by the
  modal, so the user's next copy command copies from the expanded view without
  requiring another selection gesture.
- If the preview range cannot be captured wholly inside the fixed-font content,
  the modal stays closed and the original preview selection remains intact.
- A truncated preview shows both its existing fade and a `+N` badge whose count
  is the number of hidden diff lines. The fade is a visual cue, not the only
  disclosure that content is omitted.

## Toggleable transforms (sigma Σ button)

`FixedFontMathToggle` wraps a source view and, if `rendered.changed = true`, shows
a small circular Σ button at the bottom-right of the panel. Clicking it toggles
between source and rendered mode; state is per-panel (local override) or globally
toggled via Ctrl/Cmd+Shift+M.

**What the toggle renders:**

- Markdown tables (`| col | col |` syntax) → `<table>` with aligned cells
- Markdown headings, blockquotes, lists, horizontal rules → styled inline elements
- Inline math `$…$` or `\(…\)` and display math `$$…$$` or `\[…\]` → KaTeX
  HTML. Display delimiters may span lines in ordinary fixed-font panels.
- Backtick inline code → `<code>` spans
- Bold `**…**` / `__…__` → `<strong>`
- Markdown file links `[label](./path)` → clickable links that open a file-viewer
- Unified diffs — detected automatically via `looksLikeUnifiedDiff`; diff-aware
  mode strips `+`/`-` gutter before rendering inline content and colours lines

**Detection heuristic (`mayHaveFixedFontRichContent`):** returns true if the
source text contains `$`, `\(`, `\[`, `` ` ``, `[`, `**`, or `__`, or if any
line matches a markdown structural pattern. This is deliberately broad to avoid
missed renders on output that mixes prose and code; see "code file exclusion"
below.

**Global render mode:** `RenderModeProvider` holds `globalMode` (default
`"rendered"`) and a set of per-panel override IDs. A panel starts in the global
mode unless the user has toggled it locally. `toggleGlobalMode` resets all local
overrides. Assistant turn prose has its own local source/render toggle and does
not participate in this global mode; the bottom-bar render-mode control is scoped
to `FixedFontMathToggle` panels.

Assistant source-text boxes use compact vertical padding and a line height
derived from the selected fixed-width font size. Their timeline dot aligns with
the first line, including the box's border and padding; rendered prose uses its
own first-line height. Wrapped text keeps the marker at the first line rather
than centering it against the entire block.

## Code file exclusion — and math opt-in

Source files identified by Shiki (`_highlightedContentHtml` present) skip the
full `FixedFontMathToggle` pipeline in `FileModalContent`. Rationale: TypeScript,
JavaScript, Python etc. are saturated with `$` (template literals), `` ` ``,
`[` (arrays), `**` (operators), and `//` (comments that trigger heading heuristics),
causing near-universal false-positive detection of markdown structure. Shiki already
provides the best available source view.

**Math opt-in for code files:** `FileModalContent` runs `renderFixedFontMath`
(KaTeX only — no markdown structural transforms) on the raw content. If real math
is detected (`rendered.changed = true`), a Σ button appears defaulting to **off**.
Clicking it switches from the Shiki-highlighted view to a plain-text+KaTeX view;
clicking again restores Shiki. This uses a local `useState(false)` rather than
the global render mode, so the default stays off regardless of Ctrl/Cmd+Shift+M.
Note: math mode currently loses Shiki colouring — the two renders are mutually
exclusive until a compositing path is built.

Filename-affiliated plain-text files retain only the math portion of the
`FixedFontMathToggle` pipeline unless their extension is Markdown-like (`.md`,
`.markdown`, `.mdx`, `.mdown`, `.mkd`, `.mkdn`, `.qmd`). This avoids structural
Markdown false positives from source files without Shiki highlighting,
especially TSX template literals and backtick-heavy code.

For markdown files, `FileModalContent` uses its own outer Σ button (not
`FixedFontMathToggle`) to toggle between the server-rendered HTML preview and
the raw source view — avoiding double-sigma situations.

Edit diffs and raw patches follow the same filename gate. A diff is rich-rendered
only when its target path set is entirely Markdown-like; otherwise it is math-only
even if the diff contains backticks, tables, or bold markers. Bash/command output
is not filename-affiliated and still uses the broad organic rich-content
heuristic, because command output often mixes prose, diffs, tables, and math with
no reliable file extension.

## Summary affordances

Tool activity uses one compact, unboxed gutter control: `+` when its detail
is collapsed and `−` when expanded. Ran, ordinary tool results, and captured
Exec/View Image media use the same control and tap target. Status color remains
independent of expansion: green for success, red for failure, and the existing
pending/interrupted colors. The marker occupies the timeline dot's position;
there is no second boxed toggle or trailing disclosure chevron. Keyboard and
pointer activation update the visible marker and `aria-expanded` together.
The connector is centered on the glyph, uses lower contrast than the status
color, and leaves three pixels clear above and below its visible strokes.
The one-pixel strokes form symmetric nine-pixel glyphs aligned with the
ordinary timeline connector, avoiding half-pixel stems at native scale.
Hover brightens the same control without adding a box.

Long one-line summaries keep the row tail visible by reserving result/count
columns and applying normal end-ellipsis only to the variable expression. Grep
uses the left gutter control as its outline affordance: clicking it expands
the full search expression under the clipped header while keeping the match count
visible. The clipped pattern text is also clickable as a secondary target, but the
gutter marker is the stable control.

Bash/Ran rows keep the gutter control and row middle for the existing output-preview
show/hide behavior. The command text itself is a separate click target; clicking
it expands the full command inline with wrapping, so a huge command can be
inspected without collapsing the output preview accidentally. The expanded
command grows its row to its full natural height; it has no separate vertical
scroll area. The transcript scrollbar remains the way to read long commands.

## Sigma button placement and scroll preservation

The Σ button is `position: absolute; right: 0.4rem; bottom: 0.25rem` within its
`.fixed-font-render-toggle` container — intentionally inside the container's
right edge to avoid overlap with the `UserTurnNavigator` scrollbar rail (which
occupies the rightmost ~34px of the viewport at z-index 25).

When the toggle changes the panel's height, `useScrollPreservingToggle`
(`lib/scrollAnchor.ts`) records the button's offset from the nearest
`overflow: auto/scroll` ancestor before calling the toggle, then restores
`scrollTop` via `useLayoutEffect` (before paint) so the button appears
stationary.

## Why source code read/edit sections are not rich-rendered

Even when a source file contains legitimate markdown or KaTeX in doc-comments or
string literals, applying `FixedFontMathToggle` to the whole file would be
incorrect: the renderer has no syntactic knowledge of the host language and cannot
distinguish a `$` that begins inline math from one that is part of a shell
variable, a PHP sigil, a JavaScript template literal, or a regex. Similarly,
`#` in Python/shell is a comment character but triggers heading detection; `---`
in a YAML front-matter separator triggers horizontal-rule detection inside
surrounding code.

The KaTeX inline-math filter (`tryMatchInlineMath`) is deliberately tight for
ambiguous `$…$`: it requires at least one of `\ ^ { } +` or a digit and rejects
patterns that look like shell variable spans (`$VAR >>$OTHER`). Explicit
bracketed `\(…\)` needs no content heuristic, but still requires an unescaped,
same-line closing `\)`. Display `\[…\]` likewise requires an unescaped closing
delimiter. In practice the dollar filter removes the vast majority of false
positives in prose and command output. Edge cases remain — e.g.
`echo $A=+$B` in a Bash snippet, where `$A=+$B` satisfies the `+` heuristic —
so the filter is good but not exact.

For rich-rendering inside source code to make sense, the renderer would need to:

1. Parse the host language well enough to identify comment and string-literal
   token boundaries (or receive those boundaries pre-computed from the server
   alongside the Shiki highlight data).
2. Apply inline math rendering only within those token spans, not to the
   whole file (markdown structural transforms like headings and lists would
   still be suppressed).
3. Composite the Shiki-coloured source tokens with the rendered inline content
   so neither layer clobbers the other.

This is a non-trivial language-aware post-processing step. The ambition of
showing LaTeX math inside source-code reads/edits — scoped to doc-comments and
string literals — may be revisited in the future. Until then, the safe choice
is to show Shiki-highlighted source as-is and let the user read embedded
formulas as literal text, matching the experience in their editor.

## Known gaps / future work

- Declined pending real-session evidence: bracketed display math could recover
  a missing `\]` by treating a bare `]` or blank line as an implied close, or by
  applying another restoration heuristic. Do not explore or add permissive
  recovery unless measured provider-session delimiter failures exceed 0.1%;
  either proposed sentinel can occur in intentional TeX, so speculative
  recovery risks silently truncating valid formulas.
- Local resource links need a shared context-aware routing layer so rendered
  `/api/local-file`, `/api/local-image`, and project-file links do not bypass
  the secure relay path in hosted remote mode. See
  [`docs/tactical/009-local-resource-link-routing.md`](../docs/tactical/009-local-resource-link-routing.md).
- C/C++ UTF-8 escape sequences in string literals (e.g. `"\xc3\xa9"` → `é`) are
  not decoded. This would require detecting string literal boundaries and only
  applying UTF-8 decoding there, with the same Σ toggle UI.
- Comment/string-literal markdown rendering in source files is not attempted;
  the tradeoff between false positives and useful rendering favours
  source-only display for all code.
- GitHub-flavored Markdown footnotes (`[^id]` / `[^id]: ...`) are not yet
  supported by the server Markdown renderer. If footnote support is added later,
  full-file previews should render real footnotes, and a whole-document preview
  that marks a selected range should keep those document-level footnotes
  semantically intact. Exact range-only previews may use a lower-cost local
  treatment instead of reproducing table-footnote layout: when the displayed
  range references a footnote, pull in only that matching definition and show it
  inline, as a tooltip, or as a compact note after the rendered fragment. A
  future higher-fidelity range marker path should render the document in whole
  chunks with renderer-provided or coarse source-line alignment, then place range
  markers against that rendered output. The broader `.qmd`, caption,
  cross-reference, figure-layout, and optional delayed-render work is tracked in
  [`gaps/quarto-aware-document-view.md`](../gaps/quarto-aware-document-view.md).
  The currently supported `.qmd` recognition and inert include-link behavior
  are specified in
  [`topics/quarto-markdown.md`](../topics/quarto-markdown.md).
- Edit diff rich render does not yet inline-expand image links. This would help
  Markdown edits that add or update `![image](...)`, but it should share the
  local-media hydration path rather than adding a second image loader.

## Malformed and partial tool records

### Historical tool display audit

`pnpm tools:audit` scans historical Codex and Claude transcripts offline to
find registered tool rows rejected by display contracts. With no roots it scans
`CODEX_HOME/{sessions,archived_sessions}` and `CLAUDE_CONFIG_DIR/projects`, using
the normal `~/.codex` and `~/.claude` defaults. Repeat `--codex PATH` or
`--claude PATH` for files, alternate profiles, or copied trees; explicit roots
replace defaults. Claude subagent JSONL files are included recursively. The
reported provider is the transcript family, not an inferred gateway/OSS backend.

The command uses production JSONL/Claude cache parsing, Codex lineage resolution,
session normalization, task snapshots, persisted augments, and transcript
compilation before testing final tool rows. It does not apply API tail limits.
Claude's production active-branch selection still applies; discarded branches
are not independently replayed. Referenced ancestors must be inside the chosen
Codex roots. Copied/forked histories can count the same underlying execution
more than once. Plain and compressed twins at the same path count once, with
the plain representation preferred. Zstd is read without unpacking files and
requires a Node runtime supporting native zstd (Node 24 is recommended).

Only explicit report exports write files: `--output REPORT.json` writes the
main JSON report, and optional `--locations PRIVATE.json` writes the separate
file-id-to-path map. Both refuse existing destinations and use owner-only file
permissions where supported. Without `--output`, JSON goes to stdout; progress
goes to stderr. No provider/server/index is started, no model calls are made,
and no transcript or media is rewritten, fetched, or preserved. Each file runs
in its own worker with a 2 GiB V8 heap ceiling and a 120-second timeout;
`--timeout-seconds N` changes the deadline. Memory still scales with one full
transcript, and a worker failure is reported rather than losing the scan.

Reports contain revision/dirty-state provenance, coverage counts, parsing/read
failures, per-file warnings, and bounded structural examples grouped by family,
version, tool, reason, and shape. Payload strings, arbitrary object keys, raw
exception/Zod messages, paths, and call identifiers are omitted or hashed.
Only known structural vocabulary and allowlisted block types survive. Keep the
optional locations file private. Examples are shape witnesses, not replayable
fixtures; inspect locally and sanitize deliberately before adding a test.

Successful raw, error raw, and unfinished raw rows are separate categories.
Unknown tool registrations are counted separately. Targeted alias-loss checks
cover Shell `cellId`/`command`/`cmd` and create-goal `tokenBudget`; this is not
exhaustive detection of stripped fields. There is no browser mounting, media
materialization, commentary transformation, live-event replay, or proof that an
accepted renderer retains every affordance. Raw candidates require triage.

Exit 0 means the selected scan completed, even with candidates. Optional
`--fail-on-findings` returns 1 for successful raw or targeted alias-loss findings.
Exit 2 means invalid invocation or incomplete coverage: failures, malformed
records, changing files, skipped symlinks/unrecognized Codex filenames,
discovery errors, no audited files, or a `--limit N` excluding discovered files.
Absent default roots are counted without failing an otherwise valid scan;
missing explicit roots are errors. A partial report retains completed files.

### Display boundary contract

A valid SDK message or persisted JSONL record does not guarantee valid tool
arguments or a complete successful result. Providers can retain rejected calls
and interrupted inputs, and result schemas intentionally permit partial data.
Those records remain readable; display validation must not reject a session,
rewrite the transcript, or infer missing content as an empty successful result.

Before invoking rich tool rendering, the client checks its display requirements.
Every specialized registration binds input, result and optional failure/partial
schemas to private callbacks with `defineTool`. `toolDisplayContracts.ts` owns
all registered variants; `tools/index.tsx` enforces exact registration coverage.
Types derive from schema output. Public callers receive safe prepared operations
or inert metadata, never unchecked callbacks. Summaries and dynamic names use
the same boundary as collapsed, expanded, inline, standalone and nested views.

Preparation is data-only, bounded to the displayed record and shared across row
operations after commentary transforms its input/output. There is no transcript
scan or unbounded cache. The prepared record carries parsed values, execution
status and rich/partial/raw classification. Rejections use an explicit failure
schema or raw inspection, never a success parser. The effective error flag is
`isError ?? status === "error"` for every operation; pending, incomplete and
aborted remain distinct states. Standalone support is declared per tool.

Known consumed augments (highlights, Markdown, diffs, media, project links and
task snapshots) are checked explicitly. Nested Task content checks its block
fields and retains JSON tool arguments only for the nested checked dispatcher;
those arguments do not become trusted inputs to the parent renderer. Original
records remain separately owned by inspection infrastructure. Plain text from
providers lacking structured metadata gets an explicit partial presentation
with checked input previews. Read dedup and the named Edit replacement, raw
patch, augmented, changes and target-only alternatives remain usable.

Provider schemas and advisory warnings stay separate; they describe retained
records rather than proving rich rendering eligibility. Unknown tools retain
ordinary disclosure behavior with generic original-data inspection.

Server-materialized tool media is independently eligible for its existing
image/video presentation. A rejected text-preview schema must not hide stored
media, its expansion control, or validated source-path actions. Media rows
preserve actual execution status and use the session's normal source transport;
they do not pass unchecked text results to rich renderer callbacks. As before,
media-bearing rows use the media presentation in place of the text preview.

When required display data is missing or has the wrong type, the tool row
shows its name and actual status with a closed, explicit original-data
disclosure. Expanding it reveals the original output and input. A failed Write
missing `file_path` or `content` keeps a visible failed status and its provider
validation error in that disclosure, without deriving a path or splitting
missing content. Partial successful Read files, Edit hunks without lines, and
questions without options use the same fallback. No successful result is
relabeled as a failed execution merely because its preview is unavailable.
Unknown augmentation fields are retained, and Claude Read dedup records with a
file path but no body keep their distinct “unchanged” display.

Observed text-block acknowledgements do not suppress input-side Edit diffs or
UpdatePlan steps/counts. Plan sibling output is available behind disclosure.
Nullable Edit original context means unavailable context, not proof of a new
file. Read `file_unchanged` and echoed question results without `multiSelect`
retain their existing presentation. Checked Shell and goal projections retain
the aliases their helpers consume. The audit compares those original/parsed
values rather than treating alias presence as evidence of loss.

Shell text arrays reuse the ordered code-mode decoder and shared output view,
including command metadata and closed raw inspection; command stdout stays a
leaf. ViewImage's checked path action accepts text/image descriptor arrays even
without materialized media. A missing source remains unavailable. Spawn text
rejections with no agent id retain the specialized failed badge even when the
native error flag is missing; this does not rewrite the provider record.

Every tool row also contains unexpected React rendering exceptions locally,
including exceptions from commentary and nested tool displays. Adjacent rows
and the surrounding session remain usable; the affected row keeps its raw
record and local error visible. Updated input, output, status, or tool identity
retries rich rendering. This containment is a last resort, not a claim that all
provider/tool shapes now have exhaustive display schemas. It does not catch
unrelated asynchronous callbacks or event-handler errors.

Registry-driven controls mount every declared variant and operation, assert
semantic content, damage nested fields deterministically, and exercise lifecycle
and standalone requirements. Unexpected synchronous and React boundary catches
are counted; ordinary positive/negative controls require zero catches and zero
console warnings. Dedicated throw tests assert local recovery and neighboring
usability. Type fixtures and parser-backed architecture checks prevent common
registration, fixture and callback-access omissions. See provider-authoring for
the new-tool procedure and stream/persisted parity for native coverage limits.

### Required display semantics and review regressions

The callback contract uses function-valued properties with strict parameter
checking. A callback cannot explicitly require a field absent from its schema;
compile-fail controls cover annotated input and result parameters as well as
inferred property access. Schemas alone determine inference at registration.

Claude search results may mix commentary strings and link groups; valid links
remain links. PDF Read results do not require an image MIME field. Image
metadata may provide only original dimensions. TaskOutput retains `success`,
`not_ready`, and `local_agent`, and does not invent an exit code when absent.
Task text retains checked `_renderedHtml`. Nested tool-use blocks require an id
and name before entering nested dispatch; malformed blocks use inspection
without requiring a rendering exception.

Supported Edit and Task rejections retain their specialized failure views and
original error detail. A declined Edit with a checked proposed patch still
shows that patch. Edit acknowledgements remain visible text rather than an
invented empty before/after diff. Goal failures retain string, content, and
nested message/detail forms. Other failures without an explicit checked failure
contract remain inspectable raw records. Failure eligibility is independent of
success schemas; commentary must retain an absent error flag's status fallback,
including when status changes without replacing the output object.

Shell/WriteStdin failures explicitly accept the checked string or command-output
envelope used by successful polls. They retain readable output, nonzero exit
metadata, and failed status instead of exposing the envelope as raw JSON.

ExitPlanMode and UpdatePlan standalone results display their plan or
acknowledgement. Standalone Edit requires a result fact (path, patch, or text);
an empty object is insufficient. Input-only augmentation is not fabricated
when the original input is missing. Original unknown fields remain available
for inspection, not trusted rich access.

`displayExpectations.ts` requires a separate semantic expectation for each
variant/operation. An intentional empty operation is explicit; another
operation's summary cannot satisfy its assertion. Standalone expectations
account for facts present only in input. Independent provider-shape and failure
controls complement mutation containment tests; mutation counts are not counts
of independent semantic contracts. Bash views consume prepared object results
without reparsing them; Conversation name and summary share one preparation.

### Native display integration checks

Native ingestion-to-rendering checks live in `packages/client/test/`, outside
the browser application source tree. They still run with the client Vitest
suite and are typechecked by `pnpm tools:typecheck` using the server-owned
Node types. Client application builds must not pull provider adapters or
server test harnesses into their TypeScript program through these tests.

Completed Markdown prose and pending code do not initialize Shiki. The augment
generator shares one lazy highlighter initialization when its first finalized
code block needs syntax highlighting, preserving highlighted final output.
