# Codex Code-Mode Explored Rendering

Topic: codex-code-mode-render-convergence

Status: In progress. Foundation through semantic-action propagation landed on
2026-07-10. The derived actions are present in client `ToolCallItem`s but are
not yet consumed by render segmentation or visible components, so compound
reads still appear as raw `Ran sed ...` rows.

## Contract And Document Ownership

The binding product constraints, upstream evidence, normalization policy, and
live-versus-durable convergence rules live in
[`topics/codex-code-mode-render-convergence.md`](../../topics/codex-code-mode-render-convergence.md).

This document is the canonical execution worklog for that contract:

- landed commits and their verification evidence;
- the exact remaining implementation slices;
- per-slice acceptance criteria and tripwires;
- closeout gates and deferred follow-ups.

Update the slice ledger and landing notes in the same commit as each future
slice. Change the topic document only when the product contract, architectural
direction, or evidence changes.

## User-Visible Goal

An observed GPT-5.6 code-mode call currently renders roughly as:

```text
Ran sed -n '1,180p' native/.../offscreen_flat_client.rs
    sed -n '181,360p' native/.../offscreen_flat_client.rs
    ...
```

It is one outer Codex `exec` call containing one nested `exec_command`; the
shell program contains six read-only `sed` ranges and owns one combined output.
The required first visible result is:

```text
Explored  6 items
  Read  offscreen_flat_client.rs  lines 1-180
  Read  offscreen_flat_client.rs  lines 181-360
  ...
```

The original command, combined output, status, timestamp, and expansion state
remain owned by the single parent execution. The action rows are presentation
summaries, not invented tool calls and not owners of synthetic results.

The initial renderer should preserve one row per derived action. Coalescing
contiguous ranges of the same file into a line such as `lines 1-1080 (6
chunks)` is a potential polish follow-up, not part of the minimum correctness
gate.

## Non-Negotiable Invariants

1. Codex rollout files remain the sole durable transcript source of truth. Do
   not add a YA transcript, sidecar, or durable display-action cache.
2. Durable-corresponding live and reloaded tool calls should settle to the same
   parent structure, action order, group shape, and result ownership.
3. Live app-server `commandActions` are an oracle for fixtures and diagnostics,
   not the source of settled rendering structure.
4. One provider execution remains one parent execution. Never synthesize one
   tool result per read/search/list action.
5. Classify provider shapes, not model names. GPT-5.5 and GPT-5.6 shapes may
   coexist in one transcript.
6. Fail closed. A mixed, mutating, redirected, unknown, or structurally
   ambiguous command remains an ordinary `Ran` / `Exec` row.
7. Never evaluate code-mode JavaScript. Only the existing bounded literal-call
   scanner may extract nested calls.
8. Preserve current GPT-5.5-style adjacent `Read` / `Grep` / list grouping.
9. The raw parent command and combined output must remain inspectable.

## Current Checkpoint

As of `8ec08674`, the data reaches the client but the renderer intentionally
ignores it:

| Layer | Current state |
|---|---|
| Persisted code-mode scan | `codex/codeModeExec.ts` extracts literal nested tool calls without evaluating JavaScript. |
| Semantic analysis | `codex/displayActions.ts` derives ordered read/search/list actions from safe shell sequences. |
| Codex normalization | One action can retain canonical `Read`/`Grep`; several actions keep one `Bash`/`Exec` parent with `displayActions`. |
| Shared in-memory contract | `ToolDisplayAction` is defined in `packages/shared/src/tool-display-actions.ts`. |
| Message boundary | Server normalization attaches `_displayActions` to the in-memory `tool_use` block. |
| Client preprocessing | `ToolCallItem.displayActions` survives reconnect snapshots and result attachment. |
| Client segmentation | Still classifies only by parent `toolName`; `Bash` with several actions is not exploration. |
| Visible renderer | `RenderItemComponent` does not pass `displayActions` to `ToolCallRow`; the ordinary Bash renderer shows `Ran` plus raw command/output previews. |

This boundary explains the present screenshot. It is expected after the landed
propagation slice and is not evidence that the analyzer failed.

