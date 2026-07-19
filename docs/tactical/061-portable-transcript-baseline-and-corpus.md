# Portable Transcript Baseline And Corpus

Status: Phase 0 baseline captured and replayed successfully.

Topic: portable-transcript-compiler
Topic: typescript-module-boundary-refactor

This document owns the reproducible baseline, fixture/specimen matrix, private
artifact procedure, and performance evidence for
[`061-portable-transcript-foundation-plan.md`](061-portable-transcript-foundation-plan.md).
It does not own implementation slice status.

## Starting Point

| Field | Value |
|---|---|
| Revision | `43d47842` (`Document portable transcript compiler direction`) |
| Branch | `main` |
| Upstream | `origin/main` |
| Initial divergence | `0` ahead / `0` behind after `git fetch --prune` |
| Initial worktree | Clean |
| Captured | 2026-07-19, Europe/Berlin |

The immutable behavioral starting point remains `43d47842`. The Phase 0
preparation commit adds assertions and artifact tooling without altering
production transcript behavior; it also fixes the separate font/CSP build
defect discovered by the browser tripwire.

## Gate Classification

The word **green** has two scopes:

- **Functional green:** command exits successfully and all assertions pass.
- **Clean green:** functional green, plus the touched-area run emits no runtime
  warning, React warning, browser page error, or unexplained console warning.

Repository-wide unit and E2E suites contain intentional negative-path logs and
known build chatter. They remain functional gates and are recorded precisely;
they are not evidence that a new warning is acceptable. Focused transcript
tests and the artifact harness must be clean green. `pnpm lint` must always
report zero warnings, and `pnpm console:scan` must not exceed its committed
budget.

## Initial Gate Record At `43d47842`

| Gate | Command | Initial result | Cleanliness note |
|---|---|---|---|
| Lint | `pnpm lint` | Passed; 1,450 files | Clean: no fixes or warnings |
| Typecheck | `pnpm typecheck` | Passed | Clean |
| Unit tests | `pnpm test` | Passed | Existing negative-path application logs, server warnings/errors, and transport console output; not a clean-green transcript-specific run |
| Client E2E | `pnpm --filter client test:e2e --grep-invert "physical Android"` | Passed: 56, skipped: 3 | Vite externalized-crypto/chunk warnings and Node `NO_COLOR`/`FORCE_COLOR` warnings observed during harness setup |
| Server E2E | `pnpm test:e2e:sdk` | Passed: 73, skipped: 1 | Expected negative-path WebSocket stderr; no transcript implementation exercised by most cases |
| Console budget | `pnpm console:scan` | Passed at 110/110 warning sites | `preprocessMessages.ts` has one existing console site; budget must not increase |

The first preparation commit must add focused clean-green transcript commands
instead of pretending the unrelated global chatter is a transcript baseline.

## Surface Census

### Current production flow

```text
SessionDetailState.messages + markdown augments + active approval
  -> preprocessMessages
       -> WeakMap same-array cache
       -> orphan scan
       -> per-message projection/tool pairing
       -> compact coalescing
       -> slash-command body coalescing
       -> shell/write_stdin linkage
       -> detached-poll coalescing
       -> background annotation
       -> empty shell-poll filtering
       -> setup-run collapsing
  -> insertTranscriptDisplayObjects
  -> stabilizeRenderItems(previous, next)
  -> MessageList grouping/selectors
  -> RenderItemComponent / JSX tool and block renderers
```

### Existing named boundaries

- `packages/client/src/lib/preprocessMessages.ts` owns the cache, pure
  computation, message projection, tool/result association, and several
  whole-array semantic passes.
- `packages/client/src/lib/sessionDetail/renderItems.ts` already provides the
  web selector façade combining preprocessing, transcript display objects, and
  previous-item stabilization.
- `packages/client/src/lib/stableRenderItems.ts` separately owns web reference
  reuse, but the selector currently hides that distinction behind one call.
- `packages/client/src/components/MessageList.tsx` owns the prior-items ref,
  selector invocation, grouping/timeline projections, local UI state, DOM,
  scroll, and JSX.
- `packages/client/src/components/RenderItemComponent.tsx` provides stable
  `data-render-type` and `data-render-id` browser assertions for ordinary
  render rows.

### Existing tests that must remain in the gate

- `packages/client/src/lib/__tests__/preprocessMessages.test.ts`
- `packages/client/src/lib/__tests__/stableRenderItems.test.ts`
- `packages/client/src/lib/sessionDetail/__tests__/renderSelectors.test.ts`
- `packages/client/src/components/__tests__/MessageList.*.test.tsx`
- `packages/server/test/sessions/reader.test.ts`
- `packages/server/test/sessions/codex-normalization.test.ts`

