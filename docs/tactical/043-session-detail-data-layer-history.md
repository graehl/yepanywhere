# Session Detail Data Layer History

Topic: session-detail-data-layer

This file holds completed-slice detail moved out of
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md)
so the main plan can stay focused on current direction and rollout decisions.

## Slice 1: Reducer Fixtures

Goal: create a pure transcript reducer test harness without changing runtime
behavior.

Original work outline:

- Define `SessionDetailState` and reducer action types in a client module.
- Start with fields that already exist in `useSessionMessages`: messages,
  session metadata, pagination, agent content, tool-use-to-agent entries,
  persisted timestamp watermark, last durable cursor, pending/deferred rows,
  and scroll snapshot metadata.
- Add conversion helpers from current API/session stream shapes into reducer
  actions.
- Keep the existing hooks as callers/owners while the reducer mirrors current
  transitions.

Status 2026-07-01:

- Added `packages/client/src/lib/sessionDetail/transcriptReducer.ts` and
  `types.ts` with a pure reducer/state shape for persisted transcript loads,
  stream messages, persisted catch-up, pagination prepend, replay suppression,
  and scroll snapshot patches.
- Added reducer fixtures for persisted load, stream-vs-persisted basic-turn
  parity, catch-up replacement of streamed rows, duplicate user prompt
  suppression, distinct same-text user turns, replay suppression, and
  pagination prepend.
- Added `actionAdapters.ts` so tests can feed REST-load, catch-up,
  older-message, and stream-message inputs into the reducer through named
  boundaries that match the eventual hook adapter.
- Added Codex-shaped normalized fixtures for stream plus persisted catch-up
  parity, buffered replay suppression, attachment opening-turn reconciliation,
  and repeated tool calls with distinct call ids.

## Slice 2: Augment Attachment Model

Goal: make augment attachment data-level and testable.

Original work outline:

- Add canonical block/message identity helpers used by both live stream and
  durable reload paths.
- Represent attached augments in reducer state or a sibling data structure
  keyed by canonical identity.
- Keep existing renderers consuming the old prop shape through a compatibility
  selector while internals move.

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

Goal: feed the reducer from current runtime ownership boundaries without
changing what the UI reads.

Original work outline:

- Keep `useSessionMessages` owning `messages`, `session`, `pagination`,
  `agentContent`, route snapshots, and stream buffering.
- Add a reducer state ref inside `useSessionMessages`, so reducer actions do
  not trigger React renders.
- Dispatch reducer actions beside existing mutations for initial REST load,
  warm route snapshot restore, warm-delta/catch-up fetches, stream messages,
  subagent stream messages, tool-use-to-agent mapping, older-page prepend, and
  scroll snapshot patches.
- Add dev-only compact divergence diagnostics that compare reducer state
  against live hook state at those coarse boundaries without logging transcript
  text.

Status 2026-07-02:

- Added `restoreRouteSnapshot`, `applyStreamSubagentMessage`, and
  `registerToolUseAgent` reducer actions with fixture coverage.
- Wired a non-reactive shadow reducer ref into `useSessionMessages`.
- Added opt-in dev diagnostics through
  `yep-anywhere-session-detail-shadow-diagnostics-enabled=true` in
  `localStorage`, or `window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ = true`.
- Diagnostics compare compact summaries at initial load, warm snapshot restore,
  warm catch-up, stream message, subagent stream, tool-use mapping, catch-up,
  older-page, and scroll-snapshot boundaries.
- Diagnostic payloads include ids, message type/role/source, parent ids,
  counts, pagination, agent keys/counts, tool-use mappings, durable cursors,
  and scroll snapshot shape. They intentionally omit transcript text and are
  deduped by boundary plus compact live/shadow hash.
- The shadow reducer still is not the source of truth for returned hook values.

## Slice 3: Subagent Shape And Tree Projection

Goal: make provider parent/tree links and subagent availability inspectable
without promising exact live/reload equivalence for every provider yet.

Current stance:

- Treat subagents as broad shape/provenance coverage until fixtures prove a
  provider can reliably supply equivalent live and durable child transcripts.
- Preserve agent references, tool-use-to-agent mappings, availability state,
  and child-content provenance before attempting a unified child transcript
  normal form.
- Do not assert exact render parity for Codex or newer Claude sidechain
  subagents as an early reducer invariant.

Notable deferred work:

- Model provider parent/tree links in canonical state.
- Represent subagent references and content availability through a reducer-owned
  provenance model.
