# Transcript Virtualization

> Bound the session transcript's browser cost — DOM size and per-tick
> render/style/layout work — to the viewport rather than to total session
> length, so a long or streaming session cannot grow native browser memory
> without limit.

See also:
- [`memory-growth.md`](memory-growth.md) — the measured root cause this plan
  fixes (§ *2026-07-09: real cause of the "10 GB tab"*): a non-virtualized
  transcript re-rendered every second, native RSS climbing with a flat V8 heap.
- [`client-route-retention.md`](client-route-retention.md) — bounded in-tab
  snapshot retention; virtualization is orthogonal (bounds a single live view;
  retention bounds cross-route caching).
- [`../packages/client/RENDERING_PERFORMANCE.md`](../packages/client/RENDERING_PERFORMANCE.md)
  — render pipeline and the "rich formatters see one block, not the transcript"
  invariants virtualization must preserve.

Topic: transcript-virtualization

Status: 2026-07-09. Stage 1 item 1 landed (stabilize MessageList's callback
props): idle CPU ~22% → ~9%, per-second O(rows) re-render gone. Stage 2 landed
via `content-visibility: auto` on `.message-render-row`: laid-out render tree
bounded to the viewport — **layout objects ~70,100 → ~2,750 at 1532 rows (25×)**,
RSS lower, with no functional regressions (turn-rail markers, click-to-jump,
scroll-to-bottom, and hover affordances all verified; no paint-containment
clipping). Tradeoff: idle *style-recalc* roughly doubled (~217 → ~710 per 12 s),
because the still-present per-second widget layouts now also re-evaluate
content-visibility state, pushing idle CPU ~9% → ~16% on the full transcript.
That amplification **re-prioritizes Stage 1 items 2–3** (stop the per-second
layouts). Stage 1 items 2–3 and the JS-windowing fallback remain not-done — see
below for why.

## Problem (one line)

`MessageList` mounts every message as live DOM and re-renders the whole list
~once per second even when idle, so both DOM footprint and per-tick main-thread
work are O(transcript length). Native browser memory (Blink style/layout/paint,
allocator high-water) grows over hours to many GB while the V8 heap stays flat.
Full measurement and evidence: `memory-growth.md`.

## Measurement harness (reproduce before and after each stage)

Headless Chromium against a running server, loading the full transcript via
`?tailTurns=100000`, sampling on an **idle** page (no interaction, no
streaming). The signal is not heap size — it is **idle CPU-busy and
`RecalcStyleCount`/`LayoutCount` deltas that scale with row count**, plus
process-tree RSS trend. Key CDP calls:

- `Performance.getMetrics` → `RecalcStyleCount`, `LayoutCount`, `LayoutObjects`,
  `Nodes`, `JSEventListeners`, `ScriptDuration`, `TaskDuration` (diff two reads
  over an idle window; `TaskDuration/window` ≈ CPU-busy fraction).
- `Profiler.start/stop` → confirm `MessageAge`/`RenderItemComponent`/`jsxDEV`
  appear on an idle page (they must not, once fixed).
- `HeapProfiler.collectGarbage` before DOM-counter reads so counts are retained,
  not garbage.

Acceptance: idle full-transcript page should sit at ~0% CPU with no periodic
row rendering; RSS should plateau, not trend up, over a multi-minute idle hold.
(Baseline before fix: 22% idle CPU at 1145 rows; target: ≪1%.)

## Stage 1 — stop the per-second whole-transcript re-render (low risk)

Cheap, behavior-preserving. Do these, then re-measure:

1. **Stabilize `MessageList`'s props** so its `memo` actually holds across a
   SessionPage per-second re-render. Confirmed unstable inline arrows:
   `getComposerDraft` (`SessionPage.tsx:4544`), `onCancelForkSummary` (`:4580`),
   `onToggleForkSummaryAutoOpen` (`:4583`). Wrap in `useCallback` (the functions
   they call — `cancelForkSummaryJob`, `setForkSummaryAutoOpen` — are already
   stable; `getComposerDraft` reads a ref, deps `[]`). Audit the remaining
   `MessageList` props for any other per-render-fresh value; the memo only holds
   if *all* props are stable.
2. **[DEFERRED 2026-07-09] Stabilize the row-map inline arrows** in `MessageList`
   (~lines 2341, 2348, 2353): the conditional `() => onTrimBeforeUserMessage(
   item.id)` etc. Prefer passing the stable handler plus `item.id` and letting
   the row bind, or a per-item memoized callback map, so historical rows keep
   referential prop stability.
3. **[DEFERRED 2026-07-09] Decouple per-row clocks.** `staleNowMs` and
   `latestVisibleTimestampMs` are broadcast to every `RenderItemComponent`; only
   the latest-visible row needs a live clock. Give just that row the clock (or a
   tiny dedicated subscriber component) so a `nowMs` tick re-renders one row, not
   N.
4. Re-measure. If idle rows still re-render, a broadcast prop *value* is still
   changing each second (suspect `isStreaming` or a liveness-derived value from
   `useSession`); trace and gate it.

