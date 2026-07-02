# Session Detail Data Layer Plan

Topic: session-detail-data-layer

Status: Slice 4 store shell started. The pure reducer fixture harness now
covers basic persisted, streamed, catch-up, replay, duplicate-prompt,
duplicate-assistant, pagination, retained-scroll-snapshot, recap-cursor,
Codex-shaped provider parity, final-message markdown augment paths, and Codex
augment live-id to durable-id transfer. `useSessionMessages` feeds a shadow
reducer at existing load, stream, catch-up, pagination, mapping, and
scroll-snapshot boundaries and can opt into compact dev-only divergence
diagnostics without switching production reads to the reducer. The same-tab
route snapshot cache now sits behind a named session detail store with
selector subscriptions, retention controls, expiry/eviction, and stats.
Subagent work is intentionally scoped to broad shape/provenance coverage for
now; exact live-vs-durable subagent parity is deferred until the provider
persistence model is better understood.

This is the tactical plan for the vision in
[`topics/session-detail-data-layer.md`](../../topics/session-detail-data-layer.md).
It is intentionally staged. The first useful outcome is not a new store by
itself; it is a tested canonical transcript reducer that makes duplicate,
stream/reload, augment, and subagent behavior inspectable without mounting the
session page.

## Current State

Session detail currently crosses these ownership boundaries:

- `useSession` owns session status, liveness, stream subscription, watch
  subscription, and higher-level page actions.
- `useSessionMessages` owns initial REST load, messages, agent content,
  pagination, pending/deferred state, stream buffering, replay/catch-up
  reconciliation, and the current same-tab snapshot cache.
- `MessageList` owns render item derivation, progressive rendering, scroll
  snapshots, auto-follow, selection, quote UI, search, and renderer DOM timing.
- Renderer contexts own agent content and markdown augment behavior.
- `/btw` owns child session polling and preview state near the page/component
  layer.

This works by accretion, but it is hard to test the data lifecycle. Many
regressions only appear as mounted UI symptoms: duplicate prompts, duplicate
assistant rows, live/reload mismatches, missing augments, subagent shape drift,
or inline renderer state resets.

## Design Constraints

- Keep same-tab retention memory-only unless a later product requirement asks
  for durable browser persistence.
- Keep token-sized streaming and scroll ticks out of ordinary React
  subscriptions.
- Preserve current user-visible behavior during extraction unless a test
  exposes a clear bug.
- Build with selectors and explicit actions, not one broad global rerender
  source.
- Prefer a small hand-built external store, consistent with YA's existing
  minimalist runtime posture.
- Keep the coarse client summary store separate. Session detail state is not a
  summary-row concern.

## Migration Shape

Avoid a full split-world runtime toggle at first. Running old and new session
detail implementations as separately renderable production paths would double
the hardest ownership questions: stream subscriptions, cache retention,
catch-up ordering, and transcript DOM timing.

Prefer a shadow-first, adapter-first migration:

1. **Pure reducer in parallel.** Extract the transcript reducer and fixture
   tests without changing runtime ownership.
2. **Shadow reducer in tests first.** Feed existing REST/session stream shapes
   into the reducer and assert canonical state without mounting React.
3. **Adapter inside `useSessionMessages`.** Once the reducer is useful, call it
   from existing hooks while preserving the current hook return shape:
   `messages`, `session`, `pagination`, `agentContent`, pending/deferred rows,
   and scroll snapshot callbacks.
4. **Store shell behind existing APIs.** Move retention/cache ownership behind
   the new session detail store while keeping existing cache semantics.
5. **Selectorize after parity.** Let components subscribe to store selectors
   only after reducer/store behavior matches current runtime expectations.

This keeps each slice reviewable. The early commits should be pure functions,
tests, and internal adapters rather than a second user-visible session page.

## Parity And Correctness Tests

The core correctness test is transcript parity:

```text
persisted REST/session response -> reducer -> canonical state
equivalent SDK stream sequence  -> reducer -> canonical state

canonical states match after ignoring explicitly transient runtime fields
```

Initial fixtures should cover:

- persisted transcript load;
- streamed user prompt plus assistant response;
- streamed response committed to durable/persisted rows;
- stream replay followed by REST catch-up;
- duplicate user prompt replay vs genuinely distinct same-text turns;
- duplicate assistant message suppression;
- server-rendered augment before target message;
- server-rendered augment after target message;
- subagent agent references, child-content availability, and provenance shape;
- provider parent/tree path projection during stream vs reload;
- compaction boundary plus loaded tail;
- pagination prepend;
- cache restore followed by catch-up fetch;
- render id stability across reload and DOM linger reveal.

These tests should run without browser DOM, WebSocket, or full REST mocks where
possible. Fixtures should be ordinary payload objects plus reducer actions.

## Feature Toggle Policy

Do not start with a user-facing feature toggle. Early slices should preserve
runtime behavior and be validated by pure reducer/store tests.

Use toggles only when runtime ownership changes materially enough that a
rollback path is useful, for example:

- switching `useSessionMessages` from local state ownership to store-backed
  ownership;
- switching `MessageList` from local render-item derivation to a store selector;
- replacing augment attachment semantics with canonical data-layer attachment.

Before any production toggle, prefer dev-only diagnostics:

- run the old merge path and new reducer path in parallel in development;
- compare compact canonical summaries;
- log divergences with enough ids/cursors to reproduce as fixtures;
- keep rendering from the old path until parity is good.

## Slice 1: Reducer Fixtures

Goal: create a pure transcript reducer test harness without changing runtime
behavior.

Work:

- Define `SessionDetailState` and reducer action types in a new client module.
- Start with fields that already exist in `useSessionMessages`: messages,
  session metadata, pagination, agent content, tool-use-to-agent entries,
  persisted timestamp watermark, last durable cursor, pending/deferred rows,
  and scroll snapshot metadata.
- Add conversion helpers from current API/session stream shapes into reducer
  actions.
- Keep the existing hooks as callers/owners; the reducer can initially mirror
  current state transitions.

Tests:

- persisted transcript load produces the expected canonical state;
- streamed user prompt plus assistant response produces the expected state;
- replayed/catch-up durable messages do not duplicate already-streamed rows;
- duplicate user prompts are represented once when they are the same logical
  turn, and separately when they are genuinely distinct turns;
- compaction boundary rows keep stable order;
- pagination prepend preserves order and cursor metadata.

Exit criteria:

- At least one provider fixture covers equivalent stream and persisted input
  producing the same canonical state.
- Reducer tests run without React, DOM, WebSocket, or REST mocks beyond simple
  payload fixtures.

Status 2026-07-01:

- Added `packages/client/src/lib/sessionDetail/transcriptReducer.ts` and
  `types.ts` with a pure reducer/state shape for persisted transcript loads,
  stream messages, persisted catch-up, pagination prepend, replay suppression,
  and scroll snapshot patches.
- Added reducer fixtures for persisted load, stream-vs-persisted basic-turn
  parity, catch-up replacement of streamed rows, duplicate user prompt
  suppression, distinct same-text user turns, replay suppression, and
  pagination prepend.
- Runtime ownership remains unchanged: `useSessionMessages`, stream
  subscriptions, route snapshots, and `MessageList` still own their current
  behavior while the reducer grows test coverage.
- Added `actionAdapters.ts` so tests can feed REST-load, catch-up,
  older-message, and stream-message inputs into the reducer through named
  boundaries that match the eventual hook adapter.
- Added Codex-shaped normalized fixtures for stream plus persisted catch-up
  parity, buffered replay suppression, attachment opening-turn reconciliation,
  and repeated tool calls with distinct call ids. Fixture text is neutral;
  provider-like ids, timestamps, attachment shape, replay flags, and tool blocks
  are preserved because those fields drive the reducer behavior.