## Landed Commit Ledger

| Slice | Status | Commit | What landed |
|---|---|---|---|
| F0 | Landed 2026-07-10 | `c23abd6d` | Added GPT-5.6 code-mode schema support, the literal nested-call scanner, live and persisted normalization, grouped `Exec` fallback rendering, and focused tests. This is the prerequisite foundation; it predates the convergence topic series. |
| F0.1 | Landed 2026-07-10 | `85e07beb` | Removed the code-mode test lint warning so the foundation met the zero-warning commit rule. |
| P0 | Landed 2026-07-10 | `01f088dd` | Recorded rollout authority, graded live/durable convergence, upstream evidence, the no-model-branch rule, and the broad implementation plan. Opened topic `codex-code-mode-render-convergence`. |
| S1 | Landed 2026-07-10 | `457be41e` | Extracted `codex/displayActions.ts`; moved existing read/search parsing into it; added safe ordered compound read/search/list analysis; retained existing one-action rendering; kept compound calls visually raw. |
| S2 | Landed 2026-07-10 | `8ec08674` | Added provider-neutral `ToolDisplayAction`; independently derived actions from live command/cwd and persisted GPT-5.5/GPT-5.6 calls; propagated them through tool blocks, reconnect replacement, results, and client preprocessing; made no visible rendering change. |

### Recorded Verification For Landed Slices

- S1: 144 focused tests passed with one intentional skip; lint, typecheck, and
  Codex protocol checks passed; sampled GPT-5.5 and GPT-5.6 rollouts validated
  505/505 and 5325/5325 records against the persisted Zod schema.
- S2: 198 focused tests passed with one intentional skip; typecheck and lint
  passed without warnings; `pnpm console:scan` stayed at its existing budget
  with `+0`; the Codex protocol subset remained current.
- S2 parity fixtures prove that a deliberately wrong live `commandActions`
  oracle does not change the derived action vector: command text plus cwd is
  the rendering source on the live path, matching rollout-recoverable inputs.

## Remaining Slice Ledger

| Slice | Status | Target outcome | Visible change |
|---|---|---|---|
| S3 | Next / not started | Audit and lock parent identity and live-to-rollout reconciliation for compound code-mode commands. | None required. |
| S4 | Not started | Add a provider-neutral exploration projection that supports one parent with many actions and many parents with one action. | None required; selector/model tests first. |
| S5 | Not started | Render multi-action parents through the existing `Exploring` / `Explored` vocabulary while retaining parent-owned raw details. | Yes: removes the raw `Ran sed ...` default presentation for classified exploration-only commands. |
| S6 | Not started | Stabilize search, navigation, collapse identity, predictive height, mobile layout, and live/reload reconciliation. | Polish and jank prevention. |
| S7 | Not started | Run corpus/schema/manual verification, update docs, and close or explicitly defer follow-ups. | No new behavior beyond fixes found by verification. |

## Slice S3: Parent Identity And Reconciliation Preflight

### Intent

Before group IDs or collapse state depend on a parent, verify real identity
correlation across:

- live app-server `commandExecution` started/completed notifications;
- live raw `custom_tool_call` / `custom_tool_call_output`, when emitted;
- persisted outer `custom_tool_call(exec)` and its output;
- client stream-to-rollout replacement and deduplication.

The current parity fixture deliberately uses matching IDs to test action
propagation. It does not prove that real `commandExecution.id` always equals
the persisted outer `call_id`.

### Work

- Capture a small sanitized fixture from one real multi-read execution with
  live and persisted records. Do not commit unrelated command output, user
  content, credentials, or home-directory paths.
- Record which provider IDs correlate directly and which require an existing
  app-server/raw-response mapping.
- Choose the stable parent identity used by render segments. Prefer a
  deterministic provider identity recoverable from rollout; do not add
  content-based approximate identity as the primary mechanism.
- Assert started -> completed -> rollout replacement produces one logical
  parent, one action vector, and one result owner.
- If direct identity cannot converge, document the bounded active-tail
  replacement behavior before allowing UI state to depend on it.