**Why 2–3 are deferred, not dropped:** after item 1, measured idle layout
passes fell to ~0.5/s and idle CPU to ~9% at 1480 rows — i.e. the *per-second,
O(rows)* transcript churn (the growth engine) is already gone. The residual ~9%
is small timer-driven widgets (processing indicator, connection bar, age chips)
doing style-only invalidation that does **not** scale with transcript length, so
2–3 are diminishing returns for the memory goal. They remain worth doing for
overall idle-CPU hygiene (target ≪1%) and to make row memoization robust before
Stage 2 leans on it; do them opportunistically or if profiling still shows row
renders after Stage 2. Not doing them does not block Stage 2.

Stage 1 does not bound the DOM — a very long session is still a large static
DOM — but it removes the per-second O(N) churn, which is the growth engine.

## Stage 2 — bound rendered cost to the viewport

Goal: a very long transcript should cost the browser (Blink style/layout/paint/
raster memory, and any per-tick layout) only for what's near the viewport, not
for the whole history.

### Chosen mechanism: `content-visibility: auto` first (2026-07-09)

Decision: realize Stage 2 first with CSS `content-visibility: auto` on transcript
rows (plus `contain-intrinsic-size: auto <estimate>`), **not** JS row unmounting.
Rationale — the hard part of JS windowing is that every coupling below assumes
rows stay in the DOM; `content-visibility: auto` keeps the DOM intact and only
tells the browser to skip rendering work (and discard rendered state) for
off-screen subtrees. So it bounds the native-memory / layout cost — the actual
defect — while the turn rail's rect reads, in-transcript search `scrollIntoView`,
selection/comment anchors, and native find-in-page keep working unchanged. It is
~a few lines of CSS versus a large, risky refactor, and it is behavior-preserving
(so it can default on). `contain-intrinsic-size: auto Xpx` gives off-screen rows a
placeholder height and remembers the real size after first render, keeping the
scrollbar stable.

Landed 2026-07-09 (`.message-render-row` in `index.css`). Measured at 1532 rows:
layout objects ~70,100 → ~2,750, RSS ~970 → ~820 MB, DOM node count unchanged.
Verified couplings held: turn-rail markers stay distributed and click-to-jump
scrolls correctly (rail reads still work because the DOM is intact), initial
scroll-to-bottom works, and paint containment did **not** clip the age chip or
hover quote circles.

Measured tradeoff: idle style-recalc roughly doubled (content-visibility state is
re-evaluated on each of the ~7.5 per-second widget-driven layouts), so idle CPU
on the full transcript rose ~9% → ~16%. This is amplification of the residual
per-second widget churn, not new work of its own — Stage 1 items 2–3 (stop those
per-second layouts) remove both the residual and this amplification, so they are
the natural next step. `contain-intrinsic-size: auto 120px` (auto remembers real
heights) measured the same idle cost as a fixed size but gives better scroll
stability, so it is the shipped form.

Residual risk still to watch in real use (not a headless-provable): scroll-
position drift as far-off-screen intrinsic estimates correct to real heights on
first scroll-through; `auto` minimizes it. If it janks in practice, add height-
model marker placement (below) rather than reaching for full unmounting.

Fall back to JS row unmounting (the design below) only if `content-visibility`
proves insufficient (memory still unbounded) or its scroll/turn-rail behavior
can't be made acceptable. Not needed as of this landing.

### Fallback design: JS windowed rendering

Render only rows near the viewport (plus a small overscan); replace off-screen
runs with spacer elements sized from measured/estimated row heights. Bounds both
DOM size and per-tick work to the viewport.

This is not a drop-in list virtualizer — it must integrate with existing
transcript machinery. Known couplings to solve (each currently assumes all rows
are in the DOM):

- **Variable row heights.** Text/tool/code/thinking rows differ widely and
  reflow (ResizeObserver in `TextBlock`, media previews, code highlight). Need a
  measured-height cache keyed by stable row id, with estimate-then-correct so the
  scrollbar and anchoring don't jump.
- **Scroll anchoring / follow-bottom.** `MessageList` already has substantial
  anchor/follow/snapshot logic (rect reads, `isAtScrollBottom`, scroll snapshot
  publish). Virtualization changes what "scrollHeight" means; anchoring must be
  driven by the height model, not by rects of rows that may be unmounted.
- **Turn rail (`UserTurnNavigator`).** It computes marker positions by calling
  `getBoundingClientRect` on every user-turn row (`UserTurnNavigator.tsx` ~519).
  Off-screen rows won't exist. Marker layout must derive from the height model /
  row offsets, not live DOM rects. This is a real, required sub-task.
- **In-transcript search / isearch** (`useMessageListIsearch`) scans and scrolls
  to matches across the whole transcript. Jumping to a match must mount its row
  (scroll the height model to it), and match highlighting must survive
  mount/unmount.
- **Selection, quote anchors, comment anchors** reference live DOM; ensure
  anchors resolve after a row remounts (store by row id + offset, re-resolve on
  mount).
- **Progressive initial render** (`getProgressiveTimelineVisibility`) already
  stages the first paint; fold it into the window model rather than layering a
  second mechanism.

Default/rollout: keep behavior identical for short sessions (window ≥ list ⇒ no
change). Gate behind a setting or size threshold initially so the non-buggy
short-session path is untouched (see the UI-changes-preserve-defaults rule).

## Non-goals

- Not a replacement for `tailTurns` load bounding — that limits what the server
  *sends*; virtualization limits what the browser *renders*. They compose:
  virtualization lets the default load window grow back without a memory cost.
- Not prompt caching, offline, or cross-route retention (that is
  `client-route-retention.md`).
