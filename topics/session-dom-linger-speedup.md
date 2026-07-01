# Session DOM Linger Speedup

> Session DOM linger speedup is a proposed bounded keep-alive path that keeps
> the most recently left session route's mounted DOM and render state hidden for
> a short grace period, so immediate back/reselect returns can skip even
> deterministic rerender work.

Topic: session-dom-linger-speedup

Status: First one-session underlay linger slice implemented 2026-07-01. The
current `SessionRouteSnapshot` implementation remains the fallback safety net,
not the final latency target. User-observed warm returns can take over
0.5 seconds when React remounts the transcript and deterministic renderers
rebuild DOM, so the implemented fast path keeps the already-mounted session DOM
alive for a bounded grace window.

## Problem

`client-route-retention` now restores session data and scroll state
synchronously, but React still remounts the transcript and deterministic
renderers still rebuild visible DOM. For short returns, especially
session -> Inbox/Agents/Source Control/Settings -> back, the old DOM was
available milliseconds ago. A fixed grace-period linger could make those
returns feel closer to switching browser tabs.

The committed snapshot path avoids the worst defect, a blocking data fetch and
full-page loader, but it cannot make large transcripts instant by itself. The
expensive work left on a warm return is client-side: route remount, render-item
reconstruction, markdown/tool renderer DOM creation, layout, and scroll
restoration. Keeping the DOM mounted is the direct fix for that remaining
latency.

## Proposal

Keep at most the most recent one or two session route DOM trees hidden for a
short same-tab grace period, initially 60 seconds. A return to the same source,
project, session id, and tail-window params during the grace period reattaches
or reveals the lingered tree immediately. Expiry, source switch, auth switch,
tab close, reload, memory pressure, or route mismatch destroys it.

This is deliberately narrower than generic route keep-alive. It is a speed
layer on top of explicit `SessionRouteSnapshot` retention, not a substitute for
the snapshot/delta path. When DOM linger misses, the normal retained snapshot
path still gives an immediate useful view without a blocking loader.

## Recommended First Slice

Implemented first slice: one-session **underlay linger**. When the user leaves
a session for a non-session route, keep the session route mounted in a hidden/inert
session layer underneath the foreground route. Source Control, Inbox, Agents,
Settings, and similar routes render in the foreground layer while the URL and
browser history behave normally. Returning by browser Back or by selecting the
same session removes the foreground layer and reveals the already-mounted
session layer.

This is likely faster and simpler than physically moving DOM nodes between
containers. The session subtree stays owned by the same React host, its scroll
container stays alive, and renderer state remains intact. The desired user
experience is closer to switching browser tabs than to remounting a route from
cached data.

Initial scope:

- one lingered session entry only
- session -> non-session route -> same session within 60 seconds
- direct session A -> session B navigation does not park A; it unmounts or
  expires the parked slot and relies on `SessionRouteSnapshot` if the user later
  returns
- same source, auth state, project id, YA session id, route params, and
  tail-window params only
- no cross-tab, reload, or durable persistence
- fallback to `SessionRouteSnapshot` on every miss or expiry

Do not expand this into a generic keep-alive wrapper for all routes. Session
detail is the latency problem and the resource-risk problem; solving it with a
narrow session host keeps the behavior inspectable.

Do not start with two parked sessions. A second parked transcript tree adds the
riskiest failure modes first: duplicate live streams, focus and shortcut
ambiguity, confusing ownership of scroll/composer-adjacent state, and mobile
memory spikes. If a later pass wants two entries, it needs separate memory and
resource evidence after the one-entry path is proven.

## Resource Contract

- Bounded grace: default candidate 60 seconds.
- Bounded entries: one session first; two only after memory testing.
- Same-tab only; no durable persistence and no cross-source reuse.
- Hidden DOM must not survive a closed tab or browser reload.
- The hidden route must be inert to the foreground route: no pointer events,
  no focus capture, no accessible duplicate transcript, and no foreground
  keyboard shortcut handling.
- The owner for every lingering stream, watch, retry timer, and poll must be
  explicit. Either suspend it while hidden or count it as an intentionally
  grace-bounded live client resource.
- A hidden session must not indefinitely warm provider context, hold server
  watchers, or schedule recurring catch-up work after the grace period.

## Implementation Shape

Introduce a small `SessionDomLingerHost` near route layout, keyed by source,
project, session id, route params, and query params. When leaving a session
route for a non-session route, park the route subtree in the host instead of
unmounting it. Prefer the underlay shape for the first pass:

```text
NavigationLayout
  SessionDomLingerHost
    parked SessionPage for the most recent matching session
  ActiveRouteOutlet
    SourceControl / Inbox / Agents / Settings / ...
```

While parked, the session layer should be hidden or covered in a way that keeps
component and scroll state alive. It should also be `inert`, `aria-hidden`, and
non-interactive so the foreground route owns focus, pointer events, and keyboard
handling. On a matching return before expiry, reveal the parked layer instead
of remounting `SessionPage`. On expiry or mismatch, unmount normally so existing
cleanup paths close streams, watches, timers, and polling hooks.

The implementation should record a clear linger state machine:

- `active`: session route is the visible route
- `parked`: matching session route is hidden behind a non-session foreground
  route
- `revealed`: browser Back or session reselection reused the parked route
- `expired`: timer/mismatch/source/auth change destroyed the parked route

The router contract matters: URL, browser history, active nav selection, and
foreground route data loading must continue to behave as if normal navigation
happened. DOM linger is an implementation detail of route rendering, not a
second navigation stack.

This first version is default-on because the user explicitly selected it as the
needed speed path and the one-entry/60-second caps make it bounded. Do not infer
from that that generic hidden keep-alive is generally safe.

## Verification

- Browser test: session -> non-session route -> back within 60 seconds reuses
  the lingered DOM, preserves scroll, and shows no loading or progressive
  render bar.
- Performance check: session -> Source Control -> Back should reveal the
  existing session within one animation frame on development hardware. If the
  route still takes hundreds of milliseconds, the implementation is falling
  back to remount or doing synchronous foreground work on reveal.
- Back/reselect parity: browser Back and sidebar/session-list reselection of
  the same session should hit the same linger-reveal path.
- Expiry test: after the grace period, the subtree unmounts and the normal
  retained snapshot path handles return.
- Resource test: hidden linger entries do not accumulate streams, session
  watches, poll timers, or reconnect loops beyond the cap and grace period.
- Memory smoke: visit several large sessions on a mobile-width viewport and
  confirm linger eviction plus session snapshot byte caps bound tab memory.

## 2026-07-01 Implementation Notes

`NavigationLayout` owns the linger layer. Session routes render through that
layout-owned layer; the React Router child route is only a marker. Non-session
routes continue through the normal `Outlet` as the foreground layer. Session
route identity is parsed from `location.pathname`, not inherited child
`useParams()`, because a parent layout can otherwise retain stale session params
after navigation to `/git-status`.

`SessionPage` accepts the saved session route location so a parked instance does
not start reading Source Control or Settings as its own route. While parked,
the session disables page-title ownership, engagement tracking, URL-sync
navigation effects, and transcript-level global interaction listeners. The
stream and render state stay alive until the 60-second expiry unmounts the
parked layer.

Browser smoke against a 173-message Codex session verified:

- session -> Source Control parks the session layer while Source Control is
  foreground
- Back reveals the same `.message-list` DOM node
- after waiting for the original session render to settle, Back samples showed
  no full loader and no progressive render bar

If the user leaves before the initial progressive render has completed, DOM
linger preserves that existing in-progress overlay. That is expected for this
slice: the feature avoids remount work; it does not hide work that was already
visible before navigation away.
