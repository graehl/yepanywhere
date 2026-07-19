# Portable Transcript Client Ledger

Status: Phase 2 domain extraction in progress; behavior remains frozen.

Topic: portable-transcript-compiler
Topic: typescript-module-boundary-refactor

This ledger owns client/compiler slices for
[`061-portable-transcript-foundation-plan.md`](061-portable-transcript-foundation-plan.md).
Read that plan, the
[`baseline and corpus`](061-portable-transcript-baseline-and-corpus.md),
[`topics/typescript-module-boundary-refactor.md`](../../topics/typescript-module-boundary-refactor.md),
[`packages/client/RENDERING_PERFORMANCE.md`](../../packages/client/RENDERING_PERFORMANCE.md),
and [`topics/scrollback-view-stability.md`](../../topics/scrollback-view-stability.md)
before implementing a slice.

## Slice Rules

- Behavior is frozen. Assertion changes require a separately justified
  harness correction or human decision.
- Each row lands with its ledger update and a landing note in one commit.
- Each commit is independently revertible and pushed after verification.
- New modules use the existing `packages/client/src/lib/` and
  `lib/sessionDetail/` conventions. Do not create a generic `utils` bucket.
- A platform-free semantic module may import TypeScript data types and pure
  transcript helpers. It may not import React, React DOM, browser globals,
  components, hooks, CSS, timers, transport, session stores, or server-only
  APIs.
- The current `RenderItem` union remains an internal output model. Do not make
  it a versioned/public portability contract in this series.
- Preserve the `preprocessMessages` compatibility façade while server tests or
  other callers import it directly. New web ownership should use the newly
  named compiler/cache boundary rather than perpetuating ambiguous naming.

## Standard Verification

Every slice runs:

```text
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/client exec tsc --noEmit
pnpm --filter @yep-anywhere/client test -- <focused files>
node scripts/biome.cjs lint <changed files>
git diff --check
```

