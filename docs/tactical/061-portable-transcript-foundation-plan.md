# Portable Transcript Foundation Plan

Status: Phase 0 complete; production extraction has not started.

Topic: portable-transcript-compiler
Topic: typescript-module-boundary-refactor

This is the coordinating worklog for the web-only foundation checkpoint of
[`topics/portable-transcript-compiler.md`](../../topics/portable-transcript-compiler.md).
It turns that long-range architecture direction into a bounded refactor
campaign that is valuable even if YA never ships a native application.

The current architecture topic remains authoritative for the long-range
server/compiler/native direction. This plan owns current progress, gates, and
the explicit stopping point. The module-boundary rules in
[`topics/typescript-module-boundary-refactor.md`](../../topics/typescript-module-boundary-refactor.md)
remain binding for move-only slices.

## Authorized Outcome

Reach a clean internal semantic boundary between normalized transcript
messages and the existing web renderer while preserving current behavior.

At the checkpoint:

- a pure, deterministic compiler-shaped function accepts the current bounded
  transcript inputs and returns the current `RenderItem[]` model;
- identity caching and previous-item reference stabilization are visibly
  outside that pure function;
- the existing web renderer consumes the new boundary as its only production
  path;
- sanitized semantic fixtures, browser specimens, local private-session
  artifacts, and fixed-input performance evidence protect the cutover;
- the implementation remains internal to the existing TypeScript client
  package unless a real second runtime consumer justifies a package boundary;
- no intentional UI, protocol, provider, ordering, stable-id, streaming, or
  persistence change has shipped.

This checkpoint is useful on its own: provider-format changes become easier to
characterize, React stops owning semantic interpretation, repeated work is
easier to profile, and hosted-client/server skew has a narrower place to be
reasoned about.

## Hard Stop

Completing this plan does **not** authorize:

- a public or versioned projection ABI;
- server/client compiler negotiation or projection transport;
- moving semantic responsibility between the server and client;
- Worker, Rust, Wasm, QuickJS, Kotlin, or Swift runtime work;
- a native Android or iOS renderer;
- a generalized cross-platform layout DSL;
- changing current behavior to make the abstraction cleaner;
- replacing the current session-detail store, pagination, or active-window
  ownership.

Those are separate decisions after a human reviews the completed checkpoint.

## Document Ownership

Use one fact, one owner. Do not duplicate detailed status between documents.

| Document | Owns |
|---|---|
| This plan | Phase rollup, autonomy contract, integration gates, final checkpoint |
| [`061-portable-transcript-baseline-and-corpus.md`](061-portable-transcript-baseline-and-corpus.md) | Starting revision, command results, fixture/specimen matrix, private artifact procedure, performance evidence |
| [`061-portable-transcript-client-ledger.md`](061-portable-transcript-client-ledger.md) | Client/compiler slice rows, dependencies, tripwires, landing notes |
| Provider child ledger, if later created | Provider-specific normalization discoveries and parity work for one provider |

Create a provider child ledger only when provider-specific work has at least
two independent slices or an unresolved semantic decision. Until then, record
provider coverage in the baseline matrix and the owning client slice.

## Autonomous Operating Contract

The campaign may proceed without intermediate human review while all of these
conditions hold:

- every slice is within the authorized outcome above;
- behavior and assertions remain frozen;
- new semantic and browser tripwires remain green and warning-free;
- the relevant standard repository gates pass;
- a ledger row and landing note ship in the same commit as each slice;
- commits remain small enough to revert independently;
- remote contributor changes can be rebased without changing the slice's
  meaning or overwriting concurrent work;
- every pushed commit carries both `Topic: portable-transcript-compiler` and
  `Topic: typescript-module-boundary-refactor` trailers.

Pause for human input when:

- old behavior is ambiguous or contradictory and a choice would be visible;
- preserving behavior would freeze a questionable public/server contract;
- an assertion change is required rather than an implementation-only move;
- stable ids, ordering, grouping, streaming transitions, pagination, or
  action ownership would change;
- the server protocol, provider output contract, or compatibility policy must
  change;
- performance work needs a semantic trade-off rather than an equivalent
  implementation;
- the pure boundary demands a generalized or versioned IR;
- a remote rebase produces a semantic conflict with the current slice;
- a required gate cannot be made green without unrelated or architectural
  work.

An apparent existing bug is recorded as a follow-up. It is not fixed inside a
behavior-preserving slice.

## Verification Layers

No one test style is allowed to carry the conformance claim alone.

### 1. Durable semantic characterization

