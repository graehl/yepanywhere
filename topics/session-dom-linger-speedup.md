# Session DOM Linger Speedup

> Session DOM linger speedup is a proposed bounded keep-alive path that keeps
> the most recently left session route's mounted DOM and render state hidden for
> a short grace period, so immediate back/reselect returns can skip even
> deterministic rerender work.

Topic: session-dom-linger-speedup

## Problem

`client-route-retention` now restores session data and scroll state
synchronously, but React still remounts the transcript and deterministic
renderers still rebuild visible DOM. For short returns, especially
session -> Inbox/Agents/Source Control/Settings -> back, the old DOM was
available milliseconds ago. A fixed grace-period linger could make those
returns feel closer to switching browser tabs.

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

## Resource Contract

- Bounded grace: default candidate 60 seconds.
- Bounded entries: one session first; two only after memory testing.
- Same-tab only; no durable persistence and no cross-source reuse.
- Hidden DOM must not survive a closed tab or browser reload.
- The owner for every lingering stream, watch, retry timer, and poll must be
  explicit. Either suspend it while hidden or count it as an intentionally
  grace-bounded live client resource.
- A hidden session must not indefinitely warm provider context, hold server
  watchers, or schedule recurring catch-up work after the grace period.

## Implementation Shape

Introduce a small `SessionDomLingerHost` near route layout, keyed by source,
project, session id, route params, and query params. When leaving a session
route for a non-session route, move the route subtree into the linger host
instead of unmounting it. When returning before expiry, move it back. On expiry,
unmount normally so existing cleanup paths close streams, watches, timers, and
polling hooks.

The first version should keep this behind a local development flag or hidden
debug setting until browser memory and server subscription behavior are
measured. If promoted, it can be default-on only because the grace and entry
caps make it invisible and bounded, not because hidden keep-alive is generally
safe.

## Verification

- Browser test: session -> non-session route -> back within 60 seconds reuses
  the lingered DOM, preserves scroll, and shows no loading or progressive
  render bar.
- Expiry test: after the grace period, the subtree unmounts and the normal
  retained snapshot path handles return.
- Resource test: hidden linger entries do not accumulate streams, session
  watches, poll timers, or reconnect loops beyond the cap and grace period.
- Memory smoke: visit several large sessions on a mobile-width viewport and
  confirm linger eviction plus session snapshot byte caps bound tab memory.
