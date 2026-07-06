# TypeScript Module Boundary Refactor

Topic: typescript-module-boundary-refactor

Status: Draft tracking document. No refactor slices have started.

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

Before the first nontrivial refactor slice starts, record a clean baseline.
This makes later regressions attributable to the slice instead of to preexisting
repo state.

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

- Recorded 2026-07-06 12:08 CEST at `3dd6f88b6d7eaff3b42153242b4f7891ef7c557b`.
  The worktree was dirty before the baseline run with unrelated project-queue
  changes; no source movement had started for this refactor.
- Passing checks are attributable as pass/fail gates. The unit/E2E runs are not
  warning-free gates because they emitted existing test/logging chatter:
  settings-fetch stderr in client tests, server `CODEX_* slow scan` WARN logs
  against the local Codex session directory, expected negative-path
  WebSocket/auth stderr, Vite build warnings, and Node `NO_COLOR`/`FORCE_COLOR`
  warnings.
- The console chatter scan is at its current budget, not clean: 110 warning
  call sites, 0 over budget. Client slices must avoid increasing that budget.
- Use the same command set again after every nontrivial slice unless the slice
  table explicitly lists a narrower tripwire and explains why it is sufficient.

## Large-File Inventory: 2026-07-06

Generated/build/reference trees were excluded with `rg --files`; specifically
`node_modules`, `dist`, nested `dist`, `references`, coverage and Playwright
reports, and generated Codex protocol/schema directories.

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

## Global Guardrails

- Prefer move-only or extraction-only commits. A behavior change discovered
  during movement becomes a separate slice.
- Keep public facades stable: route factory names, exported component props,
  provider interfaces, API client names, and test helper entry points should not
  churn merely to split files.
- Do not apply Biome organize-imports as cleanup. Import edits should be scoped
  to moved symbols.
- Do not add runtime dependencies for one-file helpers.
- Do not change timers, watchers, polling, retry behavior, heartbeat cadence,
  session liveness, stream/reconnect behavior, fan-out, replay buffering, or
  catch-up semantics as part of this refactor. If a slice touches those areas,
  read `topics/architecture-mandates.md` and the linked architecture document
  first, then add slice-specific tripwires before editing.
- For client transcript/rendering slices, follow
  `packages/client/RENDERING_PERFORMANCE.md`: no token-sized React state, no
  broad formatter inputs, stable row identity, and no automatic historical row
  height changes.
- For source/transport slices, follow `topics/source-transport.md`; relocation
  is not permission to redesign reconnect, readiness, relay, SRP, or NaCl
  behavior.
- For Codex provider slices, follow the Codex version bump audit rules in
  `AGENTS.md` when source/protocol changes imply drift against the declared
  Codex CLI target.

## Phase 0: Preparation And Tracking

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 0.1 | Recorded 2026-07-06 | Baseline gate | Run and record the baseline command set above. | Pass/fail baseline recorded; warning-free status is not clean because existing test/E2E chatter was observed. |
| 0.2 | Recorded 2026-07-06 | Large-file inventory | Refresh the production/test LoC inventory and paste the top offenders here or in a dated note. | Inventory recorded above using `rg --files` plus `wc -l`, excluding `node_modules`, `dist`, generated protocol files, and `references`. |
| 0.3 | In progress | Slice ledger upkeep | After each slice, update this document with status, commands, notable risk, and follow-up candidates. | The doc is the handoff surface for future sessions. |

## Phase 1: Server Route Mechanical Splits

High value and comparatively low risk: route files have obvious endpoint
groups, and `create*Routes()` aggregators can remain stable.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 1.1 | Not started | `packages/server/src/routes/sessions.ts` shared helpers | Move pure request/body parsing, provider checks, queue summary helpers, and restart/fork helper functions into a `routes/sessions/` helper module without changing route registration. | Move-only. Run route/session tests plus root checks. |
| 1.2 | Not started | Session detail routes | Extract metadata, agent content, and `GET /projects/:projectId/sessions/:sessionId` handlers behind a `createSessionDetailRoutes` or equivalent local registrar. | Preserve pagination, compact-tail, augment, and unread semantics. Run session-detail client/server tests and server E2E. |
| 1.3 | Not started | Start/create/resume/reactivate routes | Extract new-session, two-phase create, resume, and reactivation handlers. | Preserve provider selection, YA-visible session ids, executor persistence, queue-full behavior, and remote sync behavior. |
| 1.4 | Not started | Restart/fork/recap/retitle routes | Extract restart, fork, recap, fork-summary, and retitle flows. | Higher risk than 1.2/1.3; preserve handoff/fork semantics and recap background behavior. |
| 1.5 | Not started | Queue/deferred routes | Extract message queue, deferred patient queue, steer/cancel, pending input, and mode routes. | Read `topics/architecture-mandates.md`; queue timers and idle ownership are load-bearing. |
| 1.6 | Not started | Metadata/notifications routes | Extract metadata updates, mark-seen, last-seen, archive/star, and debug metadata routes. | Lower risk; preserve event-bus update emissions. |
| 1.7 | Not started | `routes/settings.ts` parser split | Move settings parsers/discovery helpers out of the route factory. | Good follow-up once `sessions.ts` pattern is proven. |
| 1.8 | Not started | `app.ts` route composition cleanup | Extract app dependency construction or route mounting groups only after route modules are stable. | Do not alter middleware order, auth policy, or hosted-client endpoint selection. |

