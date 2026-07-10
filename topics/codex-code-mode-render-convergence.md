# Codex Code-Mode Render Convergence

> Refactor Codex command normalization around one rollout-recoverable semantic
> action analysis so GPT-5.5-style calls and GPT-5.6 code-mode calls render
> useful `Explored` summaries without changing structure after reload.

Topic: codex-code-mode-render-convergence

Status: in progress. Extraction, parity propagation, and the bounded
live-to-rollout identity reconciliation are implemented as of 2026-07-10; the
client carries derived multi-action metadata but does not render it yet.

Canonical slice status, landed commit history, verification evidence, and
deferred follow-ups are tracked in
[`docs/tactical/059-codex-code-mode-explored-rendering.md`](../docs/tactical/059-codex-code-mode-explored-rendering.md).
This topic remains the product/architecture contract and evidence record.

Implementation progress:

- [x] Pin the local upstream reference to Codex `0.144.1` and verify the
  checked-in protocol artifacts.
- [x] Extract the existing read/search shell recognizers into standalone
  `codex/displayActions.ts` semantic analysis.
- [x] Derive ordered, fail-closed action vectors for the observed compound
  read sequence and compare them with sanitized live `commandActions` oracles.
- [x] Route existing single-action normalization through the new analyzer while
  keeping compound execution as one `Bash` call.
- [x] Carry rollout-derived multi-action analysis through the normalized
  in-memory tool-call shape with live/reload parity.
- [x] Reconcile one-to-one code-mode `commandExecution` parents to the outer
  durable `custom_tool_call` identity using exact same-turn semantics.
- [ ] Render one-to-many actions within `Exploring` / `Explored` groups.

The in-memory boundary is the provider-neutral `ToolDisplayAction` contract in
`packages/shared/src/tool-display-actions.ts`. Codex normalization attaches its
rollout-recoverable vector as `_displayActions` on a `tool_use` block, and
client preprocessing carries it to `ToolCallItem.displayActions`. Neither field
is written back to the rollout or to another YA-owned durable record. Live
`commandActions` remain test/diagnostic oracle data and do not populate this
field.

See also:
[stream-persisted-render-parity](stream-persisted-render-parity.md) (the graded
live/durable convergence contract),
[provider-read-edit-disciplines](provider-read-edit-disciplines.md) (current
canonical tool and exploration-kind layers),
[provider-refresh](provider-refresh.md) (upstream audit procedure), and
[codex-sessions](codex-sessions.md) (rollout reader behavior).

## Product constraints

1. **Codex rollout files are the sole durable transcript source of truth.** Do
   not add a YA-owned durable message, metadata sidecar, or shadow transcript
   to preserve live app-server detail.
2. **Tool calls present live and in rollout should strongly converge.** The
   active tail may move, but reload should not replace one tool structure with
   another, reorder calls, or change grouping merely because the live SDK had
   richer metadata.
3. **Useful live-only events remain allowed.** This plan does not prohibit
   ephemeral thinking, progress, status, or other tail information absent from
   rollout. It applies the stricter convergence expectation to Codex tool calls
   that have durable counterparts.
4. **No model-version branch.** Normalize observed provider shapes, not model
   names. GPT-5.5 and GPT-5.6 may appear in one session, and future models may
   reuse either call shape.
5. **Fail closed.** An ambiguous or mixed command remains an honest `Ran` /
   `Exec` call. Do not label arbitrary execution as exploration.

## Evidence and current gap

### Persisted GPT-5.5 shape

The sampled GPT-5.5 rollouts primarily use separate `function_call` records
named `exec_command`. YA canonicalizes a simple `sed`, `cat`, or `rg` command to
one `Read` or `Grep` tool. The client then folds adjacent canonical tool calls
into an `Explored` group.

This path appears polished largely because the provider commonly emits one
simple shell action per call. Compound commands have always fallen back to
`Bash`; they were merely less common in the inspected GPT-5.5 sample.