- Keep live stream content, durable child transcript content, and
  provider-specific activity-only signals distinguishable.

## Slice 4: Session Detail Store Shell

Goal: introduce the explicit store without moving all callers at once.

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
  behavior.
- Fed the store from the same `useSessionMessages` lifecycle boundaries as the
  shadow reducer: warm snapshot restore, persisted load, stream message,
  subagent stream, tool-use mapping, catch-up, older-page, and scroll snapshot.
- Active store entries are deleted on unmount unless transcript snapshot
  retention is enabled.
- Added `selectSessionDetailRuntimeSnapshot`, store `readSelected`, and a
  compact store-vs-live divergence reporter that reuses the shadow diagnostics
  opt-in and redacted payload shape.
- `initialScrollSnapshot`, returned `pagination`, and `loadOlderMessages`
  cursor decisions now read through store selectors with local fallback.
- Removed public raw setter escape hatches from `UseSessionMessagesResult`:
  `setToolUseToAgent`, `setSession`, `setAgentContent`, and `setMessages`.
- Routed pending-task mapping reloads through `registerToolUseAgent`.
- Routed pending-agent reload hydration and renderer lazy-load content through
  `mergeLoadedAgentContent`.
- Routed agent context usage through `updateAgentContextUsage`.
- Routed subagent final-assistant cleanup through
  `clearAgentStreamingPlaceholders`.
- Routed throttled streaming placeholder updates through
  `upsertStreamingPlaceholder`.
- Routed main final-assistant cleanup through `clearStreamingPlaceholders`.
- Routed metadata-only session patches through `setSessionMetadata` and the
  public `updateSession` wrapper.
- Added `selectSessionDetailMessages` and used it as the first store-backed
  message mirror for main streaming placeholder upsert/cleanup.
- Added `selectSessionDetailAgentContent` and used it as the first
  store-backed `agentContent` mirror for subagent streaming placeholder
  upsert/cleanup.
- Ordinary subagent stream events now also copy the store-selected
  `agentContent` map back into the local hook mirror after reducer/store
  dispatch, with coverage for preserving selector-only task entries.
- Loaded subagent content and agent context-usage updates now follow the same
  selector-backed mirror pattern, with coverage for preserving selector-only
  task entries.
- Added the store-backed messages toggle preflight note and hook/store parity
  assertions for warm catch-up, incremental catch-up, and older-page prepend.
- Added the store-authoritative returned `messages` dogfood toggle to the
  Development settings page, with warm hydration gating and focused hook
  coverage for the gate plus store-selected message updates.
- Extended the same dev-only dogfood toggle to returned `agentContent`, with
  the same warm hydration gating, local fallback, and coverage for enabled,
  disabled, and warm-cache behavior.

Reducer/helper behavior locked down during Slice 4:

- Loaded JSONL rows are canonical for duplicate lazy-loaded subagent message
  ids.
- Live-only SSE rows are appended to loaded subagent content.
- A live subagent `running` status is preserved when lazy-loaded content says
  the durable file is completed.
- Main streaming placeholder upsert/cleanup now copies the store-selected
  transcript into the local hook mirror after reducer/store dispatch, with the
  old local helper retained as fallback.
- Subagent streaming placeholder upsert/cleanup now copies the store-selected
  agent-content map into the local hook mirror after reducer/store dispatch,
  with the old local helper retained as fallback.
- Ordinary subagent stream, loaded subagent content, and context-usage updates
  now use the same store-selected agent-content mirror with local helpers kept
  as fallback.
- Returned `agentContent` can now be store-selected behind the Developer
  setting without bypassing the warm snapshot deferred reveal path.
- The first render-selector preflight moved render item projection into
  `sessionDetail/renderSelectors`: preprocessing, transcript display-object
  insertion, stable render item reuse, and turn grouping. `MessageList` still
  owns DOM-local display policy, search state, progressive reveal, and scroll.
- The next render-selector preflight moved user-turn navigation anchors and
  user/all-turn search anchor derivation into `sessionDetail/renderSelectors`.
  At that point, `MessageList` still owned full-session explored search
  assembly, DOM
  navigation, search state, progressive reveal, and scroll.
- Full-session search anchor derivation followed: assistant render segments,
  explored tool-run aggregate anchors, explored child anchors, and latest
  render-item timestamp selection now live in `sessionDetail/renderSelectors`.
  `ExploredToolGroup` still owns the React rendering and interactive summary
  behavior for those segment items.
