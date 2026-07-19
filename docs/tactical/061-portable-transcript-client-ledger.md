# Portable Transcript Client Ledger

Status: Web-only compiler checkpoint and compatibility-facade retirement
complete. Further portability work requires a new human decision.

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
- Do not restore the retired `preprocessMessages` compatibility facade. New
  code imports its owning compiler/cache module, while production web consumers
  route through the canonical web adapter.

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

| Concern | Starting owner | Completed checkpoint owner |
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
| PTC-005 | Complete | Extract per-message projection and invocation-local tool/result association so the pure compiler no longer lives in the legacy adapter file | PTC-003/004 landed; import graph remains acyclic | Full semantic/server parity + root Tier 2 |
| PTC-006 | Complete | Move compiler orchestration into its final internal module and reduce `preprocessMessages` to the documented compatibility façade | Pure module dependency audit passes | Full semantic + client tests |
| PTC-007 | Complete | Cut the web session-detail selector over to the explicit compiler/cache/stabilization layers | Integration entry gate in master plan satisfied | Full client unit/E2E, artifacts, screenshots, performance |
| PTC-008 | Complete | Remove temporary comparison wiring, reconcile docs, and record final web-only checkpoint | Cutover has clean evidence and revert story | Full final gates |
| PTC-009 | Complete | Route every production web projection consumer through one canonical web adapter | Existing adapter and facade are behavior-identical delegates | Focused client + root lint/typecheck |
| PTC-010 | Complete | Extract independently consumed agent-result parsing from the large message-projection module | Move-only; helper assertions unchanged | Focused semantic + root lint/typecheck |
| PTC-011 | Complete | Migrate semantic tests, benchmark tooling, and server parity callers to their owning compiler/cache APIs | PTC-009/010 landed; no production facade consumers remain | Full client/server parity + performance |
| PTC-012 | Complete | Delete the compatibility facade and enforce the final ownership map | No remaining imports or historical re-exports | Full final gates |

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

### PTC-005 — Extract per-message projection (landed 2026-07-19, this commit)

- Moved/changed: moved the orphan scan, invocation-local tool maps, message and
  content-block projection, tool snapshot updates, tool-result association,
  and agent-result parsing into `messageProjection.ts`.
- Explicitly unchanged: message traversal order, orphan handling, pending/tool
  map semantics, generated ids, streaming flags, augments, tool status rules,
  source-message provenance, and postprocessing order.
- Dependency result: per-message projection no longer lives in or imports the
  legacy façade. Historical helper exports remain available through façade
  re-exports, and the resulting import graph is acyclic.
- Semantic/browser/private artifact result: 81 focused client assertions and
  49 server render-parity/Codex assertions passed without expectation changes.
- Performance result: the fixed comparison preserved its item-count, cache,
  and reference-reuse invariants within configured tolerance.
- Commands: focused client semantic tests, focused server parity tests,
  changed-file Biome, root typecheck/lint, workspace tests, single-worker full
  server tests, console budget, and performance comparison.
- Follow-ups or surprises: the default server run again starved the untouched
  fake-Codex polling tests under intra-suite concurrency; all 2,661 assertions
  passed with one Vitest worker. Compiler orchestration remains in the façade
  for PTC-006.

### PTC-006 — Finalize the internal compiler boundary (landed 2026-07-19, this commit)

- Moved/changed: moved ordered compiler orchestration into
  `transcriptProjection/compiler.ts`; reduced `preprocessMessages.ts` to cached
  web compatibility behavior, debug injection, and historical re-exports.
- Explicitly unchanged: compiler stage order, cache identity, semantic output,
  debug flag and console payload, public helper imports, and web callers.
- Dependency result: a new source-level tripwire scans every transcript
  projection module for React, browser globals, lifecycle schedulers, web
  application layers, transport, and reverse imports from the legacy façade.
- Semantic/browser/private artifact result: all 82 focused boundary/cache/
  compiler/preprocessor/helper assertions passed without expectation changes.
