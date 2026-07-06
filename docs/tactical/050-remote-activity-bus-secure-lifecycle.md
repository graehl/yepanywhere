# Remote Activity Bus and Secure Lifecycle

Status: Core lifecycle fix and reconnect-overlap hardening implemented.
`ConnectionManager.markConnected()` ignores pre-start calls;
`SecureConnection.onAuthenticated` now fires on full SRP auth and
session-resume success; `SecureConnection` marks its attached
`ConnectionManager` connected on authenticated recovery.
`SecureConnection.forceReconnect()` now joins an in-flight
`ensureConnected()` recovery before deciding whether teardown is still needed.
Tests cover pre-start marks, out-of-band recovery canceling pending reconnect
backoff, full SRP callback behavior, resume callback behavior,
resume-invalid fallback notification timing, and forced reconnect arriving
during lazy recovery.

## Why This Exists

Observed symptom in hosted/relay remote mode:

- the top connection bar stayed orange/reconnecting for roughly 20 seconds;
- during that window, manual Inbox refresh succeeded repeatedly;
- the successful refresh returned current session data through the encrypted
  relay path, so the secure request channel was usable while live-update status
  still looked unhealthy.

That is surprising because the remote app has no meaningful "secure connection
without activity bus" product mode. Once the remote app shell is authenticated
and rendering, YA should maintain the activity bus as a required child channel
of the same secure connection. If API requests are succeeding for the active
remote app, the activity subscription should be installed or retrying
immediately, not waiting behind stale transport backoff.

This note records the current mechanics, the plausible failure path, and the
shape of the invariant before changing code.

Related docs:

- [`021-client-connection-readiness-vs-state-consistency.md`](021-client-connection-readiness-vs-state-consistency.md)
- [`031-client-query-controller.md`](031-client-query-controller.md)
- [`../project/connection-matrix.md`](../project/connection-matrix.md)
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Current Implementation Facts

Remote request/response traffic and activity events already share one secure
transport:

- `RemoteConnectionContext` creates a `SecureConnection`, verifies it with
  `conn.fetch("/auth/status")`, then stores it with `setGlobalConnection`.
- `fetchJSON` uses that global connection in remote mode. If no global
  connection exists yet in the remote build, it waits through
  `whenConnectionReady()`.
- `SecureConnection.fetch()` delegates to `RelayProtocol.fetch()`, which calls
  `transport.ensureConnected()` before sending a request frame.
- `ConnectedAppContent` mounts `useRemoteActivityBusConnection()`.
- `ActivityBus.connect()` uses `getGlobalConnection()` in remote mode and sends
  a `channel: "activity"` subscription through the same `RelayProtocol`.
- The top `ConnectionBar` reads `ConnectionManager.state` via
  `useActivityBusState()`.

The separation is therefore not physical transport. It is lifecycle ownership:

- `SecureConnection.ensureConnected()` can make the encrypted request channel
  usable.
- `ConnectionManager` owns the app's reconnect state and runs a configured
  reconnect function, which calls `SecureConnection.forceReconnect()` for the
  remote path.
- `ActivityBus` marks the manager connected when the activity subscription's
  `connected` event reaches its `onOpen` handler.

## Plausible Failure Path

The observed state is possible with today's code:

1. A remote secure WebSocket closes, errors, or fails a health check.
2. `SecureConnection.handleSocketClose()` calls its `onDisconnect` callback.
3. `RemoteConnectionContext.handleDisconnect()` calls
   `connectionManager.handleError(error)`.
4. `ConnectionManager` enters `reconnecting` and schedules its next reconnect
   attempt using exponential backoff.
5. `SecureConnection.handleSocketClose()` also rejects pending requests and
   calls `RelayProtocol.notifySubscriptionsClosed(error)`.
6. The activity subscription's `onError` / `onClose` handlers clear
   `ActivityBus.wsSubscription`; their manager calls are no-ops if the manager
   is already in `reconnecting`.