## Slice 2: Augment Attachment Model

Goal: make augment attachment data-level and testable.

Work:

- Add canonical block/message identity helpers used by both live stream and
  durable reload paths.
- Represent attached augments in reducer state or a sibling data structure keyed
  by canonical identity.
- Keep existing renderers consuming the old prop shape through a compatibility
  selector while the internals move.

Tests:

- server-rendered markdown/file/diff augments attach to the same block live and
  after reload;
- augment arrival before its target message is retained and attached when the
  target arrives;
- augment arrival after target message updates the selected render model without
  changing unrelated rows;
- duplicate or stale augment payloads do not create duplicate render content.

Exit criteria:

- Missing-augment regressions can be reproduced as reducer/selector tests
  rather than browser-only symptoms.

Status 2026-07-01:

- Added `markdownAugments` to `SessionDetailState` and an
  `applyFinalMarkdownAugment` reducer action for completed server-rendered
  markdown keyed by message id.
- Added `selectSessionDetailPreprocessAugments` so the data-layer state can
  feed the existing `preprocessMessages` augment shape without moving
  `MessageList` ownership yet.
- Added tests for final markdown augment arrival before the target message,
  after the target message, from persisted-load input, and duplicate same-HTML
  no-op updates.
- Added Codex final-markdown augment transfer when a live SDK message id is
  replaced by an equivalent durable JSONL id during persisted catch-up.
- Added broader core transcript assertions for duplicate assistant catch-up,
  disabled-streaming placeholder removal, durable recap cursor exclusion,
  retained scroll snapshot patching, and subagent shape/provenance pass-through.
- Remaining augment work is still substantial: block-level streaming augments,
  file/diff/tool augment identity, and broader canonical block identity are not
  solved by the message-id transfer.

## Slice 2.5: Hook Shadow Adapter

Goal: feed the reducer from the current runtime ownership boundaries without
changing what the UI reads.

Work:

- Keep `useSessionMessages` owning `messages`, `session`, `pagination`,
  `agentContent`, route snapshots, and stream buffering.
- Add a reducer state ref inside `useSessionMessages`, so reducer actions do
  not trigger React renders.
- Dispatch reducer actions beside existing mutations for initial REST load,
  warm route snapshot restore, warm-delta/catch-up fetches, stream messages,
  subagent stream messages, tool-use-to-agent mapping, older-page prepend, and
  scroll snapshot patches.
- Add dev-only compact divergence diagnostics that compare reducer state
  against the live hook state at those coarse boundaries without logging
  transcript text.
- Continue leaving token-sized streaming markdown updates and DOM patching out
  of the reducer.

Tests:

- reducer tests cover the new route snapshot restore and thin subagent/mapping
  actions;
- existing `useSessionMessages` cache tests continue to verify warm restore,
  incremental refresh coalescing, streaming-placeholder suppression, and
  subagent streaming suppression behavior.

Status 2026-07-02:

- Added `restoreRouteSnapshot`, `applyStreamSubagentMessage`, and
  `registerToolUseAgent` reducer actions with fixture coverage.
- Wired a non-reactive shadow reducer ref into `useSessionMessages`.
- Added opt-in dev diagnostics through
  `yep-anywhere-session-detail-shadow-diagnostics-enabled=true` in
  `localStorage`, or `window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = true`.
  Diagnostics compare compact summaries at initial load, warm snapshot restore,
  warm catch-up, stream message, subagent stream, tool-use mapping, catch-up,
  older-page, and scroll-snapshot boundaries.
- Diagnostic payloads include ids, message type/role/source, parent ids,
  counts, pagination, agent keys/counts, tool-use mappings, durable cursors,
  and scroll snapshot shape. They intentionally omit transcript text and are
  deduped by boundary plus compact live/shadow hash.