Checked-in sanitized fixtures assert the current projection structure,
including ids, types, ordering, grouping-relevant boundaries, tool/result
pairing, status, source-message ownership, unknown/fallback behavior, and
selected provider-specific cases.

Golden structures are supporting evidence. Focused behavioral assertions
remain authoritative where identity, action ownership, or fallback semantics
cannot be read safely from a serialized object.

### 2. Deterministic browser specimens

Checked-in synthetic E2E inputs cover states that saved completed sessions
cannot reproduce reliably: streaming/pending rows, active approvals,
progressive reveal, pagination/load-older, compact boundaries, and fallback
records. Browser assertions cover row sequence, render types, duplicate ids,
page errors, console warnings, and document-level horizontal overflow.

### 3. Private local-session artifacts

A repository script captures top/tail transcript screenshots and privacy-safe
structural digests from a local manifest of real session URLs. The manifest,
screenshots, URLs, and reports live under ignored `.artifacts/` storage. They
are broad smoke evidence, never the sole durable gate. An important private
case must be distilled into a sanitized checked-in fixture before it becomes a
permanent invariant.

### 4. Fixed-input performance

Record compiler time separately from DOM/render time. Compare the same
messages and augments on the same revision/toolchain. The extraction must not
materially regress cold compilation, same-array cache hits, or unchanged-row
reference reuse. Performance claims use measured distributions or repeated
runs, not a single wall-clock sample.

## Risk Ratchet

The campaign intentionally prepares for one larger integration cutover. It
must not avoid that cutover forever by subdividing it into increasingly
meaningless moves.

The cutover row may proceed autonomously after all entry conditions are met:

- the old adapter and the pure compiler agree for every durable fixture;
- local private-session baseline/current structural digests agree;
- transcript screenshots have no unexplained differences;
- browser fixtures report no page error, console warning, duplicate render id,
  or document-level overflow;
- compiler/cache/reference-stability performance is within the recorded
  tolerance;
- focused tests, full client tests, lint, typecheck, console budget, and client
  E2E gates pass;
- the old adapter remains available for one independently revertible interval
  or the cutover commit itself is a clean one-commit revert.

If a difference appears, classify it before continuing:

- **Harness nondeterminism:** fix the harness and regenerate both sides.
- **Expected non-semantic noise:** exclude the specific dynamic surface with a
  written reason; do not broadly mask the transcript.
- **Existing behavior defect:** record it and preserve it.
- **Refactor divergence:** shrink or revert the slice.
- **Architectural decision:** stop for human input.

## Phases

| Phase | Status | Exit condition |
|---|---|---|
| 0. Baseline and surface census | Complete | Exact revision/toolchain recorded; semantic, browser, local-artifact, performance, and warning tripwires are runnable and green for their declared scope |
| 1. Pure façade and cache split | Complete | Pure compilation can run without React/DOM/browser state; same-array cache and previous-item stabilization are separate named layers |
| 2. Domain extraction | Complete | Cohesive postprocessing and message-projection stages live in narrow platform-free modules; current adapter stays behavior-identical |
| 3. Web integration cutover | Complete | Session detail web rendering uses the new boundary; parity, artifact, browser, and performance gates pass |
| 4. Closeout | In progress | Ledgers reconciled, temporary comparison path removed or explicitly retained, final evidence recorded, architecture topic points to completed checkpoint |

## Phase 0 Deliverables

- [x] Record repository revision, worktree state, tool versions, and remote
      divergence.
- [x] Run root lint, typecheck, unit tests, client E2E, server E2E, console
      budget, and focused transcript tests.
- [x] Distinguish pass/fail gates from pre-existing global log/build chatter;
      new touched-area tests must themselves be warning-free.
- [x] Inventory compiler inputs, stages, outputs, caches, and web consumers.
- [x] Add compact sanitized semantic characterization fixtures.
- [x] Add a local private-session artifact capture/assert/compare command.
- [x] Create a private local manifest and capture a representative Claude and
      Codex baseline without committing session data.
- [x] Add or identify deterministic browser transcript specimens.
- [x] Record cold compile, cache-hit, and reference-stabilization measurements.
- [x] Commit and push the preparation layer before extraction begins.

## Final Human Checkpoint

After Phase 4, stop and present:

- the final dependency/ownership boundary;
- completed and deferred ledger rows;
- fixture/provider/state coverage matrix;
- local artifact parity summary without private content;
- compiler/cache/reference-stability measurements;
- remaining React, browser, and server coupling;
- the exact next decisions that would be required for a second consumer or
  native-renderer experiment.

No portability experiment begins implicitly from a successful web refactor.