The two server test files currently import the client preprocessor directly.
They are test consumers, not a server runtime compiler, but they make current
cross-package expectations visible and must continue passing until deliberately
replaced.

## Durable Semantic Corpus

Every row needs explicit assertions for output order and source ownership, not
only a serialized golden.

| ID | Input boundary | Provider/state | Required semantic coverage | Status |
|---|---|---|---|---|
| SEM-CLAUDE-01 | Normalized `Message[]` | Claude, completed | user/text/thinking, tool use/result pairing, compact marker, setup/local-command behavior | Characterization fixture covers setup, prose, thinking, pairing, compact, and retry error |
| SEM-CODEX-01 | Normalized `Message[]` | Codex, completed | exec/write linkage, detached wait, background state, fallback text | Characterization fixture covers shell/write result ownership and detached-poll folding |
| SEM-LIVE-01 | Normalized `Message[]` + approval | Generic live tail | pending/orphan status and active-approval ownership | Existing focused coverage; add compact characterization |
| SEM-AUGMENT-01 | Messages + augments + display objects | Generic | markdown augment, standalone insertion, stable ordering | Existing selector coverage; add characterization signature |
| SEM-FALLBACK-01 | Unknown/error/system shapes | Mixed | visible loss-resistant fallback without throwing | Partial: retry error pinned; unknown-shape browser fixture deferred |

## Deterministic Browser Specimens

| ID | View | Required state | Durable input | Status |
|---|---|---|---|---|
| WEB-BASIC-01 | 1440x900 and 375x812 | completed user/assistant/tool transcript | Dedicated E2E JSONL specimen | Complete: exact six-row projection, unique ids, clean browser console/page, contained width, top/tail screenshots |
| WEB-LIVE-01 | 1440x900 | pending tool/active approval/streaming tail | Synthetic E2E route or component harness | Pending |
| WEB-WINDOW-01 | 1440x900 and 375x812 | compact boundary plus Load older | Synthetic persisted session | Pending |
| WEB-FALLBACK-01 | 1440x900 | unknown tool/system fallback | Synthetic persisted session | Pending |

Required assertions for every browser specimen:

- `.message-list` leaves `aria-busy` and reaches a stable row count;
- the expected top-level `data-render-id`/`data-render-type` sequence exists;
- no unexpected duplicate top-level render ids exist;
- no `pageerror`, console warning, or console error occurs;
- the document does not horizontally overflow and any wider transcript content
  remains inside its explicit scroll container;
- top and tail transcript screenshots can be generated at fixed viewports.

Pixel equality is supporting evidence, not the semantic oracle. Browser/font
updates can legitimately change pixels while semantic row signatures remain
stable.

## Private Local-Session Corpus

Default ignored locations:

```text
.artifacts/portable-transcript-compiler/local-sessions.json
.artifacts/portable-transcript-compiler/baseline/report.json
.artifacts/portable-transcript-compiler/baseline/<case>/<viewport>-top.png
.artifacts/portable-transcript-compiler/baseline/<case>/<viewport>-tail.png
.artifacts/portable-transcript-compiler/runs/<timestamp>/...
```

The local manifest must contain only inactive or deliberately frozen sessions.
An active session can change while a comparison is running and is therefore
invalid as a strict parity specimen.

Create the ignored manifest from
`packages/client/scripts/transcript-artifact-sessions.example.json`, then run:

```sh
pnpm --filter @yep-anywhere/client transcript:artifacts -- \
  --out-dir .artifacts/portable-transcript-compiler/baseline
pnpm --filter @yep-anywhere/client transcript:artifacts -- \
  --out-dir .artifacts/portable-transcript-compiler/runs/current \
  --compare .artifacts/portable-transcript-compiler/baseline
```

First-pass target set:

| Private ID | Provider | Shape | Selection status |
|---|---|---|---|
| LOCAL-CLAUDE-LONG | Claude | old inactive session with hundreds of normalized records and compact history | Captured: 564 rows at desktop/mobile; exact immediate replay |
| LOCAL-CODEX-LONG | Codex | old inactive rollout with tool-heavy output and waits/background operations | Captured: 500 rows at desktop/mobile; exact immediate replay |
| LOCAL-MIXED-SHORT | Claude or Codex | moderate completed session for readable screenshot review | Optional after first two |

Privacy rules:

- never stage the manifest, report, screenshots, raw messages, URLs, titles, or
  visible text from private sessions;
- reports may store local row ids and cryptographic text/image digests only
  under ignored artifact storage;
- do not upload private artifacts to CI, issues, or remote storage;
- use captured differences to create a minimal sanitized fixture rather than
  making a private transcript a permanent test dependency.