### Persisted GPT-5.6 code-mode shape

The observed GPT-5.6 rollout records an outer `custom_tool_call` named `exec`.
Its input is JavaScript orchestration containing nested calls such as
`tools.exec_command({ cmd, workdir, ... })`; the corresponding result is an
array of text blocks. The rollout does not contain the app-server
`commandActions` array for that nested execution.

`codex/codeModeExec.ts` extracts literal nested calls without evaluating
JavaScript. When exactly one nested `exec_command` is found, it enters the
normalizer. The standalone display-action analyzer now derives every safe
read/search/list action from a compound command. The parent remains one `Bash`
call with an ordered `displayActions` vector because it still owns only one
combined execution result.

### Live app-server shape

Raw SDK logging is enabled in the inspected environment and records Codex
app-server notifications before YA conversion. For the exact observed command

```text
sed -n '130,235p' docs/tactical/165-native-feature-parity-baseline.md &&
sed -n '930,1265p' native/crates/mclone-scene/src/session.rs &&
sed -n '1020,1335p' native/apps/mclone-native-client/src/flat_client_driver.rs
```

the completed `commandExecution` item contained three structured `read`
actions with names and absolute paths. This confirms that upstream already
performs the desired one-command-to-many-actions analysis.

A second correlated sample locked identity behavior: app-server used an inner
`exec-f6e9…` id while rollout stored the outer `call_FE1X…` id, and the raw log
contained no `rawResponseItem/completed` bridge for the turn. YA now attaches
ephemeral turn/origin metadata and reconciles only exact, one-to-one normalized
matches to the rollout id. Ambiguous multi-nested calls remain a bounded
active-tail replacement; no YA-owned durable correlation record exists.

At investigation time YA discarded that information for rendering. The landed
extractor and propagation slices now independently derive rollout-recoverable
actions from command text plus workdir/cwd and carry them to the client. Live
`commandActions` remain an oracle rather than a rendering source. The remaining
gap is client segmentation and presentation: it still classifies only the
parent tool name, so a multi-action `Bash` parent renders as raw `Ran` output.

### First-party Codex behavior

Codex's shell parser returns a vector of `ParsedCommand` values. An execution
is exploration-only only when every parsed value is `Read`, `ListFiles`, or
`Search`. The TUI keeps adjacent exploration-only executions in one cell and
renders multiple reads from one execution as friendly action summaries while
retaining the execution as one call.

That is the behavioral oracle, not a runtime dependency. The upstream parser
is intentionally complex; YA should not casually reimplement all shell
semantics.

## Desired normalized model

The standalone Codex semantic-action module is implemented in
`packages/server/src/codex/displayActions.ts`, avoiding further growth of the
already large provider and session-normalization files.

The conceptual output is:

```ts
type CodexDisplayAction =
  | { kind: "read"; path: string; name?: string; startLine?: number; endLine?: number }
  | { kind: "search"; query?: string; path?: string }
  | { kind: "list"; path?: string };

interface CodexCommandAnalysis {
  actions: CodexDisplayAction[];
  explorationOnly: boolean;
}
```

The provider-neutral in-memory boundary is implemented as `ToolDisplayAction`
in `packages/shared/src/tool-display-actions.ts`. Provider-confirmation source
or confidence may be useful in diagnostics, but it must not leak into render
identity or make live and rollout render items differ.

The analysis describes display semantics; it does not split execution or
claim separate results. One compound shell call still owns one combined output.

## Canonical data flow

Both inputs must recover the same rollout-equivalent command description before
semantic analysis:

```text
persisted 5.5 function_call(exec_command)
    └─ parse arguments ───────────────────────────────┐
                                                     │
persisted 5.6 custom_tool_call(exec)                  │
    └─ literal code-mode scan                         │
       └─ nested exec_command { cmd, workdir } ───────┤
                                                     ▼
live commandExecution                         canonical command + cwd
    └─ unwrap executable and shell launcher ──────────┤
                                                     ▼
                                      shared display-action extractor
                                                     │
                                      ┌──────────────┴──────────────┐
                                      ▼                             ▼
                           render normalization           oracle comparison
                                                         with commandActions
```