- Performance result: fixed comparison remains at 1,003 items, constant-time
  same-array cache identity, and 961/961 reusable prefix references.
- Commands: focused semantic, boundary, and server parity tests, changed-file
  Biome, root typecheck/lint, full client tests, console budget, and performance
  comparison.
- Follow-ups or surprises: an old streaming-debug `window` read was found in
  per-message projection and preserved through an optional web-owned diagnostic
  callback. The internal compiler directory is now browser-free.

### PTC-007 — Cut over web session detail (landed 2026-07-19, this commit)

- Moved/changed: changed the primary session-detail render path to call the
  named projection cache and web compiler directly before the existing display
  object insertion and reference stabilization layers; moved web-only debug
  injection into a named adapter.
- Explicitly unchanged: semantic compiler, cache keys and eviction, display
  object placement, stabilization, React rendering, stores, pagination,
  transport, server contracts, and historical façade consumers.
- Dependency result: the primary web path no longer imports
  `preprocessMessages`; a source tripwire pins direct cache/compiler ownership.
- Semantic/browser/private artifact result: 2,147 client assertions and 49
  server parity assertions passed. Playwright passed 58 tests with three
  environment-dependent skips, including deterministic desktop/mobile
  transcript specimens. Exact private desktop/mobile replay passed for 564
  Claude and 500 Codex rows.
- Performance result: 683 messages still produce 1,003 items; cold median was
  0.1960 ms, cache identity remained constant-time, and 961/961 reusable prefix
  references were retained.
- Commands: focused semantic/selector/boundary tests, full client unit and
  non-device Playwright suites, focused server parity, exact private artifact
  comparison, root typecheck/lint, console budget, and performance comparison.
- Follow-ups or surprises: none; legacy consumers outside the primary
  session-detail renderer deliberately retain the compatibility façade.

### PTC-008 — Close the web-only checkpoint (landed 2026-07-19, this commit)

- Moved/changed: reconciled the phase and slice records, recorded the final
  dependency boundary and evidence, and marked the human decision point in the
  tactical and long-range architecture documents.
- Explicitly unchanged: production code, transcript behavior, assertions,
  provider/server contracts, runtime placement, and renderer ownership.
- Dependency result: the primary web path uses the internal compiler directly;
  the legacy facade remains intentionally available to secondary and test
  consumers. No shadow, dual-compile, or comparison path remains in production.
- Semantic/browser/private artifact result: the final production cutover had
  already passed 2,147 client assertions, 49 server parity assertions, 58
  non-device Playwright cases, exact deterministic desktop/mobile specimens,
  and exact private desktop/mobile replay for 564 Claude and 500 Codex rows.
- Performance result: final cutover comparison preserved 1,003 items,
  effectively constant-time cache identity, and 961/961 reusable prefix
  references. The closeout rerun measured 0.1961 ms cold, 0.0001 ms cache, and
  0.2552 ms stabilization medians, all within baseline tolerance.
- Commands: root lint/typecheck, focused semantic and server parity tests, full
  client tests, serialized full server tests, shared/relay tests, console
  budget, fixed performance comparison, and `git diff --check`.
- Follow-ups or surprises: the public/versioned projection, bounded canonical
  envelope, prefix facts, server/client negotiation, alternate runtime, second
  consumer, and native renderer remain behind a new human decision.

### PTC-009 — Canonicalize the web projection entry

Landed 2026-07-19, this commit.

- Moved/changed: routed session detail, session activity derivation, and nested
  Task transcript rendering through `getCachedWebTranscriptProjection`.
- Explicitly unchanged: compiler/cache implementation, cache identities,
  augments, activity semantics, nested rendering, and primary transcript output.
- Dependency result: production web code has one cached projection assembly
  path; a source tripwire pins all three consumers to the web adapter.
- Semantic/browser/private artifact result: focused compiler, selector,
  activity, and Task renderer tests passed without expectation changes.
