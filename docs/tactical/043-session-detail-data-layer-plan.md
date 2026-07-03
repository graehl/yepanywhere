# Session Detail Data Layer Plan

Topic: session-detail-data-layer

This is the current tactical plan for the vision in
[`topics/session-detail-data-layer.md`](../../topics/session-detail-data-layer.md).
Completed-slice detail lives in
[`043-session-detail-data-layer-history.md`](043-session-detail-data-layer-history.md).
The dogfood-toggle transition audit lives in
[`043-session-detail-data-layer-toggle-preflight.md`](043-session-detail-data-layer-toggle-preflight.md).
The render-selector preflight lives in
[`043-session-detail-render-selector-preflight.md`](043-session-detail-render-selector-preflight.md).

## Current Status

The migration is in the adapter/store cutdown phase. We have a tested
`SessionDetailState` reducer and a small keyed external store, and the store
snapshot is already the normal returned data source for the main transcript,
subagent maps, and tool-use mapping after hydration. The remaining work is to
delete legacy local mirrors and fallback recomputation one boundary at a time.

What is already in place:

- Reducer fixtures cover persisted load, stream, catch-up, replay, duplicate
  prompts, duplicate assistant rows, pagination, retained scroll snapshots,
  recaps/cursors, Codex-shaped parity, final markdown augments, and several
  subagent/message-cache paths.
- `useSessionMessages` feeds the session detail store at existing load,
  stream, catch-up, pagination, mapping, subagent, metadata, and
  scroll-snapshot boundaries.
- Dev-only diagnostics can compare live hook state against the store without
  logging transcript text. The earlier hook-local shadow reducer ref was
  removed once store parity reporting covered the same comparison; the store
  is the single mirrored reduction.
- The earlier returned-data invariant diagnostic was removed because it
  compared returned data to the same store snapshot that produced it. It did
  not provide an independent safety signal.
- Same-tab route snapshot retention now sits behind
  `defaultSessionDetailStore`, with TTL, byte-cap, retain/release, selector
  subscriptions, and stats. TTL and the byte budget are user-configurable
  Performance-settings sliders (budget 0 = off, replacing the old boolean
  toggle, whose stored value still seeds the budget); the entry-count cap
  is retired in favor of the budget. Row charges are measured per object
  (memoized by identity, calibrated against real transcripts in
  `sessionDetail/transcriptCharge.ts`) and rows shared across entries are
  charged once in aggregate eviction accounting.
- Public raw setter escape hatches have been removed for tool-use mappings,
  session metadata, agent content, and messages.
- Narrow selectors are already used for retained scroll, pagination,
  older-page cursor selection, main stream-message fallback mirroring,
  persisted catch-up fallback mirroring, older-page fallback mirroring, and
  main streaming placeholder message upsert/cleanup.
- Initial load, warm-route restore, warm catch-up before hydration, and warm
  catch-up after hydration now share one selected-runtime-snapshot reveal path:
  after the store restore/load/catch-up action, the hook copies that snapshot
  into the local fallback mirrors while preserving the existing loading gate.
- Route-cache refresh on unmount now reads the current route snapshot directly
  from `defaultSessionDetailStore` instead of rebuilding it from returned hook
  data. The old `latestSnapshotRef` mirror has been removed; diagnostics that
  need a local fallback read the hook refs directly.
- `toolUseToAgent` registration now has a selector-backed mirror: after the
  reducer/store dispatch, the local fallback `Map` copies the store-selected
  mapping entries instead of independently rebuilding from its previous value.
- `agentContent` has selector-backed mirrors for ordinary subagent stream
  events, loaded subagent content, context-usage updates, and subagent
  streaming placeholder upsert/cleanup; those paths copy the store-selected
  map back into the local hook mirror after reducer/store dispatch.
- Ordinary stream, streaming-placeholder, subagent, tool-use mapping,
  persisted catch-up, and older-page adapter paths no longer independently
  recompute legacy fallback data after dispatch. They read the store-selected
  result and only fall back to the current local mirror if the retained store
  entry is unexpectedly missing.