- Search-driven visible turn-group filtering now also lives in
  `sessionDetail/renderSelectors`, preserving the existing behavior where a
  matching user turn keeps its assistant response visible and full-session
  explored child matches target the explored group.
- Search match projection now lives in `sessionDetail/renderSelectors`,
  including match ids, target ids, preview snippets, and selected-anchor
  lookup. Match projection is kept separate from selected-anchor projection so
  changing the selected id does not churn the match array and reset arrow-repeat
  timers.
- Latest correctable prompt selection now lives in
  `sessionDetail/renderSelectors`, reusing selector-owned prompt parsing and
  setup/subagent filtering while `MessageList` keeps the correction action
  wiring.
- Visible timeline entry derivation now lives in
  `sessionDetail/renderSelectors`, combining visible turn groups with `/btw`
  aside metadata and preserving the existing timestamp/ordinal ordering rules
  while `MessageList` keeps `/btw` ownership, progressive reveal, rendering,
  and scroll.
- Progressive timeline entry weighting plus initial/reveal-batch count
  derivation now live in `sessionDetail/renderSelectors`, preserving the
  existing render-item target behavior while `MessageList` keeps reveal state,
  timers, status UI, slicing, rendering, and scroll.
- Progressive timeline visibility projection now lives in
  `sessionDetail/renderSelectors`, deriving effective entry count, tail-sliced
  entries, and progress percent while `MessageList` keeps reveal state, timers,
  status UI, rendering, and scroll.
- Thinking duration derivation now lives in
  `sessionDetail/renderSelectors`, preserving the existing start/end timestamp
  rules while `MessageList` keeps thinking visibility, expansion state, and
  rendering local.
- Thinking count and latest-thinking-id derivation now live in
  `sessionDetail/renderSelectors`, preserving the latest-only expansion input
  while `MessageList` keeps thinking visibility, expansion state, and rendering
  local.
- Display render item filtering now lives in `sessionDetail/renderSelectors`,
  preserving the local thinking visibility flag as input while `MessageList`
  keeps thinking visibility, expansion state, and rendering local.
- Thinking id and text-length summaries now live in
  `sessionDetail/renderSelectors`, preserving the inputs for the local
  expansion/follow effects while keeping their state mutations in
  `MessageList`.
- Visible thinking text-delta detection now lives in
  `sessionDetail/renderSelectors`, preserving the local expansion predicate and
  leaving follow/scroll effects in `MessageList`.
- Auto-expanded thinking-id reconciliation now lives in
  `sessionDetail/renderSelectors`, preserving `MessageList` ownership of the
  state update and provider historical-seed trigger.
- Latest visible timestamp derivation now lives in
  `sessionDetail/renderSelectors`, combining render items, pending sends,
  deferred sends, project queue rows, and `/btw` asides while `MessageList`
  keeps age rendering and row ownership.
- Transcript-position timestamp helper primitives now live in
  `sessionDetail/renderSelectors`: last timestamped render-item lookup and the
  visible-turn ending predicate. `MessageList` still owns DOM row measurement
  and scroll sampling.
- Composer tail ordering and deferred queue lane position derivation now live
  in `sessionDetail/renderSelectors`, preserving pending/deferred/project-queue
  ordering and patient-vs-regular deferred lane positions while `MessageList`
  keeps row rendering, labels, actions, and attachment display.
- Direction note: existing `scroll-snapshot` shadow divergence logs are treated
  as known noisy signal from the older snapshot path. Do not chase them as a
  near-term migration blocker until the non-scroll store/render surfaces are
  otherwise complete enough for a cleaner cutover audit.

## Verification Details

Provider fixtures currently cover or are intended to cover:

- Claude: parent/tree, compaction, task/subagent rows, SDK stream vs JSONL.
- Codex: replay/catch-up dedupe, subagent rollout, thinking/summary blocks,
  provider id drift.
- OpenCode/Grok/Pi: provider-normalized tool/result rows where durable and live
  shape can differ.

Behavioral fixtures currently cover or are intended to cover:

- duplicate user prompt suppression;
- duplicate assistant message suppression;
- streamed assistant response committed to durable row;
- augment target before/after arrival;
- lazy subagent load after parent render;
- cache restore followed by catch-up fetch;
- pagination prepend;
- compaction boundary plus loaded tail;
- render id stability across reload and linger reveal.