7. Before the manager's backoff timer fires, the user manually refreshes Inbox.
8. The refresh calls `api.getInbox()` -> `fetchJSON()` ->
   `SecureConnection.fetch()` -> `RelayProtocol.fetch()`.
9. `RelayProtocol.fetch()` calls `transport.ensureConnected()` directly. That
   can reconnect or resume the secure pipe immediately, independent of the
   manager's scheduled reconnect attempt.
10. The request succeeds, proving the secure request channel is usable.
11. That successful request does not call `connectionManager.markConnected()`
    and does not reinstall the activity subscription.
12. The top bar remains orange until the manager's own reconnect attempt
    eventually runs and/or the activity subscription receives a new
    `connected` event.

This explains a long orange bar with repeated successful Inbox refreshes. The
duration can be visible to a user because the manager may already be on a later
backoff interval.

## Verified Aggravations

The failure path above was verified step-by-step against the source. Two
additional problems make the divergence worse than cosmetic:

1. **The stale reconnect destroys the recovered transport.** When the
   manager's backoff timer finally fires, its reconnectFn calls
   `SecureConnection.forceReconnect()` (wired in `ActivityBus.connect()`).
   `forceReconnect()` unconditionally tears the socket down — including a
   healthy socket that a fetch-driven `ensureConnected()` already recovered —
   rejecting in-flight requests, closing session subscriptions, and re-pairing
   through the relay. The two recovery engines do not just diverge; they
   fight.
2. **Racing recovery engines can hang a fetch.** If `forceReconnect()` runs
   while a fetch-driven `ensureConnected()` handshake is in flight, it strips
   the socket handlers and nulls `connectionPromise`; the fetch's auth promise
   can then only fail via the 30s connection timeout. This race is
   pre-existing. The fix below shrinks the window (stale timers get canceled)
   but does not fully eliminate concurrent
   `forceReconnect()`/`ensureConnected()` overlap.

## Layering Note: Who Owns the Transport

The root layering violation: `ActivityBus.connect()` is what starts
`ConnectionManager` and injects a reconnectFn that calls
`globalConn.forceReconnect()`. The activity subsystem owns reconnection policy
for the shared transport that requests, uploads, and session streams also use.

In local mode this conflation is mostly harmless: native HTTP fetches are
independent of the activity WebSocket, and the manager's backoff really is the
transport retry loop for that socket. In remote mode the transport is shared
and `SecureConnection` — the actual transport — already has its own recovery
path (`ensureConnected()` → relay reconnect → SRP resume) that the manager
cannot observe. The manager's retries are misattributed to the activity
layer; the transport's own recoveries are invisible to the manager. The fix
is to make every transport recovery visible to the manager, not to add a
second retry loop.

## Product Invariant

For the current remote app shell:

> An authenticated remote app `SecureConnection` implies YA should maintain an
> activity-bus subscription on that secure connection. A successful secure
> transport recovery must immediately converge the activity-bus lifecycle.

More concretely:

- In remote app mode, the activity bus is a mandatory app-level subscription,
  not an optional diagnostic stream.
- A secure transport that can satisfy API requests should not leave
  `ConnectionManager.state === "reconnecting"` only because an older scheduled
  reconnect has not fired.
- If activity subscription setup fails while the secure transport is known
  usable, YA should retry the subscription promptly. It should not force a full
  transport reconnect unless the subscription failure proves the transport or
  authentication state is invalid. (Ideal end state; the retry-without-teardown
  half is explicitly deferred — see "Explicitly Deferred" below.)
- The top bar can remain a live-update health indicator, but it should not be
  able to sit in stale transport-reconnect state while same-transport API
  requests are succeeding.

## Non-Goals

- Do not make `SecureConnection` itself automatically subscribe to activity.
  `SecureConnection` remains the transport primitive used by requests, uploads,
  session streams, activity subscriptions, speech sockets, tests, and special
  clients.
- Do not add a new always-visible user-facing bar. Connection bars are already
  developer/diagnostic UI by default, and this issue is about lifecycle
  convergence rather than more chrome.
- Do not introduce broad refetch-on-reconnect behavior. The existing retained
  query/controller work owns snapshot revalidation.
