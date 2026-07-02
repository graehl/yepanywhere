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
- `useSessionMessages` feeds a shadow reducer and the session detail store at
  existing load, stream, catch-up, pagination, mapping, subagent, metadata, and
  scroll-snapshot boundaries.
- Dev-only diagnostics can compare live hook state against the shadow reducer
  and store without logging transcript text.
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
  and `agentContent` after initial hydration has reached the same reveal point
  as the local mirror. Local mirrors still run for fallback and diagnostics.
- Focused hook coverage now verifies that store-authoritative returned
  `messages` preserve selector-only rows across ordinary stream events,
  incremental catch-up, and older-page prepend.
- Focused hook coverage also verifies that store-authoritative returned
  `agentContent` is gated during warm hydration, ignores selector-only entries
  when the toggle is off, and returns selector-only entries when the toggle is
  on.
- Render-item projection has its first selector boundary: preprocessing,
  transcript display-object insertion, stable item reuse, and turn grouping now
  live in `sessionDetail/renderSelectors`.
- User-turn navigation anchors plus user/all-turn search anchors now derive
  from render items through `sessionDetail/renderSelectors`.
- Assistant render segments and full-session search anchors, including
  explored tool-run aggregate and child anchors, now derive through
  `sessionDetail/renderSelectors`.
- Search-driven visible turn-group filtering now derives through
  `sessionDetail/renderSelectors`.
- Search match and selected-anchor projection now derive through
  `sessionDetail/renderSelectors`.
- Latest correctable prompt selection now derives through
  `sessionDetail/renderSelectors`.
- Visible timeline entry derivation now derives through
  `sessionDetail/renderSelectors`, including timestamp ordering for visible
  turn groups plus `/btw` aside metadata.
- Progressive timeline entry weighting and render-item target count derivation
  now derive through `sessionDetail/renderSelectors`.
- Progressive timeline visibility projection now derives through
  `sessionDetail/renderSelectors`, including effective entry count, sliced
  entries, and progress percent.
- Thinking duration derivation now derives through
  `sessionDetail/renderSelectors`.
- Thinking count and latest-thinking-id derivation now derive through
  `sessionDetail/renderSelectors`.
- Display render item filtering now derives through
  `sessionDetail/renderSelectors`, using render items plus the local thinking
  visibility flag.
- Thinking id and text-length summaries now derive through
  `sessionDetail/renderSelectors` for the local expansion/follow effects.
- Visible thinking text-delta detection now derives through
  `sessionDetail/renderSelectors`, using the summary maps plus the local
  expansion predicate.
- Auto-expanded thinking-id reconciliation now derives through
  `sessionDetail/renderSelectors`, using previous, observed, and current id
  sets plus the historical-seed flag.
- Latest visible timestamp derivation, last timestamped render-item selection,
  visible-turn ending rules, composer tail ordering, and deferred queue lane
  positions now derive through `sessionDetail/renderSelectors`.
- Composer tail row metadata now derives through
  `sessionDetail/renderSelectors`, including parsed row timestamps, stale-age
  visibility, recovered/patient deferred flags, recovered queue ids, project
  queue status kind, and attachment-count badge visibility.
- Assistant timeline row metadata now derives through
  `sessionDetail/renderSelectors`, including explored-tool segment timestamps,
  stale-now hints, render-item indexes, and thinking durations.
- Timeline entry display row metadata now derives through
  `sessionDetail/renderSelectors`, including `/btw`, empty, standalone, user,
  and assistant row classification plus user-prompt action eligibility,
  latest-correctable flags, row keys, stale-now hints, and assistant timeline
  row metadata for assistant entries.
- Assistant timeline item action eligibility now derives through
  `sessionDetail/renderSelectors`, including thinking toggle, quote, and
  user-prompt trim/fork eligibility while callbacks remain local.
- Search readiness, active search anchor selection, search panel labels/counts,
  searchable-user-turn detection, and navigator search-state projection now
  derive through `sessionDetail/renderSelectors`.

Current diagnostic stance:

- Treat `scroll-snapshot` shadow/store divergence logs as known noisy signal
  from the older snapshot path. Do not spend migration time chasing those until
  returned `messages`/`agentContent` and render-selector parity are otherwise
  boring enough for a cleaner cutover audit.
- Keep dogfooding the Developer toggle and turn non-scroll data divergences
  into compact fixtures. Fresh browser checks with the toggle enabled did not
  show catastrophic failures or fresh store/shadow divergence.

The key remaining truth is simple: the reducer/store is now a real parallel
data layer, but store-authoritative returned `messages` and `agentContent` are
still dev-only and default-off. Render-item derivation has a pure selector
preflight, but `MessageList` still owns display policy, search navigation
state, and DOM behavior.

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
migration should keep replacing local derivations with selector-backed reads in
narrow slices.

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

- Continue dogfooding the Developer settings store-authoritative returned
  `messages`/`agentContent` toggle and turn any observed divergence into a
  compact reducer or hook fixture, except for known `scroll-snapshot` noise.
- Continue the render-selector preflight with small pure projection moves that
  do not own DOM measurement or effects. Good candidates are search/navigation
  metadata helpers or remaining row metadata helpers. Keep scroll snapshots,
  follow-tail behavior, and `/btw` ownership local for now.

Then:

- Keep the toggle dev-only and default-off until dogfooding has produced
  fixtures for any live divergence.
- Do not broaden to scroll ownership or `/btw` until returned `messages` and
  `agentContent` are boring.

Dogfood toggle:

- Name: Store-Backed Session Messages in the Development settings page.
- Current scope: returned `messages` and `agentContent`.
- Behavior today: read store-selected `messages` and `agentContent` after
  hydration, with the local mirrors as fallback.
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
