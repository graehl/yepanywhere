# TypeScript Module Boundary Refactor

Topic: typescript-module-boundary-refactor

Status: Phase 1 in progress; slice 1.1 landed.

## Contract

The binding rules for this campaign — slice discipline, naming, coordination,
tripwire matrix, verification tiers, stop conditions, and non-goals — live in
[`topics/typescript-module-boundary-refactor.md`](../../topics/typescript-module-boundary-refactor.md).
Read it before implementing any slice. This document is the worklog: baseline,
inventory, slice ledger, and landing notes.

## Goal

Reduce the largest TypeScript and TSX files by extracting clear module
boundaries, while preserving behavior, performance, public APIs, and the
documented architecture invariants.

This is not a blanket line-count campaign. Large files are prioritized when
they mix responsibilities that already have natural seams: route registration
versus route handling, page orchestration versus feature hooks, provider
protocol IO versus normalization, and DOM-local transcript behavior versus pure
selectors.

## Baseline Gate

Recorded before the first refactor slice so later regressions are attributable
to a slice instead of preexisting repo state.

| Check | Command | Status | Notes |
|---|---|---|---|
| Lint | `pnpm lint` | Passed 2026-07-06 | 1s. Checked 1326 files, no fixes and no warnings. |
| Typecheck | `pnpm typecheck` | Passed 2026-07-06 | 8s. Includes `@yep-anywhere/shared` build. |
| Unit tests | `pnpm test` | Passed with baseline chatter 2026-07-06 | 44s. Existing stderr/WARN chatter observed; do not use this run as warning-free proof until the noted chatter is fixed or explicitly accepted per slice. |
| Client E2E | `pnpm test:e2e` | Passed with baseline warnings 2026-07-06 | 41s. 55 passed, 6 skipped. Existing Vite chunk-size/browser-compatibility warnings and Node `NO_COLOR`/`FORCE_COLOR` warnings observed. |
| Server E2E | `pnpm test:e2e:sdk` | Passed with baseline chatter 2026-07-06 | 18s. 73 passed, 1 skipped. Existing negative-path WebSocket stderr observed. |
| Client console budget | `pnpm console:scan` | Passed at budget 2026-07-06 | 0s. 110/110 warning budget, +0 warnings; 158 info sites hidden by default. |
| Request census | `pnpm --filter client request:census -- --url <session-url>` | Skipped 2026-07-06 | No real session URL was supplied; run before session page/API refactors when available. |

Baseline notes:

- Recorded 2026-07-06 12:08 CEST at `3dd6f88b6d7eaff3b42153242b4f7891ef7c557b`
  and committed as `27dc30af`. The worktree was dirty at record time with
  unrelated project-queue changes (since landed as `eebd23f1`); no source
  movement had started for this refactor.
- Passing checks are attributable as pass/fail gates. The unit/E2E runs are not
  warning-free gates because they emitted existing test/logging chatter:
  settings-fetch stderr in client tests, server `CODEX_* slow scan` WARN logs
  against the local Codex session directory, expected negative-path
  WebSocket/auth stderr, Vite build warnings, and Node `NO_COLOR`/`FORCE_COLOR`
  warnings.
- The console chatter scan is at its current budget, not clean: 110 warning
  call sites, 0 over budget. Client slices must not increase that budget.
- Chatter fixes are their own slices (see the contract); do not bundle them
  into move slices.

## Large-File Inventory: 2026-07-06

Refresh cadence: at each phase completion, or when choosing the next phase's
slices — not after every slice. Generated/build/reference trees were excluded
with `rg --files`; specifically `node_modules`, `dist`, nested `dist`,
`references`, coverage and Playwright reports, and generated Codex
protocol/schema directories.

Production TS/TSX top offenders:

| LoC | File |
|---:|---|
| 6278 | `packages/server/src/routes/sessions.ts` |
| 6080 | `packages/client/src/pages/SessionPage.tsx` |
| 5724 | `packages/server/src/sdk/providers/codex.ts` |
| 4322 | `packages/server/src/supervisor/Supervisor.ts` |
| 4026 | `packages/server/src/supervisor/Process.ts` |
| 3615 | `packages/client/src/components/MessageList.tsx` |
| 3346 | `packages/client/src/components/NewSessionForm.tsx` |
| 3059 | `packages/client/src/components/MessageInputToolbar.tsx` |
| 2339 | `packages/client/src/components/MessageInput.tsx` |
| 2270 | `packages/client/src/lib/clientSummaryState.ts` |
| 2195 | `packages/server/src/indexes/SessionIndexService.ts` |
| 2180 | `packages/server/src/sessions/codex-reader.ts` |
| 2103 | `packages/client/src/hooks/useSession.ts` |
| 1936 | `packages/client/src/api/client.ts` |
| 1912 | `packages/server/src/sdk/providers/claude.ts` |
| 1884 | `packages/client/src/lib/connection/SecureConnection.ts` |
| 1811 | `packages/client/src/lib/speechProviders/YaServerProvider.ts` |
| 1810 | `packages/client/src/pages/GitStatusPage.tsx` |
| 1711 | `packages/server/src/sdk/providers/opencode.ts` |
| 1678 | `packages/server/src/app.ts` |
| 1660 | `packages/server/src/routes/settings.ts` |
| 1609 | `packages/client/src/components/renderers/tools/EditRenderer.tsx` |
| 1489 | `packages/client/scripts/long-session-perf-probe.ts` |
| 1482 | `packages/server/src/codex/normalization.ts` |
| 1425 | `packages/server/src/sessions/opencode-reader.ts` |

Test TS/TSX top offenders:

| LoC | File |
|---:|---|
| 4185 | `packages/server/test/process.test.ts` |
| 4024 | `packages/server/test/routes/sessions-metadata.test.ts` |
| 3779 | `packages/server/test/sdk/providers/codex.test.ts` |
| 3473 | `packages/client/src/components/__tests__/MessageInput.test.tsx` |
| 3458 | `packages/client/src/hooks/__tests__/useSessionMessages.cache.test.tsx` |
| 3190 | `packages/client/src/lib/__tests__/speechProviders.test.ts` |
| 3063 | `packages/server/test/supervisor.test.ts` |
| 3016 | `packages/client/src/components/__tests__/MessageList.test.tsx` |
| 2191 | `packages/client/src/components/__tests__/NewSessionForm.test.tsx` |
| 1953 | `packages/server/test/e2e/ws-secure.e2e.test.ts` |
| 1922 | `packages/client/src/lib/sessionDetail/__tests__/renderSelectors.test.ts` |
| 1870 | `packages/client/src/lib/__tests__/preprocessMessages.test.ts` |
| 1833 | `packages/client/src/lib/__tests__/clientSummaryState.test.ts` |
| 1684 | `packages/server/test/sessions/reader.test.ts` |
| 1557 | `packages/server/test/e2e/ws-transport.e2e.test.ts` |
| 1477 | `packages/server/test/indexes/SessionIndexService.test.ts` |
| 1445 | `packages/server/test/sessions/codex-normalization.test.ts` |
| 1414 | `packages/server/test/augments/edit-augments.test.ts` |
| 1364 | `packages/client/src/hooks/__tests__/useSession.test.ts` |
| 1279 | `packages/shared/test/binary-framing.test.ts` |
| 1267 | `packages/server/test/sessions/dag.test.ts` |
| 1249 | `packages/client/src/components/__tests__/Sidebar.test.tsx` |
| 1172 | `packages/server/test/augments/block-detector.test.ts` |
| 1135 | `packages/server/test/routes/settings.test.ts` |
| 1130 | `packages/server/test/sessions/codex-reader-oss.test.ts` |