- Those store-selected adapter paths now keep hook refs current but skip the
  redundant React state writes while Store-Backed Session Detail is enabled.
  When the Development switch is off, the same paths still write the local
  mirrors so rollback mode keeps behaving like the old hook-local return path.
- Selected runtime-snapshot reveal now uses the same conditional mirror helpers:
  with Store-Backed Session Detail enabled, reveal updates refs plus local
  session/pagination state but does not write local `messages`, `agentContent`,
  or tool-use state. Reset-to-loading now uses an explicit current-route reveal
  gate instead of clearing local transcript mirrors, so warm store data and
  stale rollback mirrors stay hidden until the route snapshot is revealed.
- No-signal store/local diagnostics have been removed from store-selected
  stream, placeholder, subagent, tool-use, and reveal paths. Remaining
  `[SessionDetailStore]` logs cover metadata, catch-up/older
  cursor-watermark-pagination bookkeeping, scroll snapshots, and unexpected
  missing selectors.
- Store-selected `messages`, `agentContent`, and tool-use mappings are now the
  default returned hook data after initial hydration has reached the same reveal
  point as the local mirror. The Development settings switch remains as a
  rollback path to compare against the legacy hook-local mirror.
- Focused hook coverage now verifies that store-authoritative returned
  `messages` preserve selector-only rows across ordinary stream events,
  incremental catch-up, and older-page prepend.
- Focused hook coverage also verifies that store-authoritative returned
  `agentContent` is gated during warm hydration, ignores selector-only entries
  when the toggle is off, and returns selector-only entries when the toggle is
  on.
- Focused hook coverage now verifies that store-authoritative returned
  tool-use mappings can expose selector-only entries when the toggle is on and
  stay local-only when it is off during ordinary registration.
- Focused hook coverage also verifies that same-hook route changes keep stale
  rollback mirrors hidden before the next route has revealed, including an
  initial-load error path.
- Warm-cache hook coverage now verifies that a retained full transcript window
  remains coherent when the refresh response falls back to a smaller compacted
  tail window: the store-backed returned data keeps the broader message set and
  reconciles pagination so `hasOlderMessages`/`returnedMessageCount` describe
  the merged window rather than the narrower tail response.
- The catch-up store-authoritative hook fixture now guards against React's
  cross-update warning. Metadata reconciliation no longer dispatches to the
  external store from inside the legacy `setSession` functional updater.
- The render-selector preflight is complete: transcript/view shape
  derivation — render items and turn grouping, search anchors/projections,
  timeline and progressive-reveal entries, thinking summaries, composer tail
  rows, and action eligibility — lives in the `sessionDetail/` render-selector
  modules behind the `renderSelectors` barrel. The full covered-output list is
  in
  [`043-session-detail-render-selector-preflight.md`](043-session-detail-render-selector-preflight.md).

Current diagnostic stance:

- Treat `scroll-snapshot` store divergence logs as known noisy signal
  from the older snapshot path. Do not spend migration time chasing those until
  returned `messages`/`agentContent` and render-selector parity are otherwise
  boring enough for a cleaner cutover audit.
- Keep dogfooding the default store-backed returned-detail path and turn
  visible regressions or non-scroll store/local divergences into compact
  fixtures. Store/local diagnostics now have residual signal mostly for fields
  that are not simply copied from the store-selected result: cursor refs,
  timestamp watermarks, pagination, metadata, and scroll.
- Do not use absence of `[SessionDetailReturnedData]` logs as evidence. That
  diagnostic was removed because the default returned data is store-selected by
  construction. Current confidence comes from reducer fixtures, focused hook
  tests, and dogfooding the real browser path.
- Browser mismatch checks should use the real inbox-to-session path, not only
  unit fixtures. A useful read-only pass is: launch Playwright against
  `https://127.0.0.1:3400`, ignore local HTTPS errors, block service workers
  if possible, confirm `yep-anywhere-developer-mode` has
  `sessionDetailStoreMessagesEnabled: true` (the default), set
  `yep-anywhere-session-detail-shadow-diagnostics-enabled` to `true`, click a
  few visible `/inbox` session links, and capture console/page/request
  failures plus `[SessionDetailShadow]` and `[SessionDetailStore]` logs. Also
  sample
  `main.session-messages` `scrollTop`, `scrollHeight`, and `clientHeight` so
  scroll-to-top symptoms are separated from data divergence.