### Acceptance

- A real-shape fixture covers identity rather than only action equality.
- No new durable record is introduced.
- The decision is recorded here and in an inline comment at the identity seam.
- Existing canonical single-action and render-parity tests remain green.

## Slice S4: Exploration Projection Model

### Intent

Introduce a pure client projection between `ToolCallItem[]` and the explored
component. Keep it in a focused standalone module rather than growing the
already broad renderer/component files.

Conceptually:

```ts
interface ExplorationParent {
  item: ToolCallItem;
  entries: ExplorationEntry[];
}

interface ExplorationEntry {
  id: string;
  parentId: string;
  kind: "read" | "search" | "list";
  path?: string;
  name?: string;
  query?: string;
  startLine?: number;
  endLine?: number;
}
```

Exact type names may change. Required properties are stable parent ownership,
ordered entries, and no synthetic result field on entries.

### Work

- Adapt canonical `Read`/`Grep`/list parents into one entry each, preserving
  current adjacent-run behavior.
- Adapt a parent with `displayActions` into one ordered entry per action.
- Form an explored segment when either:
  - at least two adjacent canonical exploration parents form a run; or
  - one parent contains at least two semantic exploration actions.
- Preserve current single canonical `Read`/`Grep` behavior outside a group.
- Break grouping at unknown/mutating parents and at the existing timestamp-gap
  boundary.
- Derive segment IDs from stable parent identities. Derive entry IDs from the
  parent plus source-order index; entries never become transcript tool IDs.
- Keep parent items on the segment so timestamp, result, raw expansion, search,
  and debug ownership remain available.

### Acceptance

- Selector tests cover one parent/three reads, several parents/one action each,
  mixed exploration and mutation, duplicate paths, repeated ranges, pending
  and completed snapshots, and timestamp breaks.
- Existing explored-group selector snapshots do not change for GPT-5.5-style
  calls except where the new type makes ownership explicit.
- No React component or visible copy changes in this slice unless keeping the
  projection isolated would be more complex than landing its smallest caller.

## Slice S5: Visible Exploring / Explored Rendering

### Intent

Teach the explored component to consume the S4 projection and make the first
visible improvement.

### Work

- Show `Exploring` while any parent in the segment is pending and `Explored`
  once all parents have settled.
- Render entry labels and summaries from semantic fields:
  - read: compact project-relative file name/path and optional line range;
  - search: query plus optional scope;
  - list: optional directory/scope.
- Keep action ordering identical to the source command.
- Keep the parent command and combined output accessible through a
  parent-owned details affordance. Reuse existing Bash/Exec rendering rather
  than creating another output parser.
- Show combined output once. Do not distribute or guess output slices per
  action.
- Keep existing canonical explored runs visually compatible.
- Use existing `Exploring` / `Explored`, `Read`, `Grep`/`Search`, and `List`
  vocabulary. Any changed user-facing sentence or aria text must use the
  existing i18n policy.
- On narrow mobile widths, the compact summaries—not the raw multiline shell
  command—must be the default visible surface.

### Acceptance

- The witnessed six-`sed` command renders as one group with six read summaries
  live and after reload.
- The default row no longer fills the mobile transcript with wrapped raw `sed`
  commands.
- Expanding details still exposes the original command and its combined
  output.
- One parent owns one status and one result before and after expansion.
- Mixed/unsafe commands continue to render as ordinary `Ran` / `Exec`.

## Slice S6: Interaction And Layout Hardening

### Work

- Preserve group/entry IDs across pending -> complete and live -> rollout
  reconciliation.
- Update transcript search text, search previews, and anchors for semantic
  entries without manufacturing transcript message IDs.
- Preserve user-turn navigation and explored-row navigation behavior.
- Update predictive/deferred height estimation so replacing a raw multiline
  command with compact summaries does not create avoidable scroll jumps.
- Verify collapse state, keyboard activation, screen-reader labels, copying,
  file/range links, and parent raw-detail expansion.