## Phase 2: Client Page And Component Boundaries

Prioritize React files where one component function owns many unrelated hooks
and effects. Extract feature hooks/components while keeping visible behavior and
props stable.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 2.1 | Not started | `SessionPage.tsx` pure helpers | Move attachment conversion, text extraction, public-share prompt parsing, Codex config ack parsing, and title helpers into adjacent modules. | Move-only. Add or keep focused helper tests where extraction exposes pure behavior. |
| 2.2 | Not started | `SessionPage.tsx` `/btw` aside orchestration | Extract aside prompt parsing, polling, split-pane focus state, and minimal aside composer helpers into a feature module/hook. | Read `topics/provider-agnostic-btw-asides.md`; preserve composer routing and default provider-like behavior. Run client E2E. |
| 2.3 | Not started | `SessionPage.tsx` composer submission/attachments | Extract staged/uploaded attachment preparation and draft transfer helpers. | Preserve object URL cleanup and staged attachment batch invariants. Run attachment/upload tests and client E2E. |
| 2.4 | Not started | `MessageList.tsx` selection and quote behavior | Extract selected-text shielding, quote button placement, copy handling, and selection helpers. | DOM-local behavior; run `MessageList` tests and client E2E. |
| 2.5 | Not started | `MessageList.tsx` scroll/follow snapshots | Extract scroll-follow, catch-up, and retained scroll snapshot hooks. | High risk. Follow `RENDERING_PERFORMANCE.md` and scrollback stability docs; run full client E2E and inspect browser behavior. |
| 2.6 | Not started | `MessageList.tsx` isearch UI state | Extract reverse search state/projections that are still DOM-local. | Keep pure selector work in `lib/sessionDetail/`; avoid duplicating selector ownership. |
| 2.7 | Not started | `MessageInputToolbar.tsx` view/control split | Separate toolbar measurement/overflow logic from presentational controls. | Preserve compact mobile overflow and liveness display. |
| 2.8 | Not started | `MessageInput.tsx` textarea mechanics | Extract undoable text edits, resize, slash matching, and speech target helpers. | Preserve browser undo stack and focus behavior. |
| 2.9 | Not started | `NewSessionForm.tsx` project/options helpers | Move project sorting, provider option resolution, recap/prompt-suggestion defaults, and attachment helpers. | Preserve i18n and staged attachment behavior. |
| 2.10 | Not started | `GitStatusPage.tsx` diff preview module | Extract diff fetch/render preview components after large-diff admission guards are in place. | Read `docs/project/2026-07-06-git-status-large-diff-hang.md`; do not refactor around an unbounded preview path. |

## Phase 3: Existing Architecture-Aligned Migrations

These areas already have accepted topic/tactical documents. This tracking doc
should not fork their plans; it only records where LOC reduction can happen as
part of their planned slices.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 3.1 | Not started | `useSessionMessages.ts` adapter cutdown | Continue the existing session-detail data-layer migration by shaving reveal/progress/pagination bookkeeping into tested helpers. | Follow `docs/tactical/043-session-detail-data-layer-plan.md`; do not start a parallel transcript rewrite. |
| 3.2 | Not started | `clientSummaryState.ts` source-store helpers | Split pure collection/reducer/query helpers only when touching summary-state behavior. | Follow source-runtime topology docs. |
| 3.3 | Not started | `SecureConnection.ts` internals | Extract only when aligned with source-transport boundary work or clear pure helpers. | Follow `topics/source-transport.md`; preserve parity rows and full transport tests. |
| 3.4 | Not started | `api/client.ts` domain clients | Consider domain-specific API modules once source transport shims are stable. | Keep the exported `api` facade stable until callers migrate deliberately. |

