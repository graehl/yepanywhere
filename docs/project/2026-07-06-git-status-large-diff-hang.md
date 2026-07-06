# Git status large diff browser hang investigation

**Date:** 2026-07-06
**Route:** Source Control / git status page for a local project
**Reported symptom:** Chrome showed the browser "wait or kill" unresponsive
prompt while the Source Control page was open and the user attempted to press
Push. Closing and reopening the tab recovered temporarily.

## Problem Statement

The Source Control diff preview can generate and render a multi-megabyte HTML
diff for a single untracked source-like file when that file is a large
single-line document, such as generated JSON. That payload is expensive in two
places:

- the server syntax-highlights the entire line and returns a large `diffHtml`
  string;
- the browser injects that HTML and lays it out as one very wide highlighted
  diff line.

The observed incident looked push-adjacent because the user was interacting
with the Source Control action bar, but the strongest evidence points to the
selected untracked JSON diff preview as the browser hang trigger. I did not
find evidence of a direct React infinite-render loop in the push handler.

## Observed Incident

The screenshot taken during the hang shows:

- the Source Control page for a local project;
- the Push button visible in the action bar;
- an untracked generated JSON file selected in the split diff preview;
- the preview rendering a single enormous inserted JSON line.

At investigation time, local git status for the project was small overall:

```text
## main...origin/main
 M <modified-source-file>
?? <large-untracked-json-file-a>.json
?? <large-untracked-json-file-b>.json
?? <large-untracked-json-file-c>.json
?? <large-untracked-json-file-d>.json
```

So the changed-file list itself was not large enough to explain a browser
freeze.

## Evidence

### The selected untracked JSON files are large single-line documents

The selected generated JSON file was effectively one logical line. Similar
untracked files in the same status snapshot had this shape:

```text
0 lines, 132305 bytes  <large-untracked-json-file-a>.json
0 lines, 131398 bytes  <large-untracked-json-file-b>.json
```

`wc -l` reports zero because these files have no trailing newline; the relevant
point is that the whole file is one logical line.

### The diff endpoint amplifies one 132 KB line into a 7.9 MB response

Measured against the local server with the required `X-Yep-Anywhere: true`
header:

```text
POST /api/projects/.../git/diff
body: {
  "path": "<large-untracked-json-file-a>.json",
  "staged": false,
  "status": "?"
}

HTTP 200 in ~0.53s
response bytes: 7,940,595
diffHtml bytes: 7,545,552
patch lines: 1
max patch line length: 132,306
HTML <span> count: 131,201
line span count: 2
```

For comparison, a normal modified source file in the same status snapshot
produced a much smaller response:

```text
POST /api/projects/.../git/diff
body: {
  "path": "<modified-source-file>",
  "staged": false,
  "status": "M"
}

HTTP 200 in ~0.50s
response bytes: 102,630
diffHtml bytes: 87,833
patch lines: 264
max patch line length: 101
HTML <span> count: 1,633
line span count: 275
```

The problematic file is only about 1.2x the raw size of the comparison diff
response, but its highlighted HTML is about 86x larger.

### Relevant code path

The client fetches a diff for the selected file whenever `GitDiffBody` mounts
or the selected file identity changes:

- `packages/client/src/pages/GitStatusPage.tsx:1154`
- `packages/client/src/pages/GitStatusPage.tsx:1160`

The server handles untracked files by reading the entire file as new content:

- `packages/server/src/routes/git-status.ts:433`
- `packages/server/src/routes/git-status.ts:488`

The server then calls the general edit-augment diff highlighter:

- `packages/server/src/routes/git-status.ts:441`
- `packages/server/src/augments/edit-augments.ts:294`

The highlighter currently caps line count only:

- `packages/server/src/highlighting/index.ts:17`
- `packages/server/src/highlighting/index.ts:207`

That guard does not help with a one-line 132 KB JSON file. Shiki tokenizes the
whole line and returns many nested spans.

The client renders highlighted diffs via `dangerouslySetInnerHTML` and lays
them out as a flex column with `width: max-content`:

- `packages/client/src/pages/GitStatusPage.tsx:1783`
- `packages/client/src/styles/renderers.css:2066`

That layout is reasonable for normal diffs, but it is hostile to a single line
with 131k token spans and a very wide intrinsic width.

### Polling is a secondary pressure, not the primary trigger

`useGitStatus` force-polls while the tab is visible:

- `packages/client/src/hooks/useGitStatus.ts:201`
- `packages/client/src/hooks/useGitStatus.ts:207`

The status response for this project was small and fast:

```text
GET /api/projects/.../git
HTTP 200 in ~0.12s
response bytes: 1,860
```

