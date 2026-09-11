# Restore supported tool displays after contract hardening

Status: targeted media and failed-Shell repairs locally validated, 2026-09-11;
deployment pending. The reusable read-only audit is implemented
and the larger second-machine corpus has been audited and triaged against the
September 10 changes. The broader text/schema and compact-fallback repairs
below remain pending.

## Current-session media and failed-Shell repair

The 09:01 screenshot from session `01a08eeb-28c9-7112-b8bf-a5d19fef841f`
shows a completed Exec result rejected as raw. The local session API confirms
call `call_XhxUWf5ThAwosPSnChKd0etZ` retains two `input_text` blocks and an
`input_image` descriptor, plus one stored 886×703 PNG. The text-preview gate
returned before `ToolResultMediaRows`, hiding an already-materialized image.
Latest had successfully deployed `fd327fccd`; this was not stale backend data.

Move the existing media presentation ahead of the unrelated text-preview
rejection. This preserves media actions for Exec, ViewImage, and detached Shell
rows without widening their text schemas or changing storage/decoding. The
existing choice to show media in place of a text preview is preserved. Complete
row tests use a sanitized observed envelope and exercise lazy image expansion
through a fake relay transport, including a malformed-input control.

The earlier screenshot's failed Git push is a separate WriteStdin case:
`exit_code: 1` is correctly marked failed, but no failure contract was declared.
Declare its supported string/command-output failure form so the existing Shell
renderer can show readable output and nonzero exit metadata. A mounted full-row
regression retains failed status and rejects raw-envelope presentation.

Remaining: text-only result arrays, no-media ViewImage path-only eligibility,
input aliases, Edit/Read/question/plan cases, failed subagents, and compact raw
fallback. The historical audit's text-preparation classifications are unchanged
for media-bearing arrays; those counts alone do not describe media visibility.
No provider compatibility marker or native transcript is changed.

Validation: 1,129 focused checks and all 11,692 workspace tests pass (55 existing
skips), plus 220 browser tests (seven environment-dependent skips). Typecheck,
formatting, console budget, and lint pass with zero lint warnings. A separate
cleanup removes an unused quote-rail test suppression exposed by root lint.

At the user's request, loaded this exact session on `localhost:3400` with the
working client at desktop 1000×600 and phone 375×812. The Exec row displays its
filename/dimensions and expands a decoded 886×703 PNG; the media endpoint returns
HTTP 200 with 160,071 bytes. The earlier failed Shell row expands readable Git
stderr with error styling and `rc=1`, without the JSON envelope. Inspected both
sizes sequentially for each case; no stale-runtime banner or page errors.
The capture harness reports its expected service-worker-blocking warning.
Captures are local-only under `.artifacts/ui-testing/2026-09-11-renderer-repair-local/`
and `.artifacts/ui-testing/2026-09-11-shell-repair-local/`; the image shown by
Exec is the previous screenshot, so its contents still depict the old failure.

## Evidence and scope

The September 10 registry migration (`ee42f7f7f`), following crash fix #124,
rejects valid Codex ViewImage output arrays. In session
`01a08b0b-740c-7cf3-b55d-7cc25cfae9e4`, all 13 ViewImage calls in the inspected
window have valid paths and stored media, yet fail result eligibility. The
early raw return in `ToolCallRow` bypasses both the filename affordance and
`ToolResultMediaRows`. The old renderer only needed the input path.

The raw fallback introduced in `dedea8fa7` expands pretty-printed output by
default; its 18rem scrolling limit still consumes substantial transcript
space. The image fixture uses `null`; the native corpus substitutes the string
`Image displayed`, so neither tests the observed multimodal result.

