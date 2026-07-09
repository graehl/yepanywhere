# Memory-growth notes

## Browser-tab lifetime memory

- Long-session pages must not do whole-transcript React work on idle timers.
  Relative-age labels are useful UI, but historical rows should not receive a
  changing clock prop every tick. The only transcript row that needs a live
  stale-age clock by default is the latest visible timestamp row; older row
  age labels can stay at their mount-time relative age until some real session
  data changes.
- Compact-tail REST loading is part of the memory contract for Codex sessions:
  normal session-page loads should request a bounded recent tail such as the
  last two compaction windows. Full direct session REST payloads can be tens of
  megabytes and thousands of normalized renderable messages, so they are
  diagnostic/debug surfaces rather than the default browser transcript load.
- Compact-boundary tails are not by themselves a sufficient browser bound for
  Claude sessions with sparse compaction. Normal client session loads also send
  a conservative recent-turn cap, currently `tailTurns=20`, unless the URL
  explicitly chooses `tailTurns` or `tailFrom`. This keeps a session with one
  old compaction from rendering nearly the whole transcript by default while
  preserving explicit URL opt-in for stronger or different transcript windows.
- Custom aggressive transcript truncation remains URL opt-in, not a hidden
  recut on every refresh. `tailTurns=<n>` and `tailFrom=<message-id>` bound
  only the initial non-incremental session detail response; streaming and
  `afterMessageId` refreshes must append normally so the loaded tail can grow
  without repeated recutting.
- The old in-tab session-load cache was a developer convenience only:
  `VITE_SESSION_LOAD_CACHE=true` retained every visited transcript without
  production eviction or source/query invalidation. It proved the warm-return
  shape but was not the product path.
- Production session route retention uses explicit `SessionRouteSnapshot`
  entries instead: source-scoped, route/tail-window keyed, five-minute TTL,
  three-entry default cap, 24 MiB total byte cap, least-recently-used eviction,
  retained delta cursor, and retained scroll anchor. It is meant to work in
  development, production builds, and hosted/relay clients.
- Growth attribution is sampled, not reconstructed: when client log
  collection is active, `[ClientTelemetry]` entries (15 s cadence) carry JS
  heap size, DOM/row counts, and the session-detail store's deduped
  live-retained vs warm-cache byte aggregates
  (`getSessionTranscriptMemoryStats`, also shown in Performance settings).
  A multi-day tab that balloons should be explained from those samples
  before anyone reaches for a live heap snapshot.
- Any future client-side transcript cache beyond `SessionRouteSnapshot` needs
  an explicit design note before it ships: what user-visible behavior it
  changes, what data it retains, its eviction policy, memory/entry limits,
  low-memory mobile behavior, invalidation and staleness rules, and why those
  trade-offs are acceptable. Ad hoc transcript caching must not be enabled by
  default.

## 2026-07-09: real cause of the "10 GB tab" — un-virtualized transcript re-rendered every second

The `tailTurns=20` default (above) is a **mitigation, not the fix**. Measured
root cause of the browser-tab RSS growth:

- **It is not a JS/DOM leak.** On an idle session page, `usedJSHeapSize`, DOM
  node count, and JS listener count are flat over minutes. Heap-snapshot leak
  hunts correctly find nothing — the growth is native (Blink style/layout/paint
  objects, allocator high-water), which `usedJSHeapSize` does not count. That is
  why a tab reaches many GB while the V8 heap stays flat. Prior "there is no
  leak" conclusions were right *about the heap* and stopped one step short.
- **The transcript is not virtualized.** `MessageList` renders every message as
  a live DOM subtree (`MessageList.tsx`, `timelineEntryRows.map`). Native memory
  scales with total content (nodes, layout objects, raster), not viewport.
- **The whole transcript re-renders ~once per second, even when idle.** Measured
  headless (Playwright + CDP `Performance.getMetrics`/`Profiler`) against the
  live dev server, session `858312bb-…` idle (WebSocket messages = 0, rAF ≈ 0):

  | tail | rows | DOM nodes | JS heap | idle CPU-busy |
  |------|------|-----------|---------|---------------|
  | 20   | 244  | 12,985    | flat 65 MB  | 11% |
  | 400  | 1145 | 58,509    | flat 117 MB | 22% |

  Idle CPU scales with row count. The CPU profile shows `MessageAge` /
  `RenderItemComponent` / `jsxDEV` / React reconciliation hot, scheduled from
  microtask state flushes (not streaming). Two independent 5 s profiles (shorter
  than the 30 s clock) still show row rendering ⇒ rows re-render ~every second.
- **Trigger:** ~9 `setInterval(…, 1000)` timers on the session page (drafts,
  file-activity, reload-notify, liveness, …) re-render SessionPage every second.
  `MessageList` is `memo`-wrapped, but its memo is defeated by unstable
  inline-callback props from SessionPage — `getComposerDraft`
  (`SessionPage.tsx:4544`), `onCancelForkSummary` (`:4580`),
  `onToggleForkSummaryAutoOpen` (`:4583`) — so it re-executes and re-creates /
  reconciles all N row elements every second (the `jsxDEV` cost). Session-level
  clocks broadcast as per-row props (`staleNowMs`, `latestVisibleTimestampMs`,
  `isStreaming`) plus conditional inline arrows in the row map (`MessageList.tsx`
  ~2341/2348/2353) additionally break row-level `memo`.