- The shadow reducer still is not the source of truth for returned hook values.

Next likely implementation chunk:

- Use any observed diagnostic divergence as a fixture source: copy only compact
  ids/types/sources/order/cursors/provenance into a reducer test, then decide
  whether the reducer or the current hook behavior is the intended canonical
  shape.
- Feed the store from the same hook boundaries as the shadow reducer, still
  keeping `useSessionMessages` as the adapter and keeping production reads on
  the current hook state until selector parity is proven.

## Slice 3: Subagent Shape And Tree Projection

Goal: make provider parent/tree links and subagent availability inspectable
without promising exact live/reload equivalence for every provider yet.

Current stance:

- Treat subagents as broad shape/provenance coverage until fixtures prove a
  provider can reliably supply equivalent live and durable child transcripts.
- Preserve agent references, tool-use-to-agent mappings, availability state,
  and child-content provenance (`liveOnly`, `durableOnly`, `merged`,
  `activityOnly`, or `missingDurable` style states) before attempting a unified
  child transcript normal form.
- Do not assert exact render parity for Codex or newer Claude sidechain
  subagents as an early reducer invariant. Codex live activity and durable
  child sessions are discovered through different provider surfaces, and newer
  Claude sidechain messages no longer carry the legacy `parent_tool_use_id`
  link in the child transcript itself.

Work:

- Model provider parent/tree links in canonical state.
- Represent subagent agent references and content availability through a
  reducer-owned provenance model.
- Keep live stream content, durable child transcript content, and
  provider-specific activity-only signals distinguishable.
- Keep `AgentContentProvider` or a compatibility adapter until renderers can
  read from selectors directly.

Tests:

- subagent task rows preserve the available agent reference and mapping shape;
- live-only, durable-only, merged, missing-durable, and activity-only subagent
  cases remain distinguishable in canonical state;
- provider parent/tree path selection produces stable render order during live
  stream and after reload;
- child transcript updates do not reorder unrelated parent rows;
- subagent task rows keep stable render ids across stream, cache restore, and
  reload.

Exit criteria:

- A side-by-side comparison can explain whether a subagent fixture is live-only,
  durable-only, merged, activity-only, or missing durable content without
  conflating those states or producing duplicate parent rows.

## Slice 4: Session Detail Store Shell

Goal: introduce the explicit store without moving all callers at once.

Work:

- Build a small external store keyed by source/project/session/window params.
- Support synchronous `read`, selector `subscribe`, reducer `dispatch`,
  `retain`, `release`, `evictExpired`, `clear`, and `getStats`.
- Implement same-tab memory retention with TTL, max entries, and byte cap.
- Move the current `SessionRouteSnapshot` map behind this store API, preserving
  behavior and settings.
- Keep scroll snapshot patches non-notifying by default.

Tests:

- TTL and LRU eviction match current snapshot-cache behavior;
- disabling transcript cache clears retained session detail entries;
- scroll snapshot patches update retained state without notifying ordinary
  subscribers;
- source/session/window keys do not collide;
- store stats identify retained entries and approximate memory.

Exit criteria:

- No direct `globalThis.__YA_SESSION_ROUTE_SNAPSHOTS__` ownership remains.
- Current session cache tests pass through the store API.

Status 2026-07-02:

- Added `sessionDetailStore.ts`, a small hand-built external store keyed by
  source/project/session/window parameters.
- The store supports synchronous `read`, selector `subscribe`, reducer
  `dispatch`, `retain`, `release`, `evictExpired`, `clear`, and `getStats`.
- Moved `SessionRouteSnapshot` ownership behind the store while preserving the
  existing `sessionRouteSnapshots` compatibility API used by
  `useSessionMessages` and the Performance settings reset path.
- Scroll snapshot patches update retained state without notifying ordinary
  selector subscribers by default.