- A 2026-07-02 browser pass found no scroll-to-top reproduction and no
  data-visible regression, but did expose two follow-up signals: a Codex
  compaction-tail case where live state represented a returned tail window
  while the store/shadow entry had a much larger accumulated transcript, and a
  React warning caused by external-store notification during a React state
  reducer. The tail-window/full-history contract now has reducer/store/hook
  fixtures and warm-refresh pagination reconciliation; the warning case is
  covered by the catch-up hook fixture and fixed by keeping metadata store
  dispatch out of the legacy state updater.

The key remaining truth is simple: the reducer/store is now the default source
for returned `messages`, `agentContent`, and tool-use mappings after hydration,
while the legacy hook-local mirrors are progressively shrinking into
revealed-state copies plus rollback/reveal scaffolding. The Development
settings switch no longer means "do not use the store"; it means "return the
store snapshot everywhere it is currently approved" versus "return the safer
local mirror copies while the store continues to feed, retain, and drive
selector reads." The render-selector preflight is complete enough for cutover
planning: `MessageList` still owns stateful UI, callbacks, scroll, DOM
behavior, and JSX, but broad transcript/view shape derivation is no longer
hidden inside the component.

## Why This Exists

Session detail state grew inside hooks and render components. That made several
classes of bugs hard to reason about or test:

- duplicate prompts or assistant rows;
- live stream vs reload shape drift;
- order-dependent markdown/file/diff augments;
- subagent rows that differ between streaming SDK state and persisted logs;
- inline renderer resets after cache restore or DOM linger;
- scroll bugs whose visible symptom is far away from the data transition that
  caused them.

The goal is a data lifecycle that can be tested from payload snapshots and
reducer actions before we look at the DOM.

## Current Ownership

Ownership is intentionally still split while we migrate:

- `useSession` owns session status, liveness, stream/watch subscriptions, and
  page-level actions.
- `useSessionMessages` owns initial REST load, stream buffering, local message
  mirrors, local agent-content mirrors, pagination, and snapshot lifecycle.
- `defaultSessionDetailStore` owns the reducer-fed canonical mirror and retained
  same-tab cache entries.
- `MessageList` still owns display policy, progressive rendering, scroll
  snapshots, selection, quote/search UI, and DOM timing. Pure render-item,
  assistant-segment, search-anchor, visible-group, search-match, latest
  correctable prompt, timeline-entry, progressive-count, and
  progressive-visibility projections plus thinking summary/display, timestamp,
  composer-tail, composer-tail row metadata, and assistant timeline row
  metadata and timeline display-row metadata derivation now live outside the
  component.
- Renderer contexts still own DOM/render conveniences, but lazy-loaded agent
  content now enters through the action layer.

This split is acceptable while the hook return shape remains compatible. The
selector preflight should not continue as an open-ended cleanup project; the
next meaningful migration work is in the hook/store adapter.

## Constraints

- Keep token-sized streaming and scroll ticks out of ordinary React
  subscriptions.
- Keep same-tab retention memory-only unless a product requirement asks for
  durable browser persistence.
- Preserve user-visible behavior unless a fixture exposes a clear bug.
- Prefer explicit actions and selectors over a broad global rerender source.
- Keep the coarse client summary store separate from session detail state.
- Default user-facing behavior must stay provider-like. New experimental
  runtime changes should start default-off in Developer settings before they
  graduate to default-on with rollback.

## Migration Shape

The strategy remains shadow-first and adapter-first:

1. Keep the reducer/store fed from existing hook boundaries.
2. Add compact fixtures when diagnostics expose a divergence.
3. Replace one local derivation at a time with a store selector plus fallback.
4. Only after enough parity, promote a store-authoritative mode for larger
   returned surfaces, while keeping a rollback switch during dogfooding.