So per-second O(N) style-recalc + layout + reconcile (recalcStyle counters climb
continuously on an idle page) churns native memory with a flat JS heap.
`tailTurns=20` only shrinks N; it does not stop the per-second O(N) churn or
bound the DOM. Streaming compounds it: each new message re-renders all N rows
while the transcript keeps growing.

Fix is staged — see [`transcript-virtualization.md`](transcript-virtualization.md):
(1) stabilize the memo-breaking props and decouple per-row clocks so an idle
transcript does ~zero work; (2) virtualize/window the transcript so DOM size and
per-tick work are bounded by viewport, not history.

Open item for the implementer: after (1), re-measure idle CPU with the probe in
that plan. If rows still re-render every second, a broadcast prop *value*
(`isStreaming`, or a liveness-derived value) is still changing each tick — trace
it before assuming (1) is complete.

### 2026-07-09 follow-up: the residual idle re-render was context, not clocks

Answering the open item above with direct measurement (temporary
`window.__mlRender` / `window.__riRender` render counters + CDP profile +
DOM-mutation observer, on the same full-transcript idle page):

- **`MessageList` re-renders ~0.1/s** on idle — item 1's `memo` holds. It is
  *not* re-rendering every second.
- **`RenderItemComponent` re-renders are a one-shot settling burst**, not steady
  churn: the same count over a 10 s and a 30 s idle window.
- The re-render that *did* persist was **context-driven**: `AgentContentContext`
  built a fresh `value` object every provider render. The provider re-renders on
  each SessionPage status-timer tick (~1/s), so the context value changed every
  second and re-rendered every subagent consumer (`TaskRenderer`,
  `SpawnAgentRenderer`, nested rows) — context propagation goes *through* `memo`,
  which is why item 1's prop stabilization did not stop it. The CPU-profile
  hotspots (`propagateParentContextChanges`, `formatAbsoluteTimestamp`,
  `jsxDEV`) drop after wrapping that value in `useMemo`.
- After the fix, the idle transcript DOM is essentially static (~1 mutation/s,
  only the processing indicator). No steady DOM growth, no leak — confirming the
  original "flat heap" reading was right; the cost was wasted render-phase work,
  now removed at its source.

Consequence for the plan: `transcript-virtualization.md` Stage 1 items 2–3
(row-map inline arrows; per-row clock decoupling) are **moot**, not merely
deferred — the churn they target does not occur once the context value is
memoized. The per-row clock was already gated in code
(`getRenderItemStaleNowMs` returns `undefined` for non-latest rows).

Measurement caveat: the shared dev server's load/highlight timing is noisy. A
fixed post-load settle sometimes catches load-time shiki re-highlight (bursts of
`fixed-font-rendered__content` / `shiki-container` child-list mutations that
*do* settle). Trust only quiescence-gated samples — poll the transcript
DOM-mutation rate and measure only once it falls below a small threshold.

## 2026-05-12: heartbeat session `019e1ac6-c836-7e33-891e-2ba878d27ca5`

- Confirmed metadata persisted for `019e1ac6-c836-7e33-891e-2ba878d27ca5` includes:
  - `heartbeatTurnsEnabled: true`
  - `heartbeatTurnsAfterMinutes: 30`
  - `heartbeatForceAfterMinutes: 5`
  - provider `codex`.
- `session-metadata.json` is authoritative at `~/.yep-anywhere/session-metadata.json`.

## Heartbeat pipeline checkpoints that could block delivery

- For owned processes, supervisor checks:
  - heartbeat enabled for session,
  - `process.isTerminated === false`,
  - `process.queueDepth === 0`,
  - `process.isProcessAlive === true`,
  - state/derived status is either `idle` + `verified-idle` OR `in-turn` +
    one of `verified-progressing`, `recently-active-unverified`,
    `long-silent-unverified`.
- For unowned candidates, it additionally requires `hasPendingToolCall === true`,
  candidate provider supports steering, and metadata flag enabled.
- No explicit heartbeat text is sent if any of the above are false.

## Current observed evidence

- Search across `~/.yep-anywhere` did not find any
  `heartbeat_turn_queued`/`heartbeat_turn_failed` entries containing the session.
- No session-specific heartbeat trace exists in local persisted JSONL logs.
- `recents.json` shows this session was visited at `2026-05-12T14:56:52.826Z`.
- Index metadata (`~/.yep-anywhere/indexes/...json`) shows it is the most
  recently updated `tend` session and near context/window limits (~93% usage),
  but this does not itself indicate heartbeat state.

## Likely next checks

- At runtime, inspect the live process object for this session:
  `getProcessForSession(sessionId)` state fields (`isProcessAlive`, `queueDepth`,
  derived liveness) at heartbeat tick.
- Confirm heartbeat scheduler is actually running and logger sink captures
  `heartbeat_turn_*` events in the server runtime you are attached to.