## Performance Baseline

Measure these separately:

| Metric | Input | Baseline | Allowed preparation/cutover movement |
|---|---|---|---|
| Cold semantic compile | Fixed sanitized corpus, new message-array identity | 0.2098 ms median; 0.3319 ms p95 | No material regression; investigate >10% median or >2 ms absolute, whichever is larger |
| Same-array cache hit | Same messages/augment identities | 0.0001 ms median; identity preserved | Must remain effectively constant-time and preserve returned array identity |
| Previous-item stabilization | One changed tail item | 0.2588 ms median; 961/961 eligible prefix references reused | Structurally reusable prefix objects must remain reference-equal |
| Local long-session route | Private fixed inactive URLs | 564 Claude rows and 500 Codex rows; clean exact replay | No unexplained row-count, page-error, long-task, or gross load-time regression |

The 10%/2 ms rule is an investigation threshold, not an optimization target or
permission to alter behavior. Record hardware, browser version, iteration
count, warmup, and input sizes beside results.

The synthetic run used 683 messages, 1,003 render items, 15 cold warmups, 75
cold samples, 2,000 cache samples, and 150 stabilization samples on an Apple M4
Pro. Re-run it with:

```sh
pnpm --filter @yep-anywhere/client transcript:benchmark -- \
  --out .artifacts/portable-transcript-compiler/performance-baseline.json
pnpm --filter @yep-anywhere/client transcript:benchmark -- \
  --compare .artifacts/portable-transcript-compiler/performance-baseline.json
```

## Phase 0 Completion Record

Complete this section immediately before the preparation commit:

- Phase 0 revision: preparation commit based on `43d47842`; this document lands
  with that commit.
- Node / pnpm: Node `v25.8.2`; pnpm `9.15.1`.
- Chromium: `145.0.7632.6` for private artifacts.
- Focused semantic gate: 107/107 assertions passed across six files with no
  runtime warnings.
- Artifact harness unit gate: included above; 4/4 passed cleanly.
- Private local baseline: two inactive sessions, four viewport cases, exact
  semantic and screenshot replay, no duplicate ids/page errors/console noise.
- Deterministic browser gate: 2/2 desktop/mobile cases passed with clean page
  assertions and attached top/tail screenshots.
- Performance measurements: 0.2098 ms cold, 0.0001 ms cache, 0.2588 ms
  stabilization medians; immediate comparison passed.
- Root lint/typecheck/test: passed; lint checked 1,450 files with zero warnings;
  client unit 252 files/2,142 tests and server unit 188 files/2,661 tests passed.
- Client E2E: 58 passed, 3 skipped.
- Server E2E: 73 passed, 1 skipped.
- Console budget: passed at 110/110 warning sites, unchanged.
- Unresolved baseline noise or limitations: full suites retain expected
  negative-path logs; client build retains the pre-existing externalized
  `crypto` and chunk-size warnings plus Playwright's `NO_COLOR`/`FORCE_COLOR`
  warning. Live, pagination, and unknown-shape browser specimens remain later
  corpus additions, not Phase 0 blockers.

## Final Checkpoint Evidence

The surface census and Phase 0 measurements above intentionally describe the
starting revision. At the completed web-only checkpoint, the primary web path
uses the pure internal compiler, named identity cache, web diagnostics adapter,
display-object adapter, and reference-stabilization adapter as separate layers.
The complete dependency boundary and deferred work are recorded in the
[`foundation plan`](061-portable-transcript-foundation-plan.md).

Final production-cutover evidence:

| Evidence | Result |
|---|---|
| Focused compiler/cache/selector boundary | 110/110 assertions passed cleanly |
| Full client unit | 254 files, 2,147 assertions passed |
| Focused server render parity/Codex normalization | 49/49 assertions passed |
| Full server unit | 188 files, 2,661 assertions passed with one Vitest worker |
| Deterministic browser | Exact desktop/mobile specimens passed |
| Full non-device Playwright | 58 passed, 3 environment-dependent skips |
| Private local artifacts | Exact desktop/mobile structural and screenshot parity for 564 Claude and 500 Codex rows |
| Console budget | 110/110 sites, unchanged |
| Fixed-input benchmark | 683 messages, 1,003 items, 0.1961 ms cold median, 0.0001 ms cache median, 0.2552 ms stabilization median, 961/961 reusable prefix references |

The single-worker server result is the authoritative full-server gate for this
campaign because default intra-suite parallelism intermittently starves
untouched fake-Codex polling tests. Those same 2,661 assertions pass when the
harness is serialized. This pre-existing timing sensitivity did not justify a
transcript-refactor assertion or production change.