5. Keep `MessageList` and DOM-local scroll/progressive rendering out of the
   data-layer cutover until the data model is boring.

Avoid a full split-world UI where old and new session pages both render
production traffic. That would duplicate stream ownership, cache retention, and
DOM timing problems.

## Near-Term Plan

Next likely slice:

- Treat the render-selector preflight as complete enough. Do not keep
  extracting every remaining branch from `MessageList` unless it directly
  unlocks store cutover or fixes a fixture-backed bug.
- Continue dogfooding the default store-authoritative returned
  `messages`/`agentContent`/tool-use mapping path and turn any visible
  regression or meaningful non-scroll store/local divergence into a compact
  reducer or hook fixture. Do not reintroduce a returned-data invariant unless
  it compares two genuinely independent sources.
- Delete legacy local mirror ownership aggressively, one boundary at a time.
  Ordinary stream, placeholder, mapping, catch-up, and older-page recompute
  fallbacks have already been cut down to store-selected reads, and
  warm/initial reveal now shares one selected-runtime-snapshot helper. Route
  cache persistence now reads back from the store. Store-selected adapter paths
  now avoid redundant React state writes while the default store-backed return
  path is enabled, reveal writes are also ref-only for the returned store-backed
  surfaces, reset/loading uses a separate returned-detail reveal gate instead
  of clearing transcript mirrors, and no-signal store/local diagnostics have
  been narrowed out. The next slices should target the remaining local mirror
  state itself: fallback ownership and rollback behavior.
- Keep the compaction/tail invariant explicit: `loadPersistedTranscript`
  represents the REST-returned transcript window, including ordinary
  `tailCompactions: 2` responses whose `pagination.totalMessageCount` is larger
  than `pagination.returnedMessageCount`; `prependOlderMessages` and catch-up
  actions may expand that window. A store-authoritative return path must not
  accidentally swap a tail-window UI back to a full-history retained entry
  unless the user actually loaded that broader window.
- Move the next implementation chunks back to `useSessionMessages`: keep
  store-selected returned detail as the normal test path with a Development
  rollback, and identify one remaining mirror path at a time that can become
  store-only or disappear.

Then:

- Keep the Development settings switch available as a dev-only rollback while
  dogfooding the default store-backed path.
- Do not broaden to scroll ownership or `/btw` until returned `messages` and
  `agentContent` are boring.

Dogfood switch:

- Name: Store-Backed Session Detail in the Development settings page.
- Current default-on scope: returned `messages`, `agentContent`, and tool-use
  mappings.
- Behavior today: read store-selected `messages`, `agentContent`, and tool-use
  mappings from one coherent store-state snapshot after hydration, with the
  local mirrors as fallback.
- Off behavior: return the legacy hook-local mirrors, but keep the
  reducer/store feed, selector-backed adapter reads, diagnostics, and cache
  ownership running. Turning the switch off is not a store no-op and no longer
  provides an independent data-semantics rollback on normal mounted paths.
- Keep local mirrors only where they still support fallback, diagnostics for
  independently owned fields, or the Development settings rollback.
- With the switch enabled, ordinary post-dispatch store-selected paths update
  refs but do not set local mirror state. If the switch is flipped off during a
  mounted session, the hook hydrates local mirror state from those refs.
- Reveal follows the same rule for returned store-backed surfaces. Reset starts
  an explicit returned-detail reveal gate instead of clearing transcript mirror
  state to preserve warm-hydration gating.
- Store/local diagnostics no longer run on paths where the live payload is just
  the selected store result; remaining logs are for independently owned refs,
  metadata, scroll, or missing selector cases.
- Do not include render selectors or `/btw` in this toggle.

## Current Risks

- Initial load and warm hydration still contain the most sequencing logic
  because they coordinate loading progress, warm-cache reveal, cache writes,
  and stream-buffer flushing inside the hook. Their visible reveal now comes
  from one selected store snapshot, but the hook still computes warm merge
  candidates for pagination reconciliation and fallback diagnostics.