- Do not change local direct-mode semantics until the remote invariant is
  understood. Local mode still has native HTTP fetches plus WebSocket
  subscriptions, so request success and activity stream health are naturally
  less tightly coupled.

## Agreed Solution

Route both recovery entry points through the same state machine by giving
`SecureConnection` the callback symmetric to its existing `onDisconnect`.

1. **Add `onAuthenticated` to `SecureConnection`.** Fire it wherever
   `connectionState` transitions to `"authenticated"`. There are exactly two
   sites, both already calling `onSessionEstablished` + `sendCapabilities()`:
   - `handleSrpResumeResponse()`, the `isSrpSessionResumed` branch — covers
     resume during `connectAndAuthenticate()`, `resumeOnExistingSocket()`, and
     relay auto-reconnect;
   - `handleSrpVerify()` success path — covers full SRP auth.

   Thread it as an optional constructor parameter alongside `onDisconnect`,
   and through the static factories (`fromStoredSession`, `forResumeOnly`,
   `forResumeOnlyWithSocket`, `connectWithExistingSocket`). Do NOT wire it for
   the nested speech-socket connection created in `openSpeechSocket()` — that
   is a separate channel and must not touch the app connection manager.

2. **Wire it in `RemoteConnectionContext`**, mirroring the existing
   `handleDisconnect` → `connectionManager.handleError()` wiring: add a
   `handleAuthenticated` callback that calls
   `connectionManager.markConnected()`, and pass it at every site that
   constructs the app's `SecureConnection` (`connect`, `resumeSession`,
   `connectViaRelay`, and both auto-resume branches).

   Implementation note after the source-transport boundary: the app connection
   manager is now attached by `SecureSourceTransport`, and `SecureConnection`
   marks that attached manager directly on authenticated recovery. The optional
   `onAuthenticated` callback remains for callers and tests, but app lifecycle
   convergence no longer depends on `RemoteConnectionContext` passing it.

3. **Guard `markConnected()` when the manager is not started.** During initial
   page-load auth, `onAuthenticated` fires before `ActivityBus.connect()` has
   called `connectionManager.start()`. Make `markConnected()` a no-op when not
   started, so a stopped manager cannot be flipped to `"connected"`. This is
   safe for all existing callers (`ActivityBus` subscription `onOpen`,
   `useSessionStream`, `useSessionWatchStream`, and the manager's own
   `_executeReconnect` success) — each only runs after `start()`.

Everything else already exists and needs no changes:

- `markConnected()` cancels the pending backoff timer and resets attempts.
  This both clears the stale orange bar and prevents the destructive stale
  `forceReconnect()` (aggravation 1 above).
- The `stateChange` listener installed in `ActivityBus.connect()`
  (`state === "connected" && !this.wsSubscription` → `this.connect()`)
  reinstalls the activity subscription.
- The new subscription's `onOpen` re-calls `markConnected()` (no-op).

On semantics: `ConnectionManager` state today already means "transport is up",
not "live updates flowing" — the manager's own reconnect success calls
`markConnected()` before the subscription reinstalls (see the comment in
`_executeReconnect()`). This fix keeps that meaning and just stops one
recovery path from being invisible to the manager.

Rejected alternative: calling `markConnected()` after every successful
`RelayProtocol.fetch()`. Too broad — it fires on every request instead of on
the authentication transition. `onAuthenticated` is the precise version of
the same idea.

### Explicitly Deferred (follow-ups, not part of this change)

- Activity-subscription retry over a healthy transport without transport
  teardown. Today a failed activity subscribe feeds `handlers.onError` →
  `connectionManager.handleError()` → full transport reconnect (see the
  `ensureConnected().catch` in `RelayProtocol.subscribeActivity()`).
  Heavy-handed but rare; separable.
- Moving `ConnectionManager.start()` wiring out of `ActivityBus` into the
  connection layer (full ownership inversion per the layering note). This fix
  does not require it and does not foreclose it.