## Phase 0: Preparation And Tracking

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 0.1 | Recorded 2026-07-06 | Baseline gate | Run and record the baseline command set above. | Pass/fail baseline recorded; warning-free status is not clean because existing test/E2E chatter was observed. |
| 0.2 | Recorded 2026-07-06 | Large-file inventory | Refresh the production/test LoC inventory. | Recorded above; refresh at phase boundaries. |
| 0.3 | Done 2026-07-06 | Contract/worklog split | Extract the binding rules into `topics/typescript-module-boundary-refactor.md` and reconcile this plan with the active doc 053 ledger. | This doc is the handoff surface for future sessions. |
| 0.4 | In progress | Slice ledger upkeep | After each slice, update the slice row and append a landing note. | Ledger update lands in the same commit as the slice. |

## Phase 1: Server Route Mechanical Splits

High value and comparatively low risk: route files have obvious endpoint
groups, and `create*Routes()` aggregators can remain stable.

**Ownership:** all `sessions.ts` extraction runs through the active ledger in
[`053-sessions-route-refactor-ledger.md`](053-sessions-route-refactor-ledger.md)
as SRR items, following its proposed/accepted/done process. That ledger has
already landed SRR-001 (request parsing helpers), SRR-002
(`providerResolutionDeps` dedup), SRR-004 (thinking launch options), SRR-005
(recovered queue helpers), SRR-006 (Claude resume guard), SRR-007 (worker queue
routes), SRR-008 (compact thresholds), SRR-010 (queue summary shaping), and
SRR-011 (provider resolution helpers) — the flat domain-named
`routes/session-*.ts` pattern those items established is the pattern here. Do
not create a `routes/sessions/` directory or a shared helpers bucket.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 1.1 | Done 2026-07-06 as SRR-010/SRR-011 | `sessions.ts` queue summary shaping + provider guards | Land SRR-010 (patient/deferred queue summary shaping into `session-queue-summaries.ts`) and SRR-011 (provider name guards and resolution deps into `session-provider-resolution.ts`). | Move-only; shaping and guards, not queue behavior. Restart/fork helpers are excluded — they are larger and behavior-heavy. Tier 1. |
| 1.2 | Not started | Session detail routes | Extract metadata, agent content, and `GET /projects/:projectId/sessions/:sessionId` handlers behind a local registrar; propose as an SRR item first. | Preserve pagination, compact-tail, augment, and unread semantics. Tier 3: session-detail tests plus server E2E. |
| 1.3 | Not started | Start/create/resume/reactivate routes | Extract new-session, two-phase create, resume, and reactivation handlers; propose as an SRR item first. | Preserve provider selection, YA-visible session ids, executor persistence, queue-full behavior, and remote sync behavior. Overlaps SRR-004 (launch option normalization) — sequence with it. |
| 1.4 | Not started | Restart/fork/recap/retitle routes | Extract restart, fork, recap, fork-summary, and retitle flows; propose as an SRR item first. | Higher risk than 1.2/1.3; preserve handoff/fork semantics and recap background behavior. Tier 3. |
| 1.5 | Not started | Queue/deferred routes | Extract message queue, deferred patient queue, steer/cancel, pending input, and mode routes. Builds on SRR-005 (recovered queue helpers, done in doc 053). | Tripwire matrix: architecture-mandates row. Queue timers and idle ownership are load-bearing. Tier 3 with `test:e2e:sdk`. |
| 1.6 | Not started | Metadata/notifications routes | Extract metadata updates, mark-seen, last-seen, archive/star, and debug metadata routes. Builds on SRR-009 (metadata patch parsing, proposed in doc 053). | Lower risk; preserve event-bus update emissions. |
| 1.7 | Not started | `routes/settings.ts` parser split | Move settings parsers/discovery helpers out of the route factory. | Good follow-up once the `sessions.ts` pattern is proven. |
| 1.8 | Not started | `app.ts` route composition cleanup | Extract app dependency construction or route mounting groups only after route modules are stable. | Do not alter middleware order, auth policy, or hosted-client endpoint selection. Coordinate with doc 054: workstreams slices (WS-004, WS-008, and later) actively mount routes in `app.ts`. |

## Phase 2: Client Page And Component Boundaries