Client-visible or integration slices also run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm console:scan
pnpm --filter client test:e2e --grep-invert "physical Android"
```

The focused transcript tests and artifact assertions must emit no runtime
warnings. Known unrelated global-suite chatter is recorded in the baseline and
must not increase.

## Dependency Census

| Concern | Current owner | Intended checkpoint owner |
|---|---|---|
| Same-array/augment identity cache | `preprocessMessages.ts` WeakMap | Named cache adapter outside pure compiler |
| Orphan tool-id scan | `preprocessMessages.ts` | Pure compiler/message projection module |
| Message/block to initial render items | `preprocessMessages.ts` | Pure message projection module |
| Tool/result association | `preprocessMessages.ts` mutable local maps | Pure compile invocation state |
| Compact and slash-command coalescing | `preprocessMessages.ts` | Narrow transcript projection module |
| Shell/write/wait/background folding | `preprocessMessages.ts` | Narrow shell projection module |
| Session setup run collapsing | `preprocessMessages.ts` | Narrow setup projection module |
| Transcript display object insertion | `transcriptDisplayObjects.ts` | Web adapter after pure semantic compile for this checkpoint |
| Previous-item object reuse | `stableRenderItems.ts` | Explicit web stabilization adapter |
| Turn/timeline/search selectors | `lib/sessionDetail/*` | Existing web selector layer; not compiler work |
| JSX/tool renderers | React components | Existing web renderer; unchanged |

Transcript display objects remain outside the compiler in the first checkpoint
because they are YA UI/session metadata rather than provider transcript
normalization. Reconsidering that ownership would be a semantic architecture
decision, not a move-only extraction.

## Slice Ledger

| ID | Status | Intent | Risk / entry gate | Verification tier |
|---|---|---|---|---|
| PTC-000 | Complete | Establish docs, surface census, semantic/browser/private-artifact tripwires, and performance baseline | No transcript production behavior changes | Full Phase 0 gates |
| PTC-001 | Complete | Introduce `compileTranscriptProjection` as the explicit uncached pure façade while `preprocessMessages` retains current cached behavior | Characterization suite green; returned structures identical | Focused semantic + root Tier 2 |
| PTC-002 | Complete | Move same-array/augment WeakMap ownership into a named cache adapter and test cache identity/variant eviction independently | PTC-001 landed; no caller cutover yet | Focused cache/semantic + root Tier 2 |
| PTC-003 | Complete | Extract compact-boundary, slash-command body, and session-setup folding into narrow platform-free modules | Move-only; no changed assertions | Focused semantic + root Tier 2 |
| PTC-004 | Complete | Extract shell/write/wait linkage, detached-poll folding, background annotation, and empty-poll filtering | Private Codex artifact baseline captured; shell fixtures green | Focused semantic/server Codex + root Tier 2 |
| PTC-005 | Not started | Extract per-message projection and invocation-local tool/result association so the pure compiler no longer lives in the legacy adapter file | PTC-003/004 landed; import graph remains acyclic | Full semantic/server parity + root Tier 2 |
| PTC-006 | Not started | Move compiler orchestration into its final internal module and reduce `preprocessMessages` to the documented compatibility façade | Pure module dependency audit passes | Full semantic + client tests |
| PTC-007 | Not started | Cut the web session-detail selector over to the explicit compiler/cache/stabilization layers | Integration entry gate in master plan satisfied | Full client unit/E2E, artifacts, screenshots, performance |
| PTC-008 | Not started | Remove temporary comparison wiring, reconcile docs, and record final web-only checkpoint | Cutover has clean evidence and revert story | Full final gates |

PTC-007 is intentionally one integration cutover row. It may gain preparation
subtasks, but it must not be subdivided indefinitely merely to avoid making the
ownership change.

## Landing Notes

Append one note per landed slice using this shape:

```text
### PTC-NNN — Short title (landed YYYY-MM-DD, <commit>)

- Moved/changed:
- Explicitly unchanged:
- Dependency result:
- Semantic/browser/private artifact result:
- Performance result:
- Commands:
- Follow-ups or surprises:
```

## Discovery Log

### 2026-07-19 — Initial census

- `buildSessionDetailRenderItems` already centralizes the web call sequence:
  cached preprocessing, transcript display-object insertion, then previous-item
  stabilization.
- `preprocessMessages` already contains a private pure computation beneath its
  WeakMap wrapper. PTC-001 should expose/name that seam before moving logic.
- `MessageList` owns the previous-items ref and updates it in an effect; this
  web lifecycle behavior stays outside the pure compiler.
- Stable browser row attributes already exist on ordinary and explored rows.
  The artifact harness should consume them instead of adding product-only test
  markup.
- The existing client Playwright suite has no transcript visual-regression
  case. Its one mock session contains only a single user message.
- The full repository suites pass at the starting revision but emit unrelated
  negative-path/build chatter. Focused transcript gates must provide the clean
  warning signal for this campaign.

### PTC-000 — Establish the conformance baseline (landed 2026-07-19, this commit)

- Moved/changed: added the coordinating documents, sanitized semantic
  characterization, deterministic desktop/mobile browser specimen, ignored
  local-session capture/compare harness, and fixed-input benchmark.
- Explicitly unchanged: transcript projection, ids, ordering, grouping,
  provider normalization, server protocol, stores, pagination, and React
  renderer behavior.
- Dependency result: the existing ownership and direct test consumers are now
  recorded; no production compiler boundary moved in this slice.
- Semantic/browser/private artifact result: 107 focused unit assertions and
  two browser views passed cleanly; private Claude and Codex baselines replayed
  with exact structural and screenshot hashes.
- Performance result: the 683-message fixture produced 1,003 items; cache
  identity and 961/961 eligible prefix-reference reuse passed. Baseline medians
  were 0.2098 ms cold compile, 0.0001 ms cache hit, and 0.2588 ms changed-tail
  stabilization on an Apple M4 Pro.
- Commands: focused client Vitest, focused and full client Playwright, private
  artifact baseline/compare, performance baseline/compare, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm console:scan`, and server E2E.
- Follow-ups or surprises: the new browser specimen exposed an existing
  production-build CSP mismatch when Vite inlined a small font. The preparation
  layer keeps fonts as same-origin files and tests that build policy. Existing
  Vite crypto/chunk and color-environment chatter remains classified global
  harness noise.

### PTC-001 — Name the pure compiler façade (landed 2026-07-19, this commit)

- Moved/changed: exported the existing uncached computation as
  `compileTranscriptProjection`; the cached compatibility façade delegates to
  it.
- Explicitly unchanged: pipeline implementation, cache keys and eviction,
  returned structures, callers, and web rendering.
- Dependency result: the pure name is visible but remains in the legacy source
  file until later move-only slices remove its internal dependencies.
- Semantic/browser/private artifact result: the characterization test proves
  fresh pure arrays are structurally equal to the cached façade and the façade
  retains same-array identity; the full 64-case preprocessor suite remains
  green.
- Performance result: fixed benchmark comparison remains within tolerance.
- Commands: focused compiler/preprocessor tests, client typecheck, root lint,
  root typecheck, full sequential workspace tests, and fixed performance
  comparison.
- Follow-ups or surprises: the canonical concurrent workspace run exposed
  unrelated fake-process timeout flakes in two different server test files;
  both files passed alone and the complete workspace suite passed sequentially.
  No caller cutover is part of this seam-naming slice.

### PTC-002 — Separate transcript projection cache (landed 2026-07-19, this commit)

- Moved/changed: moved the message-array/augment identity WeakMap and its
  three-variant eviction policy into `transcriptProjection/cache.ts`; moved the
  platform-free augment input types beside it.
- Explicitly unchanged: cache keys, capacity, eviction order, compiler output,
  the `preprocessMessages` public API, and all caller imports.
- Dependency result: the cache receives the compiler as an explicit dependency
  and does not import the legacy façade; the façade re-exports its historical
  input types for compatibility.
- Semantic/browser/private artifact result: focused cache tests pin identity,
  augment variants, and oldest-entry eviction; compiler characterization and
  the 64-case preprocessor suite remain green.
- Performance result: fixed benchmark comparison remains within tolerance and
  preserves same-array identity.
- Commands: focused cache/compiler/preprocessor tests, root lint/typecheck,
  full sequential workspace tests, console budget, and performance comparison.
- Follow-ups or surprises: none; the web selector still uses the compatibility
  façade until PTC-007.

### PTC-003 — Extract semantic folding stages (landed 2026-07-19, this commit)

- Moved/changed: moved compact-boundary coalescing, slash-command skill-body
  folding, and legacy session-setup run collapsing into three named transcript
  projection modules.
- Explicitly unchanged: stage order, compact source preference, slash-command
  linkage fallbacks, setup timing threshold, ids, content, and source-message
  aggregation.
- Dependency result: each extracted module imports only transcript data types
  and the narrow pure helper it needs; none imports React, browser state,
  transport, stores, timers, or the compatibility façade.
- Semantic/browser/private artifact result: all 69 focused cache/compiler/
  preprocessor assertions remain green without changed expectations.
- Performance result: the fixed 683-message comparison passed, preserving
  1,003 items, constant-time cache identity, and all 961 reusable references.
- Commands: focused transcript tests, changed-file Biome, root typecheck/lint,
  workspace tests plus a clean server rerun, console budget, and performance
  comparison.
- Follow-ups or surprises: the untouched fake-Codex lifecycle test hit four
  polling timeouts in the workspace run, then passed alone and in the complete
  server rerun. The extracted stages remain in their original compiler
  positions.

### PTC-004 — Extract shell continuation folding (landed 2026-07-19, this commit)

- Moved/changed: moved shell session/cell linkage, detached-wait coalescing,
  background completion annotation, and context-free empty-poll filtering into
  one cohesive transcript projection module.
- Explicitly unchanged: stage order, session/cell parsing, metadata precedence,
  continuation consumption order, background evidence, filtering rules, ids,
  and returned tool-result structures.
- Dependency result: the shell module imports render-item types and the pure
  shell-output parser only; it has no React, browser, store, transport, timer,
  server, or compatibility-façade dependency.
- Semantic/browser/private artifact result: 69 focused transcript assertions
  and 16 focused server Codex normalization assertions passed. Exact private
  replays passed at desktop and mobile for 564 Claude and 500 Codex rows.
- Performance result: the fixed comparison preserved 1,003 items, cache
  identity, and 961/961 reusable references within its configured tolerance.
- Commands: focused client/server tests, changed-file Biome, root
  typecheck/lint, workspace tests, console budget, private artifact comparison,
  and performance comparison.
- Follow-ups or surprises: none; the compiler still invokes the four stages in
  their original order.