- Making the top bar reflect strict live-update health rather than transport
  health (product decision; see resolved questions).

## Test Plan

`ConnectionManager` has injectable timers and existing suites to follow:
`packages/client/src/lib/connection/__tests__/ConnectionManager.test.ts` and
`ConnectionManager.integration.test.ts`.

Core regression test (reproduces the observed divergence without real
network):

1. Start a `ConnectionManager` with fake timers and a reconnectFn spy;
   `markConnected()`.
2. `handleError(...)` with a retryable error → assert state is
   `reconnecting` with a backoff timer pending.
3. Simulate the out-of-band fetch recovery: call `markConnected()` (this is
   exactly what authenticated secure recovery does) WITHOUT advancing timers.
4. Assert state is `connected`, and that advancing timers past the backoff
   delay does NOT invoke the reconnectFn (stale timer canceled — no
   destructive `forceReconnect`).

`SecureConnection` tests (see `SecureConnection.compatibility.test.ts` for
harness patterns):

- `onAuthenticated` fires on full SRP verify success;
- `onAuthenticated` fires on session-resume success;
- `onAuthenticated` does not fire on auth failure, and on
  resume-invalid-fallback it fires only once the fallback SRP succeeds.

`markConnected()` guard:

- `markConnected()` before `start()` leaves state `"disconnected"`;
- behavior after `start()` unchanged (existing suites already cover this —
  verify none call `markConnected()` before `start()`; adjust guard or tests
  if any do).

Re-subscribe and non-regression:

- with `wsSubscription === null`, a manager transition to `connected` makes
  `ActivityBus` re-subscribe (may already be covered by
  `ReconnectSubscriptions.test.ts`; extend only if not);
- true transport failure still walks the existing `ConnectionManager`
  backoff;
- local direct mode is unchanged (plain `WebSocketConnection` has no
  `onAuthenticated`; nothing new fires).

## Resolved Questions

- **Source of truth for "secure transport recovered":** the `SecureConnection`
  `onAuthenticated` callback. It is the only place that observes every
  recovery, whether lazily fetch-driven or manager-scheduled, and it is
  symmetric with the existing `onDisconnect`.
- **Does `ConnectionManager` represent transport or activity state?**
  Transport state, as it already de facto does (its own reconnect success
  marks connected before the subscription reinstalls). Making the bar reflect
  strict live-update health is a separate product decision; do not block this
  fix on it.
- **Subscription retry loop vs idempotent `connect()`:** neither is needed for
  this fix — the existing `stateChange` listener already re-invokes
  `ActivityBus.connect()`, which is idempotent when a subscription exists. A
  dedicated subscription retry loop over a healthy transport is deferred.
- **Developer diagnostics distinguishing transport vs subscription recovery:**
  the existing `[SecureConnection]` / `[ConnectionManager:*]` /
  `[ActivityBus]` console logs already separate the two transitions; no new
  UI.

## Working Conclusion

The observed orange bar with successful Inbox refreshes follows from two
recovery entry points that do not share a state machine:

- manager/activity recovery waits on `ConnectionManager` backoff and then
  calls `SecureConnection.forceReconnect()`;
- request recovery calls `SecureConnection.ensureConnected()` directly, can
  succeed before the manager's scheduled attempt, and is invisible to the
  manager — whose stale attempt later tears the recovered socket down.

The fix: make every transport authentication success visible to the attached
manager via `connectionManager.markConnected()` (guarded on a started
manager), while still firing `SecureConnection.onAuthenticated` for callers
and tests. Backoff cancellation and activity resubscription then fall out of
existing machinery, and the activity subscription's own `connected` event
remains the proof that live updates are fully healthy.

Follow-up hardening now also serializes forced reconnect with lazy recovery:
when `forceReconnect()` arrives while `ensureConnected()` is already
authenticating/resuming, it waits for the active attempt. If that attempt
succeeds, no socket teardown is needed; if it fails, the forced reconnect
continues with a fresh attempt. This keeps health-check or manual reconnect
requests from orphaning an in-flight fetch-driven handshake.