- Exercise desktop and narrow/mobile widths, including long paths, duplicate
  filenames, repeated reads of one file, and searches with long queries.
- Keep the client console chatter budget unchanged and treat React runtime
  warnings as failures.

### Acceptance

- Settling or reloading the active tail does not change group row count,
  semantic order, parent ownership, or collapse identity.
- Search and navigation locate both the group and individual semantic entries.
- Manual before/after-reload inspection is stable on desktop and phone-width
  layouts.

## Slice S7: Verification And Closeout

### Required Gates

- Focused extractor, normalization, provider, session, client preprocessing,
  exploration selector, group component, search, and render-parity tests.
- `pnpm typecheck`.
- `pnpm lint` with zero warnings.
- `pnpm console:scan` with no budget increase for client slices.
- `pnpm codex:protocol:check` when provider/protocol-facing source changes.
- `pnpm -s tsx scripts/validate-jsonl.ts <selected-codex-rollout>` for
  sanitized/selected GPT-5.5 and GPT-5.6 samples; broader `--codex` validation
  when practical.
- Manual transcript inspection before and after reload at desktop and narrow
  mobile widths.

### Closeout Work

- Mark every required slice landed, superseded, or deliberately deferred.
- Record commit hashes and verification results in this ledger.
- Update the topic status and remove stale future-tense descriptions.
- Record any parser corpus gaps as evidence-backed follow-ups rather than
  silently broadening the final slice.

## Deferred Or Potential Follow-Ups

These are not required for the first correct `Explored` rendering.

| Follow-up | Trigger / value | Guardrail |
|---|---|---|
| Contiguous read-range coalescing | Repeated adjacent ranges of one file make even semantic rows noisy, as in the six-`sed` example. | Presentation-only; retain exact underlying actions and raw command. Merge only same-path contiguous ranges with no gaps or reordering. |
| Bounded oracle mismatch diagnostics | Real live `commandActions` reveal safe cases the rollout-derived parser misses. | Off by default or debug-only, rate/budget bounded, and never changes settled rendering. |
| Additional shell recognizers | A sanitized rollout corpus repeatedly shows an unclassified read/list/search idiom. | Expand from evidence; continue failing closed; do not import a full shell parser casually. |
| Optimistic live-only enrichment | A concrete tail UX benefit remains after deterministic rendering lands. | Reconciliation must be bounded and measured; rollout remains authoritative. |
| Cross-provider semantic actions | Another provider emits compound exploration under one parent and benefits from the shared type. | Add through its own durable-equivalent adapter; do not infer from Codex model/version. |
| Same-file overlap/dedup summaries | Models repeatedly reread overlapping windows and the group becomes hard to scan. | Never hide that rereads occurred; summarize counts/ranges with an inspectable expansion. |
| Code-mode Bash result-envelope convergence | Persisted code-mode Bash content and live aggregated output produce different raw/envelope text in search/debug or future raw details. | Normalize from provider-equivalent evidence; do not attach separate persisted metadata. Keep separate from action grouping unless it blocks parity. |
| Raw-command copy affordance polish | Compact explored rows make the existing raw command harder to discover. | Reuse existing copy/detail patterns and avoid a YA-specific default-on concept. |

## Stop Conditions

Pause the implementation slice and update this document before proceeding if:

- real live and persisted parent IDs cannot be deterministically correlated;
- the only proposed fix requires a YA-owned durable transcript record;
- a renderer design would duplicate or split the parent result;
- a parser expansion would classify a mixed/mutating command as exploration;
- live/reload reconciliation changes group structure outside the active tail;
- compact rendering removes access to the original command or output;
- client tests emit new React/runtime warnings or the console budget grows.

## Landing Notes

### 2026-07-10 — Foundation Through Propagation

The foundation and topic-series commits established code-mode parsing, the
convergence contract, a standalone fail-closed action analyzer, and
provider-neutral in-memory propagation. They intentionally did not change
visible grouping. The raw `Ran sed ...` screenshot after `8ec08674` therefore
matches the documented checkpoint and identifies S3-S5—not a server parsing
regression—as the remaining path to the requested UX.