Continue [tactical 124](124-enforced-tool-display-contracts.md), the existing
[native coverage gap](../../gaps/tool-display-native-provider-coverage.md), and
the [rich-rendering contract](../../topics/rich-text-rendering.md#malformed-and-partial-tool-records).
The [forwarded-image duplication gap](../../gaps/code-mode-forwarded-image-duplication.md)
is separate; this work does not authorize image deduplication or storage changes.
The implemented [ViewImage rematerialization repair](114-codex-view-image-rematerialization.md)
concerned server-side media candidates; this incident already has stored media.
This repair does not change roadmap priorities.

## Implementation steps

### 1 — Preserve valid image and media affordances

Cover observed text/image result arrays and gate each presentation on the data
it actually consumes. Keep valid stored media and validated file-path actions
available when unrelated rich result parsing fails. Preserve actual execution
status and the original data; retain containment for malformed Write and other
records. Do not solve this by removing validation across the registry.
Cover Exec multimodal results, detached Shell/wait output arrays, and Edit
acknowledgement arrays without throwing away validated input-side diffs. Check
the nullable Edit original-file case and explicitly retain supported aliases
consumed by renderer helpers. Do not blanket-pass unchecked fields to callbacks.
Also preserve UpdatePlan's input-side steps when its acknowledgement is an
array, and AskUserQuestion's selected answers when an echoed result question
omits `multiSelect`. Preserve the existing failed subagent indication when a
native rejection lacks an error flag; distinguish that upstream status gap
from successful-result eligibility.

### 2 — Make fallback compact and inspectable

Use the normal compact tool-row presentation with a short unavailable-preview
indication and explicit disclosure for raw input/output. Avoid an expanded JSON
box for successful calls. Actual execution errors must remain discoverable.
Keep diagnostics available without making them the default transcript body.
Update the owning rich-rendering topic when behavior is implemented.

### 3 — Prove successful presentation as well as containment

Add sanitized observed multimodal specimens independent of display fixtures.
Exercise normalization, pairing, the complete ToolCallRow, stored media, path
actions, nested/forwarded Exec output, pending-to-complete transitions, and raw
disclosure. Assert intended affordances, not only no exceptions or schema
acceptance. Preserve #124 rejection/recovery controls. Review other contracts
for rejected supported shapes and schema projections that silently drop fields.

Run required source checks and UI integration checks at implementation time;
inspect desktop/phone captures for compactness and working media controls.

## Reusable historical audit and second-machine handoff

`pnpm tools:audit` replaces the ad hoc probes below. Its maintained command,
exit-code, privacy, and coverage contract is in
[rich text rendering](../../topics/rich-text-rendering.md#historical-tool-display-audit).
The implementation lives in `scripts/audit-tool-displays.ts` and
`scripts/tool-display-audit.ts`; regressions are in
`packages/server/test/tool-display-audit.test.ts` and participate in ordinary
tests and `tools:typecheck`.

On the other machine, update this checkout with `git pull --ff-only`, use Node
24 for compressed-rollout support, and run:

```bash
pnpm install --frozen-lockfile
pnpm tools:audit --output ~/tool-display-audit.json --locations ~/tool-display-audit.locations.json
```

The output names must be new. Defaults cover `CODEX_HOME/sessions`,
`CODEX_HOME/archived_sessions`, and `CLAUDE_CONFIG_DIR/projects`, with the usual
`~/.codex` and `~/.claude` defaults. Repeat explicit `--codex PATH` and
`--claude PATH` to include alternate profiles or copied histories; explicit
roots replace the defaults. Include ancestor rollout roots when inspecting
reference-backed children. Use `--timeout-seconds 300` for unusually large
files. `--limit N` is a deliberately partial smoke test, not a corpus sign-off.

Send back `tool-display-audit.json`; retain the locations file privately on the
machine for locating hashed examples. Compare groups by provider family,
version, tool, rejection reason, and structural shape. The same underlying call
can occur in multiple copied/forked histories, so counts are transcript-row
occurrences, not unique executions. A group merits a sanitized regression
fixture and before/after presentation check before being called a regression.
Expected execution-error fallback has separate counts.

### First full local corpus run

The working implementation on 2026-09-11 scanned all 261 discovered default-root
files: 166 Codex rollouts and 95 Claude transcripts, about 1.2 GB. Five Codex
leaves had reference-backed history. No malformed lines, read failures,
normalization/compiler warnings, or source changes during reads were reported.
The scan produced 24,917 compiled tool rows, of which 22,181 were registered:
19,325 rich, 26 partial, 2,667 successful raw, 152 error raw, and 11 unfinished
raw. The 2,736 unregistered rows are counted separately.

Successful raw candidates by tool: Edit 1,725; WriteStdin 598; ViewImage 240;
Exec 91; Read 6; get_goal 5; create_goal 1; update_goal 1. This adds two useful
findings beyond the small sample: six Claude 2.1.251 Read results have
`type: "file_unchanged"` with a valid `filePath`, and seven Codex 0.152.0 goal
results use code-mode text arrays. Both are rejected by the current contracts.
Include them in the repair fixtures and validate the old affordance before
claiming a complete semantic fix.

Local reports were explicitly written outside the checkout to
`/tmp/ya-tool-display-full-20260911.json` and
`/tmp/ya-tool-display-locations-20260911.json`; neither is committed. This is
full selected-file coverage under the command's documented projection limits,
not full browser or every-provider coverage. These final-row counts differ
from the earlier API-window, pre-folding counts below.

Validation on macOS / Node 24.20.0: all 12 focused audit regressions pass,
including full history across compaction, inherited history/missing parents,
Claude subagents, native zstd, malformed data, partial scans, timeout isolation,
new-output protection, and redaction. Root lint (zero warnings), formatter,
typecheck, and workspace tests pass: 11,583 tests passed, 55 skipped. The final
focused suite and tool typecheck passed again after the last command changes.
Linux/Windows execution remains for CI/the second machine; the command uses
portable Node filesystem and child-process APIs. No UI source changed, so no
browser rendering verification is claimed.

### Second-machine full historical audit

The 2026-09-11 macOS run used Node 24.19.0 and clean `main` at
`2d1c806814d49ebf099501612924c4c52a00330e`, after `git pull --ff-only origin main`
and `pnpm install --frozen-lockfile`. Neither provider-root environment override
was set. All 9,196 discovered transcripts were processed: 7,212 Claude files
(including nested subagents), 1,980 active-root Codex rollouts, and four archived
Codex rollouts, approximately 17 GB altogether. Two Codex leaves were
reference-backed. There were no duplicate plain/compressed representations.

The ordinary CLI's sequential scan was replaced by a temporary external driver
running the reusable `runAuditWorker` with 12 concurrent workers and a
300-second per-file deadline. The driver retained the CLI's discovery, full
ancestor map, ordered aggregation, redaction, and completion checks; it did not
replace parsing or projection or modify repository source. An unmodified
`pnpm tools:audit` control over ten explicit files (six Claude, four archived
Codex) produced identical per-file summaries and candidate-category totals.
This scheduling change is local audit orchestration, not a new command option.

| Final-row classification | Claude | Codex | Total |
| --- | ---: | ---: | ---: |
| All tool rows | 250,653 | 714,593 | 965,246 |
| Registered rows | 249,493 | 706,490 | 955,983 |
| Rich | 179,339 | 594,550 | 773,889 |
| Partial | 63,899 | 20,585 | 84,484 |
| Successful raw candidates | 3,231 | 80,133 | 83,364 |
| Error raw | 3,024 | 9,675 | 12,699 |
| Unfinished raw | 0 | 1,547 | 1,547 |
| Unregistered rows | 1,160 | 8,103 | 9,263 |

No worker/read/lineage failures, malformed lines, discovery errors, unrecognized
Codex filenames, or changes during individual reads were reported. The command
nevertheless returned exit 2 / `complete: false`: discovery skipped two broken
`memory/MEMORY.md` symlinks inside Claude project directories. Both are
non-transcript memory links, not omitted JSONL histories. Keep the report's
conservative flag; selected-transcript coverage is complete, but this is not a
warning-free or universal-provider sign-off. The 222 compiler warnings are
triaged separately below. Targeted alias-loss detections were zero.

The [report](/tmp/ya-tool-audit-20260911-mac/report.json) and
[private lookup](/tmp/ya-tool-audit-20260911-mac/locations.json) remain outside Git.
Their directory also
holds the external driver, per-file results, sequential control, private
specimens, contract comparisons, and temporary mounted probes. The report was
generated at `2026-09-11T05:38:43.877Z`; its source dirty flag is false.
Do not commit the private lookup or payload specimens. Counts are row
occurrences, including copied/forked history, not unique executions. Version
groups use the audit's file/leaf metadata, not a separate version determination
for every inherited call.

### Second-machine rejection triage

The following table accounts for all 83,364 successful-raw candidates. These
are **normalized success classifications**, not proof that every call executed
successfully. Shape-level counts and representative presentation evidence are
deliberately distinguished.

| Family / display | Candidate rows | Finding and September 10 attribution |
| --- | ---: | --- |
| Codex Edit | 39,648 | Code-mode acknowledgement arrays reject usable input patches/diffs. Initial hardening `dedea8fa7`; same mechanism as the first-machine finding. |
| Codex WriteStdin | 32,698 | Result arrays fail the registry gate: 32,677 text-only and 21 mixed text/image arrays. Registry migration `ee42f7f7f`; include mixed Shell media in the repair matrix. |
| Codex ViewImage | 6,784 | 6,750 image-bearing arrays and 34 text-only arrays reject valid path input. Registry migration `ee42f7f7f`; image-bearing records establish the broader shape coverage, while text-only output needs execution-status triage. |
| Claude Edit | 3,215 | `originalFile: null` rejects otherwise usable replacements and structured hunks. Confirmed retained-record and mounted diff regression, introduced by `dedea8fa7`. Null is unavailable original context, not proof of a new-file operation. |
| Codex Exec | 904 | Every candidate has mixed text/image output. Registry migration `ee42f7f7f`; the existing media/fallback regression recurs across this corpus. |
| Codex Bash | 46 | Inputs lack `cmd`/`command`; all 46 outputs are missing-`cmd` argument-parse failures retained with `isError: false`. Do not repair these by accepting arbitrary input keys. Registry rejection is appropriate; upstream failure classification is separate. |
| Codex goal tools | 34 | `get_goal` 18, `update_goal` 9, `create_goal` 7: text-array results reject at `ee42f7f7f`. The old goal parser also failed to decode these arrays; do not claim loss of a formerly working result-only goal-details view. |
| Codex UpdatePlan | 15 | Text-array acknowledgements hide validated input steps and completion counts. Newly confirmed mounted regression from `ee42f7f7f`. |
| Claude Read | 13 | `type: "file_unchanged"`, `file: { filePath }` is rejected. The pre-registry gate and mounted renderer preserve the filename and unchanged indication. Regression from `ee42f7f7f`. |
| Codex spawn_agent | 3 | Plain-text full-history-fork rejections carry no agent id but are normalized complete/non-error. The old inline view shows a failed badge; `ee42f7f7f` replaces it with raw output labeled complete. This is a failure-presentation regression plus pre-existing native error-flag debt. |
| Claude ExitPlanMode | 2 | Results have `plan: null`, with no input plan or rendered HTML. New raw fallback at `ee42f7f7f`, but the old inline renderer returned nothing: no retained plan body was lost. Include in compact-fallback controls. |
| Claude AskUserQuestion | 1 | Input has `multiSelect: false`; the echoed result question omits it. Old selected-answer rendering works, but `dedea8fa7` rejects the whole result. Newly confirmed retained-record regression. |
| Codex Web | 1 | Image-query result is a text array, rejected at `ee42f7f7f`. The old result renderer displayed `No content`, not decoded output or page cards. Record the fallback transition without claiming lost page-card support. |

Nullable Edit findings span Claude file versions 2.1.111 through 2.1.223;
unchanged Read appears in 2.1.90, 2.1.111, and 2.1.199. The omitted-question-field
witness is 2.1.55; null plans are 2.1.56. UpdatePlan witnesses occur in Codex
0.144.1, 0.146.0, 0.147.0, and 0.148.0. This expands the earlier narrow-window
evidence without turning old transcript versions into a provider-refresh claim.

Local replays extracted 71 structural witnesses through the production
normalization/augmentation/compiler path. Comparing those actual records with
the initial gate, `ee42f7f7f`, `d5850a6b4`, and current contracts confirms that
the September 10 review correction did not restore these rejected shapes.
Temporary jsdom probes imported pre-hardening/pre-registry renderer snapshots,
with current shared support components, and mounted sanitized inputs alongside
current prepared callbacks. They prove the old Edit diff, Read filename and
unchanged indication, selected question answer, UpdatePlan steps/count, and
subagent failed badge. They also verify both supported-input alias losses:
Shell loses its command/target; pending create-goal loses its budget. Neither
alias was observed by the targeted full-corpus detector.

Reproducible sanitized controls include:

- Edit: `/tmp/example.txt`, `before` → `after`, one `-before`/`+after` hunk,
  `originalFile: null`; the old preview contains both sides, current is raw.
- Read: `{ type: "file_unchanged", file: { filePath: "/tmp/example.txt" } }`;
  the old result includes the filename and unchanged indication, current is raw.
- AskUserQuestion: input question with `multiSelect: false`; the same question
  in the result without that field, plus a selected answer. The old result
  displays the selection; both initial and current gates reject it.
- UpdatePlan: two input steps, one completed, plus
  `[{ type: "input_text", text: "Plan updated" }]`; the old view shows both
  steps and `1 out of 2`, current is raw.
- Shell: `{ cellId: "cell-42", command: "echo audit" }` renders its command and
  script-cell target before migration, but current prepared callbacks display
  `command session unknown`. Create-goal input with `tokenBudget: 1000` loses
  its displayed budget. These remain supported-input, synthetic controls.

Representative report selectors (hashed file id / hashed row call id) locate
the private witnesses without publishing paths, payloads, or native ids:

| Witness | File id | Call id |
| --- | --- | --- |
| Nullable Edit | `45350ba3d830e0d8e8e7` | `05f3b8c12a2a4b77bf7b` |
| Unchanged Read | `c60a18d96679384173b9` | `583c5125f9e91520ab34` |
| Question result omission | `57270cf9d7bccdcfa32b` | `bdeccd9ef9daf0b968f1` |
| UpdatePlan array | `14dcd484180865980459` | `a7937db5666e0f0d484d` |
| Misflagged spawn rejection | `5e0282804a12554e869e` | `c56855ce366733d8ea0f` |
| Web array | `6fbbffce1aa65c8d1e21` | `462a7509cf7d84ec3226` |

### Other historical findings and remaining gaps

All 222 recorded warnings are `Tool result for unknown tool_use`, across
14 Claude and five Codex files. Tracing both normalized message envelopes
confirms that their native and normalized tool uses exist:

- 33 Claude warnings involve repeated tool-use/result ids; 177 Codex warnings
  involve a single `exec_command` use with two normalized results, with native
  function-output and command-end records. The compiler has already removed the
  completed call from its pending map when the repeated result arrives.
  Do not treat those warning counts as 210 additional missing executions;
  equivalence of every repeated payload still needs a dedicated pairing check.
- The other 12 Claude results precede their uses in both native file order and
  normalized order. The final tool rows remain pending with no attached result.
  Example: file `d3b17c55940f34e91bad`, call `1f0c81be0de3a44a0fa5`; native
  result line 76 precedes use line 78. This is a confirmed historical pairing
  gap, separate from eligibility: `attachToolResult` drops early results, and
  that path predates September 10 (`067de36d4b`, July 19). Keep it separate from
  renderer repairs and the existing
  [pairing/render-warning investigation](../../gaps/codex-wake-session-switch-delay.md).

The audit still does not establish browser/media-materialization behavior,
commentary transformations, every discarded Claude branch, live-only states,
or other provider families. Image-bearing output is not proof that media was
materialized or that a browser action works. Accepted rich/partial rows were
not exhaustively mounted; field-loss checks cover only the named aliases.
Malformed native failures, result-array decoding, null acknowledgements, and
repeat/early-result handling must not be silently counted as repaired by a
future schema relaxation. Independent durable specimens and complete-row
desktop/phone checks remain required when renderer fixes are implemented.

Second-machine validation: 12 reusable-audit tests, ten temporary mounted
before/after/qualification probes, and the tool-fixture typecheck pass after
rebuilding the shared package's stale generated declarations. Root formatter
and lint checks pass; lint reports zero warnings and one existing informational
`useTemplate` suggestion in the audit test. The ten-file unmodified-CLI control
matches the full driver's summaries. This is
macOS/Node evidence; no Linux/Windows or full browser run is claimed. No source
or renderer files were changed, and no provider sessions or media fetches were
started. Full workspace tests from the tooling commit above are historical
evidence, not a new full-suite run for this documentation follow-up.

## Audit evidence, 2026-09-11

Read-only review covered all 26 registered contracts, targeted callback
projections, row/media ordering, the September 10 changes, and fixture/diagnostic
boundaries.
Data-only probes used 822 paired registered tool records from the current API
windows of 15 September 10 Codex sessions, plus 147 paired records from four
local Claude project transcripts. Windows can exclude compacted history; these
counts describe paired records before folding, not visible rows or full-history
coverage. No provider sessions were started and no UI implementation changed.

### Confirmed retained-record failures

| Display | Rejected paired records | Cause and user-visible consequence | Introduced |
| --- | ---: | --- | --- |
| ViewImage | 21 | Result arrays fail eligibility; valid file actions and stored media are bypassed. | `ee42f7f7f` |
| Exec | 16 | Result schema permits only text blocks, so mixed text/image arrays hide stored media behind raw JSON. Eight are in the original incident session. | `ee42f7f7f` |
| WriteStdin / wait | 2 | Detached code-mode results are arrays, but the schema accepts only strings/objects. The compact Shell presentation is replaced by raw inspection. | `ee42f7f7f` |
| Edit / apply_patch | 4 | Code-mode acknowledgement arrays fail the result gate even with usable `_rawPatch`, `_structuredPatch`, and `_diffHtml` on input. | `dedea8fa7` |

The original incident session passed through `compileTranscriptProjection`
still produces 13 rejected ViewImage rows and eight rejected Exec rows.
Session `01a08a4c-be06-7f13-a89e-057720815290` retains one rejected Shell row
after folding. Session `01a08b3b-04d4-7481-8f06-0d6ae5fd6098` retains one
rejected Edit row with input-side diff augmentation. Example call ids:
`call_zPqeUiKTVAhSPmxE098U7F0u` (Exec),
`call_PbKaBlAFZO7uwHPuL49FcrpR` (wait record), and
`call_DRGvE2ZK8Dncyv4g4TSee2eZ` (Edit). Keep private output/path contents out of
checked-in fixtures; preserve their structural shapes in sanitized specimens.

An in-memory comparison against the contract implementation immediately before
`ee42f7f7f` confirms rich-to-raw changes for ViewImage, Exec, and WriteStdin.
Edit arrays were already rejected by the initial #124 patch. Before that patch,
the Edit renderer could derive its diff from the input without consuming the
acknowledgement array. Both September 10 commits therefore need coverage in
the regression baseline.

The sampled Claude records (Bash, Read, WebFetch, WebSearch) produced no raw
eligibility failures. This does not establish coverage for other Claude tools
or providers, live-only shapes, commentary transforms, or browser interactions.

### Source-level compatibility losses requiring targeted specimens

- **Nullable Edit original file:** shared `EditResultSchema` explicitly permits
  `originalFile: null` for new files, and the renderer supports optional/null
  original context. The display schema rejects it. A data-only probe confirms
  rejection both now and immediately after `dedea8fa7`; no matching retained
  record was found in the original sampled windows. The second-machine corpus
  above now supplies 3,215 retained witnesses and a mounted before/after check.
- **Shell input aliases disappear:** `WriteStdinRenderer` reads `cellId`,
  `command`, and `cmd` as fallbacks. The new input schema strips all three;
  `{ cellId: "cell-42", command: "pnpm test" }` parses successfully to `{}`.
  This loses the supported target/command display without triggering fallback.
- **Pending goal budget disappears:** the create-goal renderer accepts
  `tokenBudget` as well as `token_budget`, but its input schema keeps only the
  latter. `{ objective: "Check", tokenBudget: 1000 }` loses the budget before
  rendering. No sampled native call established current provider use of this
  alias; record it as a supported-input regression, not an observed incident.

These alias losses start with `ee42f7f7f`. Probe each supported spelling through
actual prepared callbacks before deciding whether to preserve it or explicitly
retire an unused compatibility promise. Do not count every stripped unknown
field as a regression: only fields with an observable consumer qualify.

### Why existing verification missed these cases

- Exhaustive registration/variant enumeration is bounded by its fixtures.
  ViewImage uses `null`; the reconstructed native case substitutes
  `"Image displayed"`. Exec covers text-only results. Real code-mode envelopes
  need independent specimens for promoted tools as well as generic Exec.
- The all-or-nothing result gate runs before safe input-side actions and media.
  It turns a narrow parsing limitation into loss of unrelated usable UI.
- `toolDisplayDiagnostics` counts thrown exceptions, not schema rejection.
  Zero catches/page errors therefore does not prove rich presentation survived.
  The advisory validator also has no ViewImage, Exec, or WriteStdin schema and
  treats an absent schema as valid; it cannot diagnose these display rejections.
- Existing browser checks verify width, recovery, and selected semantics. They
  do not assert a compact fallback height or preserve media on rejected results.
  Add rejection-reason assertions for fixtures expected to remain rich, without
  conflating intentionally rejected malformed records with regressions.

Actual failed calls without a declared failure presentation deliberately use
raw inspection under tactical 124. Treat their excessive default expansion as
the shared fallback UX issue; do not automatically label every such rejection
as an unsupported successful-result regression.
