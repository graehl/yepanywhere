# Cached Session Restore Performance

Status: Retention features default-off during scroll-reset investigation,
2026-07-02.

Progress:

- [x] Captured the cached-session restore regression and implementation plan.
- [x] Stop treating cached transcript data as already rendered: cache hits now
  start in a cheap loading state, then hydrate messages after a paint/yield.
- [x] Reuse the existing `MessageList` progressive render path for cached
  snapshot hydration.
- [x] Start the catch-up request with the retained message cursor before cached
  hydration; merge a fast delta before first hydration, or merge a slow delta
  after cached messages are visible.
- [x] Remove full `JSON.stringify(snapshot)` byte estimation from the snapshot
  write path; cache size is now coarse and entry/TTL bounded.
- [x] Add browser-local toggles for transcript snapshots and DOM linger.
- [ ] Add mobile/browser timing instrumentation around cached restore first
  feedback, snapshot lookup, hydration, and long tasks.
- [ ] Re-profile on a real mobile device or mobile-shaped browser profile.

Second slice notes:

- Added a Performance settings pane for large-session rendering and retention
  behavior.
- Moved response streaming, session loading progress, and stable tool preview
  rendering out of Appearance into Performance.
- Added browser-local toggles for keeping the most recent session mounted
  briefly and for retaining recent transcript snapshots.
- These newer retention features now default off while intermittent
  scroll-to-top restores are investigated. Users can still enable them from
  Performance settings.
- Disabling transcript snapshots clears the current in-tab snapshot cache and
  forces future session loads through the cold-load path.
- Disabling DOM linger prevents the previous session layer from being parked
  when leaving a session route.

This note tracks the follow-up work for session route retention after the first
`SessionRouteSnapshot` and one-session DOM linger slices. It is related to
[`033-session-initial-load-performance.md`](033-session-initial-load-performance.md),
but the failure mode here is different: the session data is already in memory,
yet the browser can still freeze before the user sees any feedback.

## Observed Problem

User-observed mobile behavior:

- Tapping a recently visited session sometimes appears to do nothing for about
  two seconds.
- After the pause, the session appears fully rendered.
- This is worse than the old cold-load behavior, where the UI at least showed a
  loading/progressive render surface while the transcript was being prepared.

The underlying issue is that a warm transcript snapshot is currently treated as
"already rendered" rather than only "already fetched." A cached transcript can
avoid network and server parse work, but React, renderer effects, style, layout,
and scroll restoration still need to mount a large transcript DOM tree.

## Current Mechanics

There are two separate retention mechanisms:

- `NavigationLayout` keeps at most one previous session DOM tree mounted,
  hidden, and inert for a 60-second grace window. This is the DOM linger path.
  Returning to the exact same route during that window should reveal already
  mounted DOM and should not need a loading surface.
- `SessionRouteSnapshot` keeps up to three in-tab transcript snapshots for five
  minutes, with source/project/session/query scoping. This is message/data
  retention, not DOM retention.

On a `SessionRouteSnapshot` hit, `useSessionMessages` currently initializes
`messages`, `session`, pagination, agent indexes, and `loading=false`
synchronously. It then starts an incremental REST fetch using the retained
`lastMessageId` cursor. `SessionPage` also disables progressive transcript
mounting when `restoredFromSnapshot` is true.

That creates the bad warm path:

1. User taps a cached session.
2. Hook state is synchronously hydrated with the full cached transcript.
3. The session route mounts a large transcript with no progress overlay.
4. Only after commit/effects does the delta fetch run.
5. If newer messages exist, the delta merge can trigger another render.

## Goals

- A tap on a cached session must produce visible feedback immediately.
- Cached transcript restore must use the same yielded progressive render path
  as cold transcript load whenever the transcript is large enough to matter.
- The cache should remain useful: avoid re-fetching and re-parsing unchanged
  transcript history, and still issue a catch-up fetch for newer messages.
- DOM linger remains a separate fast path. If already-mounted DOM is available,
  reveal it directly. If DOM linger misses and only messages are cached, use the
  cached-progressive path.
