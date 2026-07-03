# Store-Backed Session Detail Switch Preflight

Topic: session-detail-data-layer

This note supports the tactical plan in
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md).
It records the `useSessionMessages` main-transcript writes that were checked
before the store-backed returned detail path became the default. The Store-
Backed Session Detail switch remains in the Development settings page as a
rollback path to compare against the legacy hook-local mirror.

## Switch Shape

The path started as a narrow toggle and now covers the returned hook data
surfaces that have selector-backed mirrors:

- Scope: returned `messages`, `agentContent`, and tool-use mappings.
- Source: one stable `defaultSessionDetailStore` state snapshot, using
  `state.messages`, `state.agentContent`, and
  `state.toolUseToAgentEntries` together.
- Fallback: local `messages`/`agentContent` state if the store entry is
  missing or the hook has not reached the reveal point.
- Still maintain local mirrors where they support loading reveal, fallback, and
  the Development settings rollback.
- Confidence signal: reducer fixtures, focused hook tests, and browser
  dogfooding. The earlier returned-data invariant diagnostic was removed
  because it compared the returned store-selected data to the same store
  snapshot that produced it.
- Do not include render selectors, scroll ownership, or `/btw` in this toggle.

Turning the switch off does not disable the reducer/store feed. It only returns
the legacy hook-local mirrors instead of the broad store-selected snapshot;
selector-backed adapter reads, diagnostics, cache ownership, and store
retention still run. On normal mounted paths, those mirrors are increasingly
copies of store-selected output, so the switch mainly protects reveal timing,
subscription behavior, object identity, and remaining locally owned refs rather
than providing a fully independent data-semantics rollback.

One important guard remains: warm snapshot restore writes the store before it
reveals local `messages`/`agentContent`, because the hook intentionally yields
through the loading path. The store-backed returned path is still gated until
`loading` is false so the default source change does not bypass the deferred
warm-reveal behavior.

## Main Transcript Transition Audit

| Boundary | Local mirror write | Store path | Preflight status |
| --- | --- | --- | --- |
| No warm snapshot reset | Clears local state while REST starts | Deletes the store entry | Ready with fallback to local empty state |
| Warm snapshot start | Clears local state before deferred reveal | Restores route snapshot immediately | Gated, then copied from selected runtime snapshot |
| Warm catch-up before hydration | Copies selected runtime snapshot after REST delta | `applyCatchupMessages` over restored snapshot | Store-selected reveal after gate |
| Warm catch-up after hydration | Copies selected runtime snapshot after REST delta | `applyCatchupMessages` over restored snapshot | Store-selected reveal after gate |
| Cold persisted load | Copies selected runtime snapshot after REST load | `loadPersistedTranscript` | Store-selected reveal after gate |
| Ordinary stream/replay | Copies selector-backed store result | `applyStreamMessage` | Store-selected after dispatch |
| Main streaming placeholder upsert | Copies selector-backed store result | `upsertStreamingPlaceholder` | Store-selected after dispatch |
| Main streaming placeholder cleanup | Copies selector-backed store result | `clearStreamingPlaceholders` | Store-selected after dispatch |
| Incremental persisted catch-up | Copies selector-backed store result and updates cursor | `applyCatchupMessages` | Store-selected after dispatch |
| Older-page prepend | Copies selector-backed store result and updates cursor | `prependOlderMessages` | Store-selected after dispatch |

## Remaining Risks

- Warm snapshot timing is the main behavioral risk. The store has messages
  earlier than the returned local mirror during deferred loading, and the hook
  intentionally preserves that reveal gate.
- Compaction-tail views need an explicit contract during cutover. Cold
  `loadPersistedTranscript` state is the REST-returned window, even when
  `pagination.totalMessageCount` is larger than the returned row count; older
  page loads and catch-up can then expand that window. A retained full-history
  entry must not silently replace the returned tail window in the UI just
  because the store has more rows. A warm-cache fixture now covers the inverse
  case too: if the retained window was already broader/full and the refresh
  falls back to a compacted tail response, the merged message set keeps
  coherent pagination for the broader window.
- Stream/replay parity depends on provider-specific approximate dedupe. Reducer
  fixtures cover the important Codex shapes, and ordinary stream/replay no
  longer computes local state independently after dispatch.
- Cursor and persisted timestamp watermark side effects stay outside the
  selector read. The store can own the returned array before it owns those refs,
  but tests must keep covering both.
- Subagent `agentContent` live-vs-durable parity remains broad-shape only. The
  dogfood toggle can prove store read ownership for the current shape, but it
  does not make streamed and persisted subagent transcripts semantically
  equivalent.
- Browser dogfood should capture console diagnostics from real navigation:
  keep Store-Backed Session Detail enabled (the default), enable session-detail
  shadow diagnostics, drive `/inbox` to several session detail pages, and record
  `[SessionDetailStore]`, `[SessionDetailShadow]`, React errors, request
  failures, and scroll bottom deltas. Treat store/shadow warnings as fixture
  candidates unless they are scroll-only noise. Treat
  `session-detail-selector-missing-after-dispatch` as an adapter/retention bug.

## Readiness Call

The store-backed returned detail path is now the default, with the Development
settings switch retained as a narrower rollback. The next implementation chunks
should keep narrowing the remaining local mirror state itself: reveal/reset
scaffolding and rollback behavior. Ordinary post-dispatch store-selected paths
now skip local React state writes while the switch is enabled, no-signal
store/local diagnostics have been removed from store-selected adapter paths,
and route-cache persistence reads directly from the store. Scroll ownership and
`/btw` remain out of scope.