- The local mirror states still exist for fallback and rollback mode. With
  store-backed return enabled, ordinary post-dispatch and reveal paths keep refs
  current without local setState, and reset/loading no longer clears transcript
  mirrors. The state variables remain a structural cost until rollback semantics
  are retired or further narrowed.
- The rollback switch mainly protects reveal timing, subscription behavior,
  object identity, and remaining locally owned refs. It should not be treated
  as an independent rollback for reducer data semantics on normal mounted
  paths.
- Compaction-tail and full-history states are easy to confuse because the
  default route has no explicit `tailTurns`/`tailFrom` URL parameter even
  though the client requests `tailCompactions: 2`. Treat message-count
  differences where `totalMessageCount > returnedMessageCount` as a cutover
  invariant to classify, not automatic noise.
- Retention pre-creates the entry for mounted sessions, so the store dispatch
  guard only protects completely missing/unretained entries. If a required
  selector read after dispatch ever logs
  `session-detail-selector-missing-after-dispatch`, treat that as an
  adapter/retention bug and add a fixture.
- Store subscribers can currently be notified on broad state-object changes.
  That is acceptable during cutdown but should become keyed/selector-specific
  before calling the data-layer cutover done.
- Subagent live-vs-durable parity is intentionally broad-shape only. Some
  providers may not persist enough SDK-side subagent data to guarantee exact
  equivalence.
- `MessageList` still performs semantic display work for stateful UI,
  especially progressive reveal state/timing, search navigation state, and
  `/btw` ownership. Store canonical state does not yet mean render canonical
  state.
- Scroll symptoms can still be caused by DOM timing, retained snapshots, or
  render-item identity, not just data shape.
- `scroll-snapshot` diagnostics are currently useful as a reminder that final
  cutover needs a cleaner parity signal, but they are not a near-term blocker
  while the rest of the data/render layer is still migrating.
- A store-authoritative messages toggle may expose reducer gaps quickly; that
  is useful for dogfooding, but it should remain easy to disable.

## Later Work

### Hook Adapter Migration

Make `useSessionMessages` mostly a compatibility adapter over the store while
preserving its public return shape.

Important tests:

- initial load and warm restore produce equivalent store/local state;
- stream buffering before initial load applies once and in order;
- catch-up after cached restore does not reset the transcript;
- older-page prepend preserves scroll metadata and cursors;
- multiple consumers of the same session detail key see coherent data.

### Render Selector

Make the renderable transcript view a deterministic selector before changing
`MessageList` ownership.

Important tests:

- same canonical state yields stable render item ids/order;
- equivalent stream and persisted state produce equivalent render items;
- inline renderer keys survive cache restore and DOM linger reveal;
- display settings do not mutate canonical state.

### `/btw` And Multi-Consumer Cleanup

Represent related session consumers as explicit session detail entries instead
of page-local side channels.

Important tests:

- `/btw` aside preview updates through session detail data;
- side-by-side consumers do not share scroll or selection state;
- unmounting one consumer does not evict data retained by another;
- stream/watch ownership remains explicit.

## Verification Matrix

Keep coverage growing in three layers:

- Reducer fixtures for data shape, dedupe, provenance, cursor, and augment
  behavior.
- Hook/store tests for adapter boundaries, selector fallback, warm retention,
  and lifecycle cleanup.
- Browser tests only when the risk is DOM-local: scroll, progressive rendering,
  inline renderer identity, or visible layout.

When behavior differs from current runtime, capture the existing behavior or bug
as a failing reducer/selector test before changing UI code.

## Rollout Notes

- Prefer adapters over large rewrites.
- Keep dev diagnostics available during dogfooding.
- Store stats should answer which sessions are retained, why, approximate bytes,
  and expiry time.
- New experimental toggles should be default-off and easy to disable. This
  store-backed returned-detail switch has graduated to default-on, with rollback
  retained while local mirrors still exist.
- A successful dogfood period should leave behind fixtures for any divergence
  that was found and fixed.
