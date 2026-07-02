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

The migration is in the adapter/store phase. We have a tested
`SessionDetailState` reducer and a small keyed external store, but
`useSessionMessages` still returns local React state for the main transcript and
subagent maps.

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
- A dev-only returned-data invariant diagnostic now checks the store-backed
  Developer toggle path itself: once hydration is complete and a store entry
  exists, returned `messages`/`agentContent` should match the store snapshot.
- Same-tab route snapshot retention now sits behind
  `defaultSessionDetailStore`, with TTL, max-entry, byte-cap, retain/release,
  selector subscriptions, and stats.
- Public raw setter escape hatches have been removed for tool-use mappings,
  session metadata, agent content, and messages.
- Narrow selectors are already used for retained scroll, pagination,
  older-page cursor selection, and main streaming placeholder message
  upsert/cleanup.
- `agentContent` has selector-backed mirrors for ordinary subagent stream
  events, loaded subagent content, context-usage updates, and subagent
  streaming placeholder upsert/cleanup; those paths copy the store-selected
  map back into the local hook mirror after reducer/store dispatch.
- A Developer settings debug toggle can now return store-selected `messages`
  and `agentContent` from one coherent store-state snapshot after initial
  hydration has reached the same reveal point as the local mirror. Local mirrors
  still run for fallback and diagnostics.
- Focused hook coverage now verifies that store-authoritative returned
  `messages` preserve selector-only rows across ordinary stream events,
  incremental catch-up, and older-page prepend.
- Focused hook coverage also verifies that store-authoritative returned
  `agentContent` is gated during warm hydration, ignores selector-only entries
  when the toggle is off, and returns selector-only entries when the toggle is
  on.
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
- Keep dogfooding the Developer toggle and turn non-scroll data divergences
  into compact fixtures. Fresh browser checks with the toggle enabled did not
  show catastrophic failures or fresh store divergence. The returned
  data invariant is now the primary signal for the actual UI-consumed data when
  the toggle is enabled.

The key remaining truth is simple: the reducer/store is now a real parallel
data layer, but store-authoritative returned `messages` and `agentContent` are
still dev-only and default-off. The render-selector preflight is complete
enough for cutover planning: `MessageList` still owns stateful UI, callbacks,
scroll, DOM behavior, and JSX, but broad transcript/view shape derivation is no
longer hidden inside the component.

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
- Default user-facing behavior must stay provider-like. Experimental runtime
  changes should be default-off and placed in Developer settings first.

## Migration Shape

The strategy remains shadow-first and adapter-first:

1. Keep the reducer/store fed from existing hook boundaries.
2. Add compact fixtures when diagnostics expose a divergence.
3. Replace one local derivation at a time with a store selector plus fallback.
4. Only after enough parity, offer an experimental store-authoritative mode for
   a larger surface such as returned `messages`.
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
- Continue dogfooding the Developer settings store-authoritative returned
  `messages`/`agentContent` toggle and turn any non-scroll divergence into a
  compact reducer or hook fixture. Treat returned-data invariant warnings as
  higher signal than legacy local-vs-store diagnostics.
- Move the next implementation chunks back to `useSessionMessages`: reduce
  independent local mirror ownership, make store-selected returned detail the
  normal test path behind the Developer toggle, and identify one legacy mirror
  path at a time that can become fallback-only.

Then:

- Keep the toggle dev-only and default-off until dogfooding has produced
  fixtures for any live divergence.
- Do not broaden to scroll ownership or `/btw` until returned `messages` and
  `agentContent` are boring.

Dogfood toggle:

- Name: Store-Backed Session Messages in the Development settings page.
- Current scope: returned `messages` and `agentContent`.
- Behavior today: read store-selected `messages` and `agentContent` from one
  coherent store-state snapshot after hydration, with the local mirrors as
  fallback.
- Keep local mirrors running for comparison, diagnostics, fallback, and
  rollback.
- Do not include render selectors or `/btw` in this toggle.

## Current Risks

- Persisted catch-up and older-page transitions still mix transcript writes
  with cursor/watermark side effects.
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
- Experimental toggles should be default-off and easy to disable.
- A successful dogfood period should leave behind fixtures for any divergence
  that was found and fixed.
