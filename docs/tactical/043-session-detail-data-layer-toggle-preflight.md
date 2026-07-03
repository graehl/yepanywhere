# Store-Backed Session Detail Cutover Preflight

Topic: session-detail-data-layer

This note supports the tactical plan in
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md).
It records the `useSessionMessages` main-transcript writes that were checked
before the store-backed returned detail path became the only returned
transcript path. The Store-Backed Session Detail Development switch was removed
after the off path stopped providing an independent data-semantics rollback.

## Cutover Shape

The path started as a narrow toggle and now unconditionally covers the returned
hook data surfaces that have selector-backed mirrors:

- Scope: returned `messages`, `agentContent`, and tool-use mappings.
- Source: one stable `defaultSessionDetailStore` state snapshot, using
  `state.messages`, `state.agentContent`, and
  `state.toolUseToAgentEntries` together.
- Fallback: local `messages`/`agentContent` refs only after the current route
  has reached the reveal point and the store entry is unexpectedly missing.
- Before reveal: explicit empty returned transcript surfaces, keyed by the
  current route snapshot key, rather than cleared local mirrors.
- Still maintain refs where they support temporary fallback.
- Confidence signal: reducer fixtures, focused hook tests, and browser
  dogfooding. The earlier returned-data invariant diagnostic was removed
  because it compared the returned store-selected data to the same store
  snapshot that produced it.
- Do not include render selectors, scroll ownership, or `/btw` in this cutover.

The removed switch used to return legacy hook-local mirrors while the
reducer/store feed, selector-backed adapter reads, diagnostics, cache ownership,
and store retention still ran. On normal mounted paths, those mirrors had become
copies of store-selected output, so the switch mostly protected reveal timing,
subscription behavior, object identity, and remaining locally owned refs rather
than providing a fully independent data-semantics rollback.

One important guard remains: warm snapshot restore writes the store before it
reveals `messages`/`agentContent`, because the hook intentionally yields
through the loading path. Reveal updates refs plus local session/pagination
state but skips React state writes for returned store-backed surfaces. The
returned transcript path is gated on the current route's reveal key and
`loading === false`, so the store-backed return path does not bypass the
deferred warm-reveal behavior or expose stale fallback refs on route changes.

## Main Transcript Transition Audit

| Boundary | Local mirror write | Store path | Preflight status |
| --- | --- | --- | --- |
| No warm snapshot reset | Leaves transcript mirrors intact while reveal gate returns empty | Deletes the store entry | Ready with explicit empty returned state |
| Warm snapshot start | Leaves transcript mirrors intact before deferred reveal | Restores route snapshot immediately | Gated, then selected runtime snapshot reveals without local state writes while enabled |
| Warm catch-up before hydration | Ref-only mirror while enabled after REST delta | `applyCatchupMessages` over restored snapshot | Store-selected reveal after gate |
| Warm catch-up after hydration | Ref-only mirror while enabled after REST delta | `applyCatchupMessages` over restored snapshot | Store-selected reveal after gate |
| Cold persisted load | Ref-only mirror while enabled after REST load | `loadPersistedTranscript` | Store-selected reveal after gate |
| Ordinary stream/replay | Copies selector-backed store result | `applyStreamMessage` | Store-selected after dispatch |
| Main streaming placeholder upsert | Copies selector-backed store result | `upsertStreamingPlaceholder` | Store-selected after dispatch |
| Main streaming placeholder cleanup | Copies selector-backed store result | `clearStreamingPlaceholders` | Store-selected after dispatch |
| Incremental persisted catch-up | Copies selector-backed store result and updates cursor | `applyCatchupMessages` | Store-selected after dispatch |
| Older-page prepend | Copies selector-backed store result and updates cursor | `prependOlderMessages` | Store-selected after dispatch |

## Remaining Risks

- Warm snapshot timing is the main behavioral risk. The store has messages
  earlier than the returned transcript surfaces during deferred loading, and the
  hook intentionally preserves that reveal gate.
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
  store-backed returned path proves store read ownership for the current shape,
  but it does not make streamed and persisted subagent transcripts semantically
  equivalent.
- Browser dogfood should capture console diagnostics from real navigation:
  enable session-detail shadow diagnostics, drive `/inbox` to several session
  detail pages, and record
  `[SessionDetailStore]`, `[SessionDetailShadow]`, React errors, request
  failures, and scroll bottom deltas. Treat store/shadow warnings as fixture
  candidates unless they are scroll-only noise. Treat
  `session-detail-selector-missing-after-dispatch` as an adapter/retention bug.

## Readiness Call

The store-backed returned detail path is now the only path for returned
`messages`, `agentContent`, and tool-use mappings. The next implementation
chunks should keep narrowing the remaining local mirror/ref state itself:
fallback ownership first. Ordinary post-dispatch store-selected paths now skip
local React state writes, reveal follows the same rule for returned store-backed
surfaces, reset/loading uses an explicit returned-detail gate instead of
clearing transcript mirrors, no-signal store/local diagnostics have been
removed from store-selected adapter paths, and route-cache persistence reads
directly from the store. Scroll ownership and `/btw` remain out of scope.