The live `commandActions` array is initially an oracle:

- use it to build sanitized fixtures;
- compare it with derived actions in tests and optional debug diagnostics;
- expand the shared extractor when real mismatches reveal a safe missing case;
- do not create richer live structure that ordinary rollout replay cannot
  reproduce.

An optimistic live presentation may be considered later only when its
reconciliation is demonstrably bounded at the active tail. It is not required
for this refactor.

## Rendering policy

After shared action analysis:

- **Exactly one compatible action:** preserve current canonical `Read`, `Grep`,
  or list rendering and the existing structured result normalization.
- **Several exploration-only actions:** keep one parent `Bash`/`Exec` execution
  and its original command/result, but expose the derived actions to an
  `Explored` presentation. Do not manufacture a result per action.
- **Several nested code-mode calls, all exploration-only:** one code-mode parent
  may expose all derived exploration actions while retaining its original
  nested-call detail for expansion.
- **Any write, mutation, unknown command, or unsafe parse:** retain ordinary
  `Ran`/`Exec` rendering. A read followed by `git status`, a redirect, or an
  unrecognized pipeline is not an exploration group.

Client grouping must evolve from “a run of exploration `ToolCallItem`s” to “a
run of tool calls whose semantic action lists are exploration-only.” This
allows both:

- several adjacent one-action calls, as today; and
- several action rows within one compound execution.

The parent call remains the expansion and result owner. Search anchors,
timestamps, stable IDs, and scroll-height estimates must derive from that
parent so action summaries do not masquerade as separate executions.

## Implementation plan

### Phase 0 — pin evidence and upstream source

- Refresh `references/codex` for local reading to the official source matching
  YA's declared and installed `0.144.1` target (`rust-v0.144.1`, commit
  `44918ea` as observed 2026-07-10).
- Fetch current upstream `main` separately for comparison; do not implement
  main-only protocol behavior in the `0.144.1` compatibility path.
- Inspect the matching shell parser, app-server `CommandAction` mapping,
  thread-history reconstruction, and TUI exploration-cell grouping.
- Extract small, sanitized raw SDK fixtures covering single and multiple
  `commandActions`; never commit unrelated command output, user content,
  credentials, or absolute home-directory details.
- Keep raw SDK logging temporary. The inspected log was already approximately
  986 MB; disable or rotate it deliberately after fixture capture.

### Phase 1 — standalone semantic-action extraction

- Add the standalone action types and extractor with no React dependency.
- Reuse existing command unwrapping and simple read/search parsing where safe;
  move shared logic rather than maintaining competing recognizers.
- Add bounded parsing for top-level exploration sequences observed in rollout:
  `&&`, safe `;`/newline sequences, and known formatting pipelines.
- Respect quoting and shell nesting. If a connector cannot be classified
  confidently, return no exploration analysis.
- Resolve relative paths against the provided workdir/cwd for display parity,
  while retaining compact project-relative presentation downstream.
- Support upstream action names `read`, `search`, and `listFiles` in the oracle
  adapter.

### Phase 2 — unify 5.5, 5.6, live, and reload normalization

- Route persisted `function_call`, persisted code-mode `custom_tool_call`, and
  live `commandExecution` through the same semantic extractor.
- Preserve the existing exactly-one-action adapter to canonical rich tool
  renderers and structured result normalization.
- Add an optional derived display-action field to the normalized in-memory
  tool-call shape. It is recomputed from each provider source; it is not a new
  durable record.
- Audit code-mode call IDs and result pairing across live/reload before using
  the derived field for group IDs. Align deterministic parent identity rather
  than adding a content-based duplicate workaround.
- Compare live upstream `commandActions` with derived actions in tests. Runtime
  mismatch diagnostics, if retained, must be bounded and off by default.