Prioritize React files where one component function owns many unrelated hooks
and effects. Extract feature hooks/components while keeping visible behavior
and props stable.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 2.1 | Not started | `SessionPage.tsx` pure helpers | Move attachment conversion, text extraction, public-share prompt parsing, Codex config ack parsing, and title helpers into adjacent domain-named modules. | Move-only. Add or keep focused helper tests where extraction exposes pure behavior. Tier 1. |
| 2.2 | Not started | `SessionPage.tsx` `/btw` aside orchestration | Extract aside prompt parsing, polling, split-pane focus state, and minimal aside composer helpers into a feature module/hook. | Read `topics/provider-agnostic-btw-asides.md`; preserve composer routing and default provider-like behavior. Tier 3 with client E2E. |
| 2.3 | Not started | `SessionPage.tsx` composer submission/attachments | Extract staged/uploaded attachment preparation and draft transfer helpers. | Preserve object URL cleanup and staged attachment batch invariants. Run attachment/upload tests; Tier 3 with client E2E. |
| 2.4 | Not started | `MessageList.tsx` selection and quote behavior | Extract selected-text shielding, quote button placement, copy handling, and selection helpers. | DOM-local behavior; run `MessageList` tests; Tier 3 with client E2E. |
| 2.5 | Not started | `MessageList.tsx` scroll/follow snapshots | Extract scroll-follow, catch-up, and retained scroll snapshot hooks. | High risk. Tripwire matrix: rendering row (`RENDERING_PERFORMANCE.md`, scrollback stability). Tier 3 plus manual browser pass. |
| 2.6 | Not started | `MessageList.tsx` isearch UI state | Extract reverse search state/projections that are still DOM-local. | Keep pure selector work in `lib/sessionDetail/`; avoid duplicating selector ownership. |
| 2.7 | Not started | `MessageInputToolbar.tsx` view/control split | Separate toolbar measurement/overflow logic from presentational controls. | Preserve compact mobile overflow and liveness display. |
| 2.8 | Not started | `MessageInput.tsx` textarea mechanics | Extract undoable text edits, resize, slash matching, and speech target helpers. | Preserve browser undo stack and focus behavior. |
| 2.9 | Not started | `NewSessionForm.tsx` project/options helpers | Move project sorting, provider option resolution, recap/prompt-suggestion defaults, and attachment helpers. | Preserve i18n and staged attachment behavior; run `pnpm i18n:scan` if copy moves. Coordinate with doc 054: WS-006 added a workstream selector to this form. |
| 2.10 | Not started | `GitStatusPage.tsx` diff preview module | Extract diff fetch/render preview components after large-diff admission guards are in place. | Read `docs/project/2026-07-06-git-status-large-diff-hang.md`; do not refactor around an unbounded preview path. |

## Phase 3: Existing Architecture-Aligned Migrations