Polling is therefore unlikely to be the direct cause for this incident.
However, it can add background renders around an already-expensive diff
preview, especially because each snapshot is written into route retention:

- `packages/client/src/hooks/useGitStatus.ts:149`

The page also computes a status revision with `JSON.stringify` over the file
key list:

- `packages/client/src/pages/GitStatusPage.tsx:1400`

That is bounded for the observed project, but it remains a smell for very large
working trees.

## Non-Findings

I did not find a direct push-button infinite render. The push handler:

- exits if an action is already running;
- performs one `api.pushGit(projectId)` request;
- invalidates retained route state and refreshes status only on success-like
  outcomes;
- clears `isPushing` in `finally`.

Reference:

- `packages/client/src/pages/GitStatusPage.tsx:572`

The more plausible sequence is:

1. the Source Control page already had an expensive untracked JSON diff
   selected;
2. browser layout or GC was under pressure from the huge highlighted preview;
3. clicking near Push surfaced the unresponsive-tab prompt, making the action
   appear causally related.

## Recommendations

### Immediate Remediation

Add a large-diff admission guard before syntax highlighting git diffs.

Suggested first-pass policy:

- skip syntax highlighting when any diff line exceeds a fixed character limit
  such as 20,000 characters;
- skip syntax highlighting when `oldContent.length + newContent.length`
  exceeds a fixed byte/char budget for source-control preview, such as
  256 KB;
- return structured metadata that tells the client the preview was omitted or
  downgraded because it is too large.

This should happen server-side before Shiki is invoked. Avoid relying only on
client-side rendering guards, because the current server response can already
be multi-megabyte.

### Client UX

When the server marks a diff as too large:

- show a compact message in the preview pane;
- include file path, raw file size, and reason if available;
- offer a normal file-view/open-raw path if one already exists;
- keep the rest of Source Control interactive.

For untracked files, the message can be explicit:

```text
Preview skipped: this untracked file is a large single-line document.
```

### Rendering Guard

Add a client-side defense in depth for `diffHtml`:

- do not inject highlighted diff HTML above a conservative size limit;
- fall back to the same compact "preview skipped" state if the server was old
  and returned an oversized payload anyway.

This protects newer clients when connected to older or locally modified
servers.

### Highlighting Guard

Extend `highlightCode` or its diff call sites with a max-line-length/output
budget. The existing `MAX_LINES = 10000` prevents many-line documents from
being highlighted, but single-line generated JSON bypasses it completely.

Potential guard dimensions:

- maximum input characters;
- maximum individual line characters;
- maximum generated HTML characters;
- maximum token span count if Shiki exposes a useful intermediate shape.

Prefer a call-site-specific policy for git diffs if the global highlighter is
also used for places where a different trade-off is appropriate.

### Route-Retention/Polling Cleanup

As a follow-up, reduce avoidable background churn:

- avoid emitting route-retention updates for unchanged git status snapshots;
- consider not force-polling while a remote git action is in flight;
- avoid repeatedly recomputing large `JSON.stringify` revisions for status
  objects when a cheaper server revision or stable snapshot identity is
  available.

These are secondary improvements. They are not the primary fix for the
observed hang.

## Suggested Acceptance Criteria

- Opening Source Control on a project with a 100 KB or larger one-line
  untracked JSON file does not freeze the browser.
- Selecting that file shows a bounded preview/omission state within one frame
  after the diff response is processed.
- The `/git/diff` response for that file is bounded to a small response, not a
  multi-megabyte highlighted HTML payload.
- Normal small text diffs still render with syntax highlighting.
- The Push, Pull, and Check remote buttons remain responsive while a large
  preview is selected.

## Key File References

| File | Role |
|---|---|
| `packages/client/src/pages/GitStatusPage.tsx:572` | Push handler, not likely an infinite render source |
| `packages/client/src/pages/GitStatusPage.tsx:1154` | Selected-file diff fetch effect |
| `packages/client/src/pages/GitStatusPage.tsx:1783` | Highlighted diff HTML injection |
| `packages/client/src/hooks/useGitStatus.ts:201` | Visible-tab git status polling |
| `packages/server/src/routes/git-status.ts:433` | Git diff route reads file versions |
| `packages/server/src/routes/git-status.ts:488` | Untracked file treated as whole-file addition |
| `packages/server/src/augments/edit-augments.ts:294` | Syntax-highlight old/new content for diff |
| `packages/server/src/highlighting/index.ts:207` | Line-count-only highlight truncation |
| `packages/client/src/styles/renderers.css:2066` | Highlighted diff layout uses `width: max-content` |