### Phase 3 — render one-to-many exploration actions

- Extend assistant render segmentation to consume semantic action lists.
- Render one compound exploration call as `Exploring` while pending and
  `Explored` when complete, using the existing vocabulary and styling where
  possible.
- Retain one expandable parent execution with the original command and combined
  output; action rows are summaries, links, and navigation targets only where
  stable identity can be derived from the parent.
- Preserve current grouping of adjacent GPT-5.5-style `Read`/`Grep`/list calls.
- Update predictive height, transcript search anchors, collapse/expand state,
  keyboard behavior, and mobile horizontal scrolling for the new within-call
  action rows.
- Avoid new user-visible concepts or settings; this restores first-party-like
  provider presentation rather than introducing a YA-specific default.

### Phase 4 — parity and regression verification

- Add paired live/persisted fixtures for the exact three-read command and for
  equivalent GPT-5.5 and GPT-5.6 shapes.
- Assert normalized semantic actions, parent tool identity, ordering, group
  boundaries, result ownership, and render-segment signatures.
- Exercise a live-to-rollout reconciliation test so the settled transcript
  does not change row count or group structure.
- Run the focused server/client tests, render-parity harness, typecheck, lint,
  `pnpm console:scan`, and persisted-schema validation against selected
  sanitized rollout/SDK samples.
- Inspect the transcript in YA before and after reload at desktop and narrow
  mobile widths. Treat unexpected React warnings or layout churn as failures.

## Required test matrix

### Extractor unit cases

- one `sed`, `cat`, `nl | sed`, PowerShell windowed read, `rg`, and list action;
- three reads joined by `&&`;
- multiple exploration commands separated by safe semicolon/newline syntax;
- connectors inside quoted strings do not split;
- known read/list/search pipelines with formatting helpers;
- duplicate paths and separate ranges of the same file;
- relative paths with workdir and absolute app-server oracle paths;
- mixed read + `git status`, read + write, redirects, mutation, and unknown
  commands fail closed;
- malformed code-mode JavaScript and nonliteral nested arguments remain raw;
- multiple nested code-mode tool calls preserve source order.

### Normalization parity cases

- GPT-5.5 `function_call(exec_command)` and GPT-5.6 outer `exec` representing
  the same command yield the same semantic actions;
- live `commandExecution.commandActions` agrees with rollout-derived actions;
- started/completed live items and reloaded result pair to the same parent;
- simple one-action calls retain today's canonical input and structured result;
- compound output stays attached once to the parent call.

### Client cases

- one parent with three reads renders one `Explored` group and three summaries;
- adjacent one-action calls still group as before;
- mixed/unknown calls break grouping;
- pending-to-complete changes `Exploring` to `Explored` without changing group
  identity;
- reload preserves segment IDs, order, labels, collapse state compatibility,
  search anchors, and estimated layout shape.

## Acceptance criteria

- The observed three-`sed` call renders as one friendly exploration group both
  live and after rollout reload.
- Existing simple GPT-5.5 `Read`/`Grep` rendering and result detail do not
  regress.
- No model-name conditional selects the renderer.
- No JavaScript is evaluated and no arbitrary `Bash`/`Exec` call is classified
  as exploration.
- No synthetic per-action tool results are created.
- No YA-owned durable transcript or metadata sidecar is introduced.
- Live-only `commandActions` improve evidence and validation without becoming
  a second source of settled transcript truth.
- Focused tests, parity tests, lint, typecheck, and client warning checks pass
  without warnings.

## Open implementation decisions

- Whether a single parent containing several actions participates in the same
  component as a run of several parent calls or uses a small adapter around the
  existing group component.
- How much of upstream shell parsing is worth matching after the initial
  observed corpus. Expand from evidence; do not adopt a full parser by default.
- Whether any optimistic live-only enrichment is useful after deterministic
  rollout-derived analysis lands. Defer unless a concrete UX benefit exceeds
  its reconciliation cost.