These areas already have accepted topic/tactical documents. This worklog does
not fork their plans; it only records where LOC reduction can happen as part
of their planned slices.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 3.1 | Not started | `useSessionMessages.ts` adapter cutdown | Continue the existing session-detail data-layer migration by shaving reveal/progress/pagination bookkeeping into tested helpers. | Owned by `docs/tactical/043-session-detail-data-layer-plan.md`; do not start a parallel transcript rewrite. |
| 3.2 | Not started | `clientSummaryState.ts` source-store helpers | Split pure collection/reducer/query helpers only when touching summary-state behavior. | Follow source-runtime topology docs. |
| 3.3 | Not started | `SecureConnection.ts` internals | Extract only when aligned with source-transport boundary work or clear pure helpers. | Owned by `topics/source-transport.md` / doc 057; preserve parity rows and full transport tests. |
| 3.4 | Not started | `api/client.ts` domain clients | Consider domain-specific API modules once source transport shims are stable. | Keep the exported `api` facade stable until callers migrate deliberately (the contract's one re-export exception). |

## Phase 4: Provider Adapter Splits

Provider files are large, but they touch upstream-facing behavior. Prefer
extracting pure protocol/model/normalization modules with strong fixtures.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 4.1 | Not started | `sdk/providers/codex.ts` app-server client | Move `CodexAppServerClient`, JSON-RPC queueing, process termination, and raw request helpers into focused modules. | Tripwire matrix: Codex row. Run Codex provider tests and server E2E. |
| 4.2 | Not started | Codex model catalog helpers | Move fallback model data, semver parsing, model sorting, and model metadata normalization. | Low risk if tests pin catalog output. Tier 1. |
| 4.3 | Not started | Codex notification guards | Move `as*Notification` guards and raw notification classifiers into a protocol module. | Fixture-heavy; compare stream and persisted render parity where relevant. |
| 4.4 | Not started | Codex live event conversion | Move live turn state, streaming message construction, and item-to-SDK conversion. | Higher risk; preserve live-delta suppression and replay behavior. Tier 3. |
| 4.5 | Not started | Codex recap/summary helpers | Move recap prompts, fork-backed summary, retitle prompt, and summary capture helpers. | Preserve helper model resolution and provider-visible prompt behavior. |
| 4.6 | Not started | Claude/OpenCode provider helper splits | Apply the proven Codex split pattern only where clear seams exist. | Avoid abstracting providers together unless duplication becomes real and tested. |

## Phase 5: Load-Bearing Supervisor And Process Files

Intentionally late. Size alone is not enough reason to split these files
because they own process lifecycle, replay, fan-out, idle cleanup, queues, and
heartbeat behavior.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 5.1 | Deferred | `Process.ts` pure helper extraction | Move static/pure helpers for message text, API retry status, permission pattern matching, and formatting when touched. | Move-only; no stream/replay/timer changes. Tripwire matrix: architecture-mandates row. |
| 5.2 | Deferred | `Process.ts` recap helper boundary | Consider extracting recap generation helpers if recap work resumes. | Preserve native recap waiters and pending recap flow. |
| 5.3 | Deferred | `Process.ts` queue persistence helpers | Consider extracting patient/deferred queue persistence helpers only with queue-specific tests. | Idle sessions must not retain repeating work. |
| 5.4 | Deferred | `Supervisor.ts` recap/compaction helpers | Extract pure compaction threshold, heartbeat candidate, and recap helper functions opportunistically. | Do not alter worker pool, preemption, liveness, or heartbeat scheduling. |

## Phase 6: Tests And Fixtures Organization

Large tests are acceptable when they read like scenario ledgers, but splitting
can improve review when scenarios are independent.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 6.1 | Not started | `MessageList.test.tsx` scenario files | Split by behavior area: progressive rendering, thinking, queue rows, selection/copy, scroll, search. | Keep shared fixture helpers stable. |
| 6.2 | Not started | `process.test.ts` scenario files | Split by queue, approvals, replay/streaming, liveness, recap, termination. | Preserve fake timers and cleanup discipline. |
| 6.3 | Not started | `codex.test.ts` fixtures | Move repeated raw notification fixtures and expected SDK outputs into fixture modules. | Avoid hiding expected behavior behind opaque helpers. |
| 6.4 | Not started | Route metadata tests | Split route metadata tests once route modules split. | Keep request/response assertions explicit. |

## Landing Template

Each landed slice updates its row and appends a note here (newest first):

```text
### Slice N.M — <short title> (Landed YYYY-MM-DD, <commit>)
Moved:
- <symbol> -> <new module>
Signature conversions (closure -> parameter), if any:
- ...
Behavior changes:
- None. (Anything else means the slice was mis-cut; see stop conditions.)
Verification:
- Tier <1|2|3>: <commands run>
- Skipped: <required check, reason, substitute> (omit if none)
Follow-ups recorded:
- ...
```

## Landing Notes

### SRR-005 — Recovered Queue Helpers (Landed 2026-07-06, this commit)

Moved:
- `ensureProcessForRecoveredItem`, `resumeRecoveredGroup`,
  `reportableProcessState`, and `resolveRecoveredGroupForDelivery` ->
  `session-recovered-queue.ts`.

Signature conversions:
- Recovered queue helpers accept `RecoveredQueueDeps` instead of closing over
  the sessions route's `deps`, `getGlobalInstructions`, and
  `persistLaunchMetadata`.

Behavior changes:
- None. Recovered-queue route handlers, route paths, response shapes, and
  `waitForPatientQueuePersistenceIdle()` waits stayed in `sessions.ts`.

Verification:
- Tier 1: `pnpm --filter @yep-anywhere/shared build`;
  `pnpm --filter @yep-anywhere/server exec tsc --noEmit`;
  `pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts`;
  `node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-recovered-queue.ts`;
  `git diff --check`.
- Tier 2: `pnpm lint`; `pnpm typecheck`; `pnpm test`.
- Tier 3 / tripwire: `topics/architecture-mandates.md` was read before
  editing; `pnpm test:e2e:sdk` was run for queue/liveness coverage.
- Residual risk: the focused route test run still emits the preexisting
  sessions-metadata WARN/INFO log chatter for negative-path Claude
  resume/compact cases, and root `pnpm test` still emits the baseline suite
  chatter recorded above.

Follow-ups recorded:
- Phase 1.5 remains the larger queue/deferred route extraction.

### SRR-004 — Session Thinking Options (Landed 2026-07-06, this commit)

Moved:
- repeated launch/resume/restart/message `body.thinking` conversion ->
  `session-thinking-options.ts` as `buildThinkingOptions`.

Signature conversions:
- The new helper accepts a narrow body shape with `thinking` and
  `showThinking`, then delegates to shared `thinkingOptionToConfig`.

Behavior changes:
- None. Model/default, service-tier, provider, executor, recap, and
  prompt-suggestion fallback rules stayed in `sessions.ts`.

Verification:
- Tier 1: `pnpm --filter @yep-anywhere/shared build`;
  `pnpm --filter @yep-anywhere/server exec tsc --noEmit`;
  `pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts`;
  `node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-thinking-options.ts`;
  `git diff --check`.
- Tier 2: `pnpm lint`; `pnpm typecheck`; `pnpm test`.
- Residual risk: the focused route test run still emits the preexisting
  sessions-metadata WARN/INFO log chatter for negative-path Claude
  resume/compact cases, and root `pnpm test` still emits the baseline suite
  chatter recorded above.

Follow-ups recorded:
- Phase 1.3 still owns route extraction for start/create/resume/reactivate
  paths; remaining model/default normalization can be revisited there if it
  stays move-only.

### Slice 1.1 — Sessions Route Helper Boundaries (Landed 2026-07-06, this commit)

Moved:
- `persistedPatientQueueSummary`,
  `recoveredPatientQueueSummaries`, `recoveredPatientQueueItems`,
  `sessionQueueSummaries`, `recoveredPatientUserMessage`, and
  `livePatientEntriesNewerThan` -> `session-queue-summaries.ts`.
- `isClaudeSdkProviderName`, `isCodexProviderName`, and
  `providerResolutionDeps` -> `session-provider-resolution.ts`.

Signature conversions:
- Queue summary helpers accept `SessionQueueSummaryDeps` instead of the route
  file's `SessionsDeps`.
- `providerResolutionDeps` accepts `SessionProviderResolutionDeps` instead of
  the route file's `SessionsDeps`.

Behavior changes:
- None.

Verification:
- Tier 1: `pnpm --filter @yep-anywhere/shared build`;
  `pnpm --filter @yep-anywhere/server exec tsc --noEmit`;
  `pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts test/routes/sessions-clone-codex.test.ts test/routes/recents.test.ts`;
  `node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-queue-summaries.ts packages/server/src/routes/session-provider-resolution.ts`;
  `git diff --check`.
- Tier 2: `pnpm lint`; `pnpm typecheck`; `pnpm test`.
- Residual risk: the focused route test run still emits the preexisting
  sessions-metadata WARN/INFO log chatter for negative-path Claude
  resume/compact cases, and root `pnpm test` still emits the baseline suite
  chatter recorded above; chatter cleanup remains outside this move slice.

Follow-ups recorded:
- Phase 1.2 still needs a proposed SRR item before implementation.