- Avoid expensive main-thread cache bookkeeping during navigation, especially
  full-object `JSON.stringify` byte estimation.

## Non-Goals

- Do not introduce transcript virtualization in this slice. Virtualization
  remains a larger architectural option because it affects scroll anchoring,
  search, browser find, quote selection, and streaming markdown updates.
- Do not make cached restore network-bound by default. A short race window for
  an already-fast delta response is reasonable; waiting indefinitely for network
  freshness would lose the primary benefit of in-memory restore.
- Do not duplicate progressive rendering logic outside `MessageList`.

## Proposed Shape

### Shared Progressive Render Path

Keep transcript batching and progress display owned by `MessageList`. Session
loading code should only decide whether the next transcript reveal is an
initial/hydration cycle that needs progressive mounting.

Conceptually:

```tsx
<MessageList
  messages={messages}
  progressiveRenderEnabled={
    sessionLoadingProgressEnabled && needsProgressiveReveal
  }
  progressiveRenderKey={renderCycleKey}
/>
```

`needsProgressiveReveal` should be true for:

- cold REST initial load after messages arrive;
- cached snapshot restore after an initial paint/yield;
- same-session route variants that materially change the transcript window,
  such as `tailTurns` or `tailFrom`.

`needsProgressiveReveal` should be false for:

- DOM linger reveal, because the DOM is already mounted;
- normal streaming appends after the transcript is visible;
- composer edits, pending-message status changes, and other ordinary
  post-reveal updates.

Use a render-cycle key that includes the full session route/snapshot identity,
not only `sessionId`, so query/tail-window changes can start a fresh progressive
cycle when needed.

### Two-Phase Cached Hydration

Cached restore should not synchronously put a large transcript into state during
the first route render. A better sequence is:

1. Resolve that a matching cached snapshot exists.
2. Render a cheap session loading/progress shell immediately.
3. Start the catch-up fetch using the cached `lastMessageId` cursor.
4. After a paint/yield, hydrate cached messages into state.
5. Let `MessageList` progressively mount the cached transcript.
6. Merge catch-up messages when available.

If the catch-up fetch completes before cached hydration starts, merge the delta
into the cached snapshot first so the progressive render mounts the freshest
known transcript once. Keep this as a short opportunistic race, not a required
network wait.

### Catch-Up Fetch Policy

The current cursor is message-id based, not timestamp based. That is probably
the right default: fetch messages after the newest retained JSONL message id.

Policy to explore:

- Start the delta fetch as early as possible once a cache hit is known.
- Do not wait on it for more than a very short paint/race window.
- If it returns before hydration, merge then render once.
- If it returns after hydration is underway or complete, merge normally. A few
  newly appended messages on top of cached history is acceptable and avoids
  making warm restore depend on network latency.

### Cache Size Accounting

The current `SessionRouteSnapshot` byte cap uses `JSON.stringify(snapshot)`
length. That is risky on the main thread: it walks the whole retained
transcript, allocates a large temporary string, and runs exactly during the
navigation path where responsiveness matters.

Preferred first change:

- Remove exact byte estimation from the hot path.
- Rely on the existing small entry cap and TTL as the primary bound.
- Keep the default at three entries only if mobile testing remains acceptable;
  otherwise consider two entries on constrained/mobile viewports.

Cheaper accounting options, if a byte-like heuristic is still needed:

- Track message count plus accumulated known text/content string lengths while
  data is already being processed.
- Use REST response size or `Content-Length` as a coarse snapshot weight when
  available.
- Defer expensive measurement to idle time and evict later if necessary.

Worker-based exact measurement is not the preferred next step. Sending a huge
snapshot to a worker can itself copy or serialize the same data, so it is only
worth considering after cheaper bounds and instrumentation prove insufficient.

### Snapshot Cloning

Deep-cloning snapshots on every read and write is defensive but can also be a
warm-navigation pause. Options to evaluate:

- Avoid cloning on read and treat snapshots as immutable by contract.
- Store frozen or structurally shared snapshot objects where practical.
- Clone only small mutable subrecords, such as scroll snapshots.
- Keep tests that prove normal render/update paths do not mutate retained
  snapshot messages.

## Settings

The existing Performance "Session Loading Progress" setting controls the
progress surface. The retention behaviors are browser-local Performance
settings.

Add browser-local settings for investigation and user control:

- `Session transcript cache`: enables/disables `SessionRouteSnapshot` restore.
- `Keep previous session mounted briefly`: enables/disables DOM linger.

These should be independent toggles because they test different theories:
message cache avoids network/parse work, while DOM linger avoids remount work.

The default decision should follow the vanilla-defaults rule. If a behavior can
surprise users or materially change memory use, keep it configurable and be
explicit about why it is default-on or default-off.

## Instrumentation

Add marks around the warm path before changing behavior so mobile regressions
are diagnosable:

- route activation / session tap observed;
- snapshot lookup start/end;
- snapshot clone/read cost, if cloning remains;
- cache-hit loading shell painted;
- catch-up request start/end and delta message count;
- cached hydration state queued;
- `MessageList` progressive render start/progress/complete;
- worst long task or RAF gap during cached restore.

The existing `markReloadPerfPhase` markers cover REST and `MessageList`
preprocessing, but not snapshot read/write, byte estimation, or the time before
the first visible feedback on a cached route return.

## Acceptance Checks

- Cached session tap shows loading/progress feedback before any multi-hundred-ms
  transcript work begins.
- Cached snapshot restore uses the same `MessageList` progressive progress bar
  as cold load.
- DOM linger reveal remains instant and does not show unnecessary progress.
- Delta catch-up still uses the retained cursor and does not refetch the whole
  transcript on cache hits.
- If delta returns before hydration, the first progressive render includes the
  new messages.
- If delta returns after hydration, the append/merge does not restart the
  initial progressive overlay.
- Cache bookkeeping avoids full `JSON.stringify` on the session navigation hot
  path.
- Browser/mobile smoke covers: session A -> list -> session A within DOM linger;
  session A -> session B -> session A with only snapshot cache; and expired
  snapshot cold load.

## Implementation Slices

1. Add instrumentation for cached restore timing and snapshot bookkeeping.
2. Remove or defer synchronous byte estimation from snapshot writes. Done in
   the first implementation slice with coarse per-message accounting.
3. Add settings toggles for transcript cache and DOM linger. Done in the
   second implementation slice with a new Performance settings pane.
4. Change cached restore to two-phase hydration with immediate loading shell.
   Done in the first implementation slice.
5. Reuse `MessageList` progressive rendering for cached snapshot hydration.
   Done in the first implementation slice.
6. Start catch-up fetch before hydration and merge fast deltas opportunistically.
   Done in the first implementation slice.
7. Mobile-profile the slow session and at least one ordinary session for long
   tasks, perceived tap response, and memory behavior.

## 2026-07-01 First Slice Notes

The first slice changes the `useSessionMessages` warm-cache path so cached
messages are not used as initial hook state. A cache hit now starts with
`loading=true` and an empty transcript, seeds the retained cursor/ref state,
starts the delta request, yields once, then hydrates cached messages. If the
delta request finishes during that short yield, the cached messages and delta
are merged before the first transcript hydration. If the delta arrives later,
it merges into the displayed cached transcript without restarting the initial
progressive overlay.

`SessionPage` no longer disables progressive mounting for snapshot restores.
The progressive render key now includes source, project, session, and search
params so tail/query variants can start their own render cycle.

`SessionRouteSnapshot` no longer computes byte caps by serializing the full
snapshot. The first slice uses a coarse per-message/per-agent estimate and
keeps the entry count plus TTL as the primary memory bound. Large transcript
reads and writes also avoid full snapshot cloning; only the small mutable scroll
snapshot is cloned.

Verification for this slice:

- `pnpm --filter @yep-anywhere/client test -- useSessionMessages.cache.test.tsx sessionRouteSnapshots.test.ts MessageList.test.tsx`
- `pnpm typecheck`