- Added direct store coverage for source scoping, selector notifications,
  non-notifying scroll patches, retained TTL behavior, and retained-entry LRU
  behavior. Existing route snapshot and warm-cache hook tests pass through the
  store-backed compatibility API.
- Remaining Slice 4 work: expose the store as a runtime diagnostic/read surface
  from the hook adapter and decide whether active in-view entries should be
  retained separately from same-tab warm-cache entries before switching reads.

## Slice 5: Hook Adapter Migration

Goal: make hooks subscribe to session detail state rather than owning all core
data locally.

Work:

- Convert `useSessionMessages` to a store adapter in small steps.
- Keep `useSession` responsible for stream/watch subscription and high-level
  actions, but route incoming message lifecycle actions into the store.
- Use selectors so `SessionPage` can read metadata/loading state separately
  from the transcript rows.
- Preserve `MessageList` props initially to avoid coupling the store migration
  to renderer changes.

Tests:

- existing `useSessionMessages` tests still pass through the adapter;
- stream buffering before initial load applies once and in order;
- catch-up fetch after cached restore does not reset the transcript;
- loading older messages prepends without losing scroll snapshot metadata;
- multiple consumers of the same session detail key see coherent data.

Exit criteria:

- Core session detail data lives in the store while the public hook return shape
  remains compatible.

## Slice 6: Render Selector

Goal: make the renderable transcript view a deterministic selector.

Work:

- Extract `RenderItem` derivation from `MessageList` where practical.
- Keep DOM-local progressive rendering and scroll state inside `MessageList`.
- Ensure render ids are stable across stream, reload, cache restore, and
  subagent expansion.
- Use selector tests for render shape before adding browser-level coverage.

Tests:

- same canonical state always yields the same render item ids/order;
- equivalent stream and persisted states yield equivalent render items;
- inline renderer keys survive cache restore and DOM linger reveal;
- hidden/expanded thinking and tool preview settings do not mutate canonical
  state.

Exit criteria:

- `MessageList` no longer performs semantic transcript normalization. It
  receives a deterministic render model plus DOM-local settings/state.

## Slice 7: `/btw` And Multi-Consumer Cleanup

Goal: make related session consumers first-class, not page-local side channels.

Work:

- Represent `/btw` child/aside sessions as related session detail entries.
- Replace page-local polling preview state with store actions/selectors where
  possible.
- Prove two mounted session detail consumers can render independently from the
  same store without sharing DOM-local scroll state.

Tests:

- `/btw` aside preview updates through session detail data, not duplicated page
  state;
- side-by-side session consumers do not share scroll/selection state;
- unmounting one consumer does not evict data still retained by another
  consumer;
- closed consumers release store retention and stream/watch ownership remains
  explicit.

Exit criteria:

- `/btw` becomes a session-detail consumer with explicit data ownership.

## Verification Matrix

Provider fixtures should eventually cover at least:

- Claude: parent/tree, compaction, task/subagent rows, SDK stream vs JSONL.
- Codex: replay/catch-up dedupe, subagent rollout, thinking/summary blocks,
  provider id drift.
- OpenCode/Grok/Pi: provider-normalized tool/result rows where durable and live
  shape can differ.

Behavioral fixtures should cover:

- duplicate user prompt suppression;
- duplicate assistant message suppression;
- streamed assistant response committed to durable row;
- augment target before/after arrival;
- lazy subagent load after parent render;
- cache restore followed by catch-up fetch;
- pagination prepend;
- compaction boundary plus loaded tail;
- render id stability across reload and linger reveal.

## Rollout Notes

- Land reducer and store tests before switching runtime ownership.
- Prefer adapters over large rewrites. It is acceptable for old hooks to call
  the new reducer/store while still returning the old shape.
- Keep instrumentation visible: store stats should help answer which sessions
  are retained, why, approximate bytes, and expiry time.
- When behavior differs from current runtime, capture the existing bug as a
  failing reducer/selector test before changing UI code.