- Performance result: no compiler or cache implementation changed; fixed-input
  comparison retained all item, identity, and reference-reuse invariants.
- Commands: focused client tests, client typecheck, changed-file Biome, root
  lint/typecheck, console budget, fixed performance comparison, and
  `git diff --check`.
- Follow-ups or surprises: none; tests and tooling still use the facade until
  PTC-011 so this slice remains independently revertible.

### PTC-010 — Extract agent-result projection

Landed 2026-07-19, this commit.

- Moved/changed: moved Agent tool text-result parsing and display-content
  cleanup verbatim from `messageProjection.ts` to `agentResults.ts`.
- Explicitly unchanged: parsing expressions, result keys, content filtering,
  tool-result attachment, compiler order, and compatibility exports.
- Dependency result: the large message projector now consumes a narrow Agent
  domain module; its focused test imports the owning module directly.
- Semantic/browser/private artifact result: Agent parsing and full transcript
  preprocessing assertions passed without expectation changes.
- Performance result: no traversal or folding order changed; fixed-input
  comparison retained all item, identity, and reference-reuse invariants.
- Commands: focused client tests, client typecheck, changed-file Biome, root
  lint/typecheck, fixed performance comparison, and `git diff --check`.
- Follow-ups or surprises: none; the facade temporarily re-exports the moved
  helper until its remaining consumers are migrated in PTC-011.

### PTC-011 — Migrate projection tests and parity tooling

Landed 2026-07-19, this commit.

- Moved/changed: pointed semantic tests and server render-parity callers at the
  pure compiler, renamed the legacy semantic suite, and made the benchmark
  measure compiler and cache APIs explicitly.
- Explicitly unchanged: semantic expectations, server normalization inputs,
  parity normalization, benchmark corpus/tolerances, and production code.
- Dependency result: no production, test, script, or server file imports the
  compatibility facade; only the facade definition and its boundary pattern
  remain before deletion.
- Semantic/browser/private artifact result: the full client suite and focused
  server render/normalization parity passed without expectation changes.
- Performance result: the fixed benchmark retained 1,003 items, cache identity,
  and 961/961 reusable prefix references within baseline tolerance.
- Commands: focused and full client tests, focused server parity tests, client
  and root typecheck/lint, console budget, fixed performance comparison, and
  `git diff --check`.
- Follow-ups or surprises: none; PTC-012 can now delete the facade without a
  compatibility shim or caller cutover.

### PTC-012 — Retire the compatibility facade

Landed 2026-07-19, this commit.

- Moved/changed: deleted `preprocessMessages.ts`, documented the final module
  ownership map beside the compiler, added source tripwires against facade
  restoration or direct production compiler/cache assembly, and excluded the
  transient reload overlay from transcript artifact pixels.
- Explicitly unchanged: projection semantics, stage order, cache behavior,
  diagnostics, render items, server runtime dependencies, and web output.
- Dependency result: semantic code has one owning module per domain, cached web
  production assembly has one adapter, and tests/parity tooling use explicit
  browser-free APIs.
- Semantic/browser/private artifact result: 2,149 client and 2,661 server
  assertions passed, with six declared server skips. Playwright passed 58 cases
  with three environment skips. Exact private desktop/mobile replay passed for
  564 Claude and 500 Codex rows.
- Performance result: 683 messages retained 1,003 items and 961/961 reusable
  prefix references. Cold, cache, and stabilization medians were 0.1979 ms,
  0.0001 ms, and 0.2495 ms, within the established tolerances.
- Commands: focused and full workspace tests, root lint/typecheck, console
  budget, non-device Playwright, exact private artifact comparison, fixed
  performance comparison, and `git diff --check`.
- Follow-ups or surprises: a concurrent Playwright build triggered YA's reload
  overlay during the first mobile artifact capture. The harness now excludes
  that transient non-transcript overlay, and the isolated exact replay passed.
  Any public package, versioned projection, alternate runtime, or native
  renderer remains behind a new human decision.
