# Session Exit Navigation Latency

> Navigating from a large session to a lightweight sidebar route such as
> Settings must paint the new route immediately. The outgoing transcript should
> not be able to delay the first useful render of the requested page.

Topic: session-exit-navigation-latency

Status: Default-off fix implemented 2026-07-06. The original observation was
made in the hosted relay client: clicking Settings from some large sessions left
the previous session visible for roughly 500 ms before Settings appeared. The
visible relay API probes on Settings entry were not the primary suspect; the
delay correlated with leaving large session routes.

Related context:

- [Session DOM Linger Speedup](session-dom-linger-speedup.md) explains the
  underlay keep-alive path that keeps the last session mounted briefly to make
  quick returns instant.
- [Client Route Retention](client-route-retention.md) covers the broader
  same-tab route-retention policy and warns against generic mounted keep-alive
  for all routes.
- [Client Rendering Performance](../packages/client/RENDERING_PERFORMANCE.md)
  records the transcript render invariants and profiling hooks.

## Observations

- Clicking Settings in the sidebar updates slowly only from some larger
  sessions. From smaller sessions, the same route change feels immediate.
- The hosted relay client logs several requests as Settings mounts:
  `/api/dev/status`, `/api/version`, `/api/status/workers`, and
  `/api/dev/safe-restart`. Those are real mount effects, but the Settings link
  itself is a normal React Router `Link`; there is no route loader or Suspense
  gate awaiting those fetches.
- Before the 2026-07-06 default-off fix, disabling **Keep Recent Session
  Mounted** did not fully rule out the outgoing session. `NavigationLayout`
  cleared the previous `lingerRoute` in an effect, so the first render after
  leaving a session could still include the previous session route before the
  effect removed it.
- With DOM linger enabled, the behavior is expected by design: the previous
  session stays mounted as an inert hidden underlay beneath Settings for up to
  the linger TTL.
- The user expectation is asymmetric: `session -> Settings -> back to session`
  may use an optimization to make the return fast, but the initial
  `session -> Settings` paint should not wait for the large session page to
  re-render, park itself, flush scroll state, or unmount.

## Suspected Mechanism

`NavigationLayout` owns a session layer and a foreground route layer. During a
session-to-non-session navigation, the foreground `Outlet` renders Settings,
while the session layer may still render the previous `SessionPage` as parked.

That couples incoming route paint to outgoing session work:

- the previous `SessionPage` can receive `isDomLingerParked`;
- `MessageList` receives `inert`;
- even if the underlying render data is memoized, `MessageList` may still
  traverse a large set of timeline rows to return React elements;
- browser layout/style/commit work still sees a large hidden DOM tree when the
  layer is parked with `visibility: hidden` rather than removed;
- if linger is off, the previous route is removed by a later effect instead of
  being synchronously excluded from the first non-session render.

The result is not a network fetch block. It is a render/commit scheduling
problem: React cannot paint the new foreground route until the current commit
finishes, and the current commit can still include large outgoing-session work.

## Desired Contract

- A normal click from a session to Settings, Inbox, Agents, Projects, Source
  Control, or another lightweight non-session route should paint that route
  without waiting on transcript-size work from the route being left.
- If DOM linger is off, no old session subtree should participate in the first
  non-session route render.
- If DOM linger is on, parking the old session should avoid re-rendering the
  transcript on the critical path to the foreground route's first paint.
- Any leave-time scroll snapshot, state capture, or cache write should be cheap,
  bounded, and measured. Expensive retention work should happen after the
  foreground route is visible or be skipped in favor of the normal snapshot
  fallback.
- The fix must preserve the existing return-speed goal: quick Back/reselect to
  the same session should remain fast when DOM linger is enabled.

## Fix Shapes

### 1. Synchronously Bypass Linger When Disabled

When `sessionDomLingerEnabled` is false, compute `renderedSessionRoute` so it
does not fall back to `lingerRoute` on non-session routes. The old session can
then be excluded from the first Settings render instead of being cleared by a
post-render effect.

This is the smallest likely correctness fix for users who have the setting off.
It should also make the setting's name truthful: off means no mounted recent
session, including during the transition commit.

Implemented 2026-07-06. `NavigationLayout` now computes a separate
`parkedSessionRoute` that can only reuse `lingerRoute` when
`sessionDomLingerEnabled` is true. With the default setting off, a
session-to-Settings transition renders the foreground route without first
rendering the old session as a parked layer.

### 2. Split Park State From Transcript Props

When DOM linger is enabled, avoid passing a new parked/inert prop through the
entire `SessionPage` and `MessageList` tree on the same commit that reveals
Settings. Prefer parking at the wrapper/layer boundary where possible:

- set `inert`, `aria-hidden`, `visibility`, and pointer behavior on the
  session layer;
- keep transcript row props stable so memoization can skip the heavy subtree;
- move only the small global-listener or ownership gates that truly need active
  vs parked state into narrow owners.

This preserves the underlay behavior while reducing foreground route latency.
The tradeoff is that parked-state side effects must remain explicit: hidden
sessions must not keep owning document title, keyboard shortcuts, engagement
tracking, or unbounded server/client resources.

### 3. Defer Parking Work Until After Foreground Paint

For linger-enabled navigation, render the foreground route first, then park the
session layer in a follow-up task or transition. This makes the new page win the
first paint.

The risk is a short window where the old session is still active in the tree
while the foreground route is visible. The implementation would need tight
guards for focus, keyboard shortcuts, scroll capture, and server subscriptions.
This is likely more complex than splitting park state from transcript props.

### 4. Make Leave-Time Capture Opportunistic

If the transition is to a lightweight non-session route, do not let scroll
snapshot capture, transcript cache writes, or DOM-retention bookkeeping block
the new page. Capture a cheap snapshot synchronously only when already
available; otherwise schedule it after paint or rely on the existing retained
session data.

This is a complement to the first two shapes, not a replacement. It protects
against future regressions where leave-time work grows.

### 5. Add Focused Instrumentation Before Broad Refactors

Measure route-click-to-first-paint for:

- large session -> Settings, DOM linger off;
- large session -> Settings, DOM linger on;
- large session -> Source Control and Inbox with both settings;
- small session -> Settings as a control.

The probe should record:

- click time;
- URL/location change time;
- first foreground route commit;
- first foreground route paint;
- whether a session layer was rendered in that commit;
- message count / render-item count / timeline-row count of the outgoing
  session;
- `MessageList` render duration and commit-adjacent long tasks.

Existing `markReloadPerfPhase` and render-profile style logging can guide the
shape, but this is a route-transition probe, not a reload-only probe.

## Non-Goals

- Do not remove the session DOM linger feature outright. It solves a different
  latency problem: fast return to the same large session.
- Do not add generic route keep-alive for Settings or other small pages.
- Do not hide the issue by delaying the Settings sidebar click handler or
  prefetching Settings data. The problem is outgoing session render cost.
- Do not make hidden sessions indefinitely own streams, watchers, retry timers,
  or prompt-cache keepalive work.

## Verification

- With **Keep Recent Session Mounted** off, large session -> Settings should
  not render a parked session layer in the first non-session route commit.
- With **Keep Recent Session Mounted** on, large session -> Settings should
  show Settings within one frame or within a small measured budget, while
  browser Back within the grace window still reveals the same session DOM.
- Remote hosted relay and local direct clients should behave the same; relay
  request logs may still appear after Settings mounts, but they must not
  explain or gate the first Settings paint.
- Test at least one very large transcript, one ordinary transcript, and a
  session still actively streaming or processing.