## Phase 4: Provider Adapter Splits

Provider files are large, but they touch upstream-facing behavior. Prefer
extracting pure protocol/model/normalization modules with strong fixtures.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 4.1 | Not started | `sdk/providers/codex.ts` app-server client | Move `CodexAppServerClient`, JSON-RPC queueing, process termination, and raw request helpers into focused modules. | Run Codex provider tests and server E2E. |
| 4.2 | Not started | Codex model catalog helpers | Move fallback model data, semver parsing, model sorting, and model metadata normalization. | Low risk if tests pin catalog output. |
| 4.3 | Not started | Codex notification guards | Move `as*Notification` guards and raw notification classifiers into a protocol module. | Fixture-heavy; compare stream and persisted render parity where relevant. |
| 4.4 | Not started | Codex live event conversion | Move live turn state, streaming message construction, and item-to-SDK conversion. | Higher risk; preserve live-delta suppression and replay behavior. |
| 4.5 | Not started | Codex recap/summary helpers | Move recap prompts, fork-backed summary, retitle prompt, and summary capture helpers. | Preserve helper model resolution and provider-visible prompt behavior. |
| 4.6 | Not started | Claude/OpenCode provider helper splits | Apply the proven Codex split pattern only where clear seams exist. | Avoid abstracting providers together unless duplication becomes real and tested. |

## Phase 5: Load-Bearing Supervisor And Process Files

These are intentionally late. Size alone is not enough reason to split them
because they own process lifecycle, replay, fan-out, idle cleanup, queues, and
heartbeat behavior.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 5.1 | Deferred | `Process.ts` pure helper extraction | Move static/pure helpers for message text, API retry status, permission pattern matching, and formatting when touched. | Move-only; no stream/replay/timer changes. |
| 5.2 | Deferred | `Process.ts` recap helper boundary | Consider extracting recap generation helpers if recap work resumes. | Preserve native recap waiters and pending recap flow. |
| 5.3 | Deferred | `Process.ts` queue persistence helpers | Consider extracting patient/deferred queue persistence helpers only with queue-specific tests. | Read architecture mandates; idle sessions must not retain repeating work. |
| 5.4 | Deferred | `Supervisor.ts` recap/compaction helpers | Extract pure compaction threshold, heartbeat candidate, and recap helper functions opportunistically. | Do not alter worker pool, preemption, liveness, or heartbeat scheduling. |
| 5.5 | Deferred | Shared pub/sub abstraction | Do not do this as part of LOC cleanup. | `ARCHITECTURE.md` says wait for a third pub/sub. |

## Phase 6: Tests And Fixtures Organization

Large tests are acceptable when they read like scenario ledgers, but splitting
can improve review when scenarios are independent.

| Slice | Status | Target | Intent | Tripwires / Notes |
|---|---|---|---|---|
| 6.1 | Not started | `MessageList.test.tsx` scenario files | Split by behavior area: progressive rendering, thinking, queue rows, selection/copy, scroll, search. | Keep shared fixture helpers stable. |
| 6.2 | Not started | `process.test.ts` scenario files | Split by queue, approvals, replay/streaming, liveness, recap, termination. | Preserve fake timers and cleanup discipline. |
| 6.3 | Not started | `codex.test.ts` fixtures | Move repeated raw notification fixtures and expected SDK outputs into fixture modules. | Avoid hiding expected behavior behind opaque helpers. |
| 6.4 | Not started | Route metadata tests | Split route metadata tests once route modules split. | Keep request/response assertions explicit. |

## Suggested Landing Template

Each slice should update its row with a short landing note:

```text
Status: Landed YYYY-MM-DD, <commit or branch if known>.
Moved:
- ...
Behavior changes:
- None. / Listed separately in follow-up slice.
Verification:
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm test:e2e
- pnpm test:e2e:sdk
Notes:
- ...
```

If a full E2E command is skipped, record why and list the focused E2E or manual
browser check that covers the touched behavior.

## Deferred Non-Goals

- Enforcing a hard repository-wide LOC limit.
- Introducing a new folder taxonomy across the whole repo.
- Converting all large components to compound component patterns.
- Replacing existing store/transport/session-detail plans.
- Adding virtualization, new queues, new transport buffering, or new provider
  abstractions as part of file-size cleanup.
