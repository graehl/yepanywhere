# Source Transport Boundary

Topic: source-transport

Status: Active plan, T2 landed 2026-07-05. This is the implementation runbook for the
contract in [`topics/source-transport.md`](../../topics/source-transport.md).
It continues Phase 6 of
[`051-client-source-runtime-topology.md`](051-client-source-runtime-topology.md)
(whose near-term slices 4–6 it supersedes) and delivers the ownership
inversion deferred by
[`050-remote-activity-bus-secure-lifecycle.md`](050-remote-activity-bus-secure-lifecycle.md).

## Goal

Give every `YaSourceRuntime` a `SourceTransport`, move session streams, watch
streams, the activity stream, and the remaining global-connection consumers
behind it, and delete the process-wide connection globals — without changing
any reconnect, wake, backoff, or readiness behavior a user can observe.

## Current Constraints

- Six global leak paths choose transport today: `api.fetchJSON`'s
  `getGlobalConnection()` check, `useConnection`, `useSessionStream` and
  `useSessionWatchStream` dual-path selection, `activityBus` dual-path
  selection, the `connectionManager` singleton, and `whenConnectionReady`.
- `RemoteConnectionContext` replaces the `SecureConnection` instance across
  connect/resume/relay flows (four `setGlobalConnection(conn)` sites, two
  `null` teardown sites). A relay drop replaces the instance with no user
  action.
- `ActivityBus.connect()` starts the singleton `connectionManager` and owns
  its reconnectFn; stream hooks feed the manager's health signals from their
  handlers. The 050 fix (`onAuthenticated` → `markConnected`) is load-bearing.
- `RelayProtocol` and `api/upload.ts` reach into the singleton manager for
  `beginCriticalOperation`.
- `fetchJSON` sends `X-Desktop-Token`; `DirectConnection.fetch` does not
  (drift to absorb, not copy).
- `isRemoteClient()` (build-time) stays global; only `isRemoteMode()` and
  connection-object consumers migrate.
- Runtimes currently share one `currentSourceApiClient` over the global `api`
  and one session-detail cache object; summary state is per-source but
  transport is not.

## Working Terms

- **Facade:** the stable per-source `SourceTransport` object consumers hold.
- **Backing connection:** the `WebSocketConnection`/`SecureConnection`
  instance currently occupying a facade's slot; replaceable.
- **Slot:** `attach`/`detach` wiring on the concrete transport classes, used
  only by connection-establishment flows.
- **Managed stream:** the shared resubscribe engine over
  (`transport.subscribe*`, `transport.status`).
- **Demand traffic:** requests caused by user action or mount; waits bounded
  at the transport. **Elective traffic:** pollers/prefetch/log flushing;
  pauses on not-ready status.
- **Lease:** the existing `runtime.summary` retain/release signal that a
  consumer wants activity/draft updates for a source.

## Implementer Notes

Global guardrails; per-slice tripwires are listed with each slice.

- **Relocate, don't redesign.** No changes to backoff constants, ping/pong
  timing, stale thresholds, retryability classification, or readiness waits
  in any move slice. If a semantic improvement tempts you mid-slice, add it
  to Deferred Follow-Ups instead.
- **Parity gate.** The Behavior Parity Contract suite (topic doc table) must
  pass against the facade before T6 starts. Consumer slices (T6–T8) may not
  weaken or skip parity rows; a row change requires a decision note in the
  topic doc first.
- **Dual-write bridge.** From T3 until T9, connection flows both
  `setGlobalConnection(conn)` and `attach(conn)`. Never remove a global in
  the same slice that migrates its last consumer; deletion is T9's job so
  each migration slice stays revertable.
- **Opaque keys.** The registry must not parse source keys to choose a
  transport kind. Whoever mints the key supplies the transport construction
  inputs alongside it.
- **No kind-branching.** Feature code branches on `capabilities`, never on
  `transport.kind`. Reviewers should grep new diffs for `.kind`.
- **Speech socket isolation.** The nested speech-socket connection must never
  touch any `ConnectionManager` (050 lesson).
- **Verification per slice:** `pnpm lint`, `pnpm typecheck`, `pnpm test`;
  `pnpm test:e2e` for T6–T8; update slice status in this document as part of
  the landing commit.

## Slice T1: Contract Types And Fakes

Status: Landed 2026-07-05.

Intent:

- Add `SourceTransport`, `SourceTransportStatus`, snapshot/channel types,
  `SourceTransportCapabilities`, and typed not-ready/error shapes under
  `packages/client/src/lib/transport/`.
- Add `FakeSourceTransport` (script-driven status + subscriptions) for hook
  and managed-stream tests.

Acceptance:

- Types compile; fake passes a trivial self-test; zero production consumers.
- Doc comments carry the state-mapping table and the demand/elective
  contract so the types are self-explaining.

Tripwires:

- Do not re-export from `lib/connection/index.ts` — keep the new boundary's
  import graph clean of the legacy barrel (and of `SecureConnection`'s eager
  `tssrp6a` import; see the note in `lib/connection/index.ts`).

## Slice T2: LocalhostSourceTransport

Status: Landed 2026-07-05.

Intent:

- Implement the localhost transport: same-origin fetch with `fetchJSON`
  parity, subscriptions via a privately owned `WebSocketConnection`, a
  private `ConnectionManager` for the stream channel, honest channel
  snapshots, `ready`/no-op-reconnect source semantics.
- Extract the plain-fetch core (desktop token, 401 signaling,
  `X-Setup-Required`) into one helper shared with `fetchJSON` so behavior
  cannot fork.

Acceptance:

- Unit tests over a fake socket: always-ready source state; channel snapshot
  transitions for the stream WebSocket; upload channel reported ephemerally
  with an active count; `dispose()` closes only owned channels.
- Desktop-token and 401 behavior covered by tests against the shared helper.

Tripwires:

- Own the `WebSocketConnection` instance; do not adopt the
  `getWebSocketConnection()` singleton (it remains in place for legacy
  consumers until T9).
- `WebSocketConnection` needs constructor options (socket factory, manager
  injection) — additive only; the zero-arg path must behave exactly as
  today for existing callers.
- Local upload keeps its critical-operation guard, pointed at this
  transport's manager once constructed under it; the singleton call in
  `api/upload.ts` stays for the legacy path until T9.

## Slice T3: Multiplex Transports With Connection Slot

Status: Not started.

Intent:

- Implement `WebSocketSourceTransport` and `SecureSourceTransport` with
  `attach`/`detach` slots and per-instance managers (policy untouched).
- Internalize health feeding: add an inbound-event hook to `RelayProtocol`
  (records events/heartbeats to the owning manager), inject the
  critical-operation guard, wire `sendPing`/`receivePong` internally.
- Route backing-connection callbacks (`onAuthenticated`, `onDisconnect`) to
  the owning transport's manager.
- `RemoteConnectionContext` dual-writes: constructs connections exactly as
  today, then `transport.attach(conn)` in addition to
  `setGlobalConnection(conn)`; `detach()` alongside `setGlobalConnection(null)`.

Acceptance:

- Parity suite rows 1–12 pass against both transports with the
  `ConnectionSimulator` harness (port
  `ConnectionManager.integration.test.ts`, `ReconnectSubscriptions.test.ts`,
  `whenConnectionReady.test.ts` patterns to the facade).
- Slot test: attaching a replacement backing connection preserves facade
  identity, transitions status, and rejects nothing that today survives a
  relay re-pair.
- 050 regression in simulation: fetch-driven recovery during manager backoff
  converges state and cancels the stale destructive reconnect.

Tripwires:

- `RelayProtocol` hook and guard injection must default to current behavior
  when absent — `WebSocketConnection`/`SecureConnection` built outside a
  transport (everything, until T4) must be byte-for-byte unchanged.
- The singleton `connectionManager` keeps running for legacy consumers; the
  per-transport managers are additive until consumers move. Two managers
  observing one socket must not both drive reconnects — the transport's
  manager stays passive (started but with reconnect driving disabled, or not
  started) until T6/T7 hand it the consumers. Decide and document in-code
  which of those two holds; do not leave it implicit.
- Demand-fetch bounded wait on an empty slot: 15s default matching
  `whenConnectionReady`; typed retryable rejection.

## Slice T4: Runtime Wiring And The fetchJSON Choke Point

Status: Not started.

Intent:

- Add `transport` to `YaSourceRuntime`. The registry mints facades; the code
  that mints source keys (route binding, connection flows) registers the
  transport construction inputs with it.
- Route `fetchJSON` through the current runtime's transport as a single
  choke point, removing the global check from the entire `api.*` surface in
  one place.

Acceptance:

- Behavior-parity tests for `fetchJSON`: local build → plain fetch semantics;
  remote build attached → backing fetch; remote build detached → bounded
  wait then typed rejection (matching today's `whenConnectionReady` path).
- Registry tests: opaque-key rule holds (no key parsing); `remote:none`
  resolves to a detached secure facade.

Tripwires:

- `getGlobalConnection()` remains set and readable — this slice must not
  change any consumer other than `fetchJSON`.
- Do not migrate `SourceApiClient` internals; it already flows through
  `fetchJSON` and inherits the choke point for free.

## Slice T5: Managed Stream Helper

Status: Not started.

Intent:

- Implement `createManagedStream(transport, spec)` owning: wait-for-ready
  subscribe, resubscribe on ready transitions and backing swaps,
  `lastEventId` capture/resume, non-retryable terminal state, teardown-once,
  stale-handler and StrictMode guards, and subscription-level retry without
  transport teardown (050 deferred item).

Acceptance:

- Unit tests against `FakeSourceTransport` and the simulator: parity rows
  13–15; two-runtime isolation (status churn in one runtime never touches
  the other's streams); subscription-level 4xx stays terminal without a
  transport reconnect; subscription-level transient failure retries without
  tearing the transport down.

Tripwires:

- The helper consumes only the public transport surface — no reach-in to
  managers or protocol internals, or fakes stop being representative.

## Slice T6: Session And Watch Streams

Status: Not started.

Intent:

- Move `useSessionStream` and `useSessionWatchStream` onto
  `runtime.transport` via the managed stream. Delete their
  `connectionManager` imports and sensor calls (the transport feeds itself
  from T3).

Acceptance:

- Hook return shapes (`connected`, `reconnect`) unchanged; `useSession`
  needs no edits.
- Existing hook tests and `useSessionWatchStream.test.tsx` green; e2e green.
- Two-fake-runtime isolation test at the hook level.

Tripwires:

- Preserve `wantsLiveDeltas` pass-through and the reconnect debounce (the
  50ms close-before-connect defer) — or record a parity decision.
- Heartbeats: transport records them internally; the managed stream still
  filters them from consumer `onMessage` exactly as the hooks do today.
- The singleton manager is still running for the activity bus; these hooks
  must stop feeding it without breaking its stale detection — the activity
  stream (its heartbeats flow through `recordHeartbeat` from the bus
  handlers) remains the singleton's signal source until T7. Verify the local
  no-activity-mounted edge (auth screens) before landing.

## Slice T7: Activity Stream Per Source

Status: Not started.

Intent:

- Make the activity stream a per-runtime managed stream. Leases already flow
  through `runtime.summary`; the lease now drives the stream itself, so the
  lifecycle invariant (ready + lease ⇒ subscribed/converging) is encoded
  once.
- Invert ownership fully: no consumer starts a manager. `useActivityBusConnection`
  / `useRemoteActivityBusConnection` become lease holders (local keeps its
  auth gating as lease gating).
- Keep the `activityBus` singleton as a thin compatibility facade over the
  current source's stream during migration (its `on()` event fan-out is
  widely consumed); `useActivityBusState`, `ConnectionBar`, and `RemoteApp`
  read the current runtime's transport status.

Acceptance:

- 050 invariant test: out-of-band recovery converges the activity
  subscription; the orange-bar-with-working-fetch divergence is
  unreproducible in simulation.
- One runtime can retain activity without being the app's current source
  (existing lease tests extend to the real stream).
- Refresh-on-reconnect and `visibilityRestored`-driven refresh events still
  fire (parity row 2).

Tripwires:

- The singleton `connectionManager` loses its last driver here. Anything
  still reading its state (`useActivityBusState` legacy paths,
  `ClientLogCollector` until T8) must be moved or shimmed in the same slice
  — a started-but-fed-by-nothing manager reports lies.
- Draft-decoration scans and summary reducers already hang off leases; do
  not re-key or restructure them here.

## Slice T8: Long-Tail Consumers

Status: Not started.

Intent, grouped by capability:

- Media: `useRemoteImage`, `LocalMediaModal`, `FileViewer` switch from
  `isRemoteMode()` to `capabilities.sameOriginUrls` + `transport.fetchBlob`.
- Uploads: upload call sites go through `runtime.transport`; the
  `api/upload.ts` singleton guard moves under the localhost transport.
- Emulator: `useEmulatorStream` uses `capabilities.device`.
- Speech: `VoiceInputButton` uses `capabilities.speech`.
- Diagnostics: `ClientLogCollector` gates on current transport status.
- `useConnection` becomes a deprecated shim over the current runtime's
  transport.

Acceptance:

- Grep shows no feature-code `isRemoteMode()` callers remain; media behavior
  verified in both builds; emulator path exercised per the device-control
  testing policy (emulator required — this slice touches device streaming).

Tripwires:

- `sameOriginUrls` is about URL addressability, not security posture; do not
  fold auth decisions into it.

## Slice T9: Delete The Globals

Status: Not started.

Intent:

- Remove the dual-write bridge, then delete: `setGlobalConnection`,
  `getGlobalConnection`, `isRemoteMode`, `whenConnectionReady`, the
  `connectionManager` singleton export, `getWebSocketConnection`,
  `directConnection`, and `DirectConnection` (absorbed by the localhost
  transport). `isRemoteClient` stays.

Acceptance (Definition of Done for the boundary):

- Grep-zero for every deleted symbol outside `lib/transport/` internals,
  `lib/connection/` implementation files, and tests.
- Full suite + e2e green in local and remote builds; parity suite green.

Tripwires:

- Do this only after T6–T8 land; each earlier slice must leave the legacy
  path intact so it stays individually revertable.

## Slice T10: Two-Server Coexistence Smoke

Status: Not started.

Intent:

- Behind a dev flag or E2E harness (not a product surface), run the primary
  server plus a second server (`PORT=4000 YEP_PROFILE=dev`) and mount two
  runtimes: the localhost source plus a `WebSocketSourceTransport` pointed at
  `ws://localhost:4001/api/ws` — the cheapest real second source (no relay,
  no SRP setup).
- Exercise: independent status snapshots; independent session/watch/activity
  streams for identical project/session ids; disposing one source leaves the
  other live; wake handling pings both attached sockets.

Acceptance:

- The smoke runs in CI or as a documented dev procedure; findings that fake
  runtimes could not catch are recorded here.

Tripwires:

- This is the minimal pull-forward of 051 Phase 8, not its replacement:
  relay concurrency (two `SecureConnection`s through the relay) and
  auth-failure isolation remain Phase 8 scope.

## Tests To Preserve Or Add

Preserve (and port to run against the facade where noted):

- `lib/connection/__tests__/ConnectionManager.test.ts`
- `lib/connection/__tests__/ConnectionManager.integration.test.ts` (port)
- `lib/connection/__tests__/ReconnectSubscriptions.test.ts` (port)
- `lib/connection/__tests__/whenConnectionReady.test.ts` (port to slot wait)
- `lib/connection/__tests__/SecureConnection.compatibility.test.ts`
- `hooks/__tests__/useSessionWatchStream.test.tsx`
- `lib/__tests__/sourceRuntime.test.ts`
- `lib/diagnostics/__tests__/ClientLogCollector.test.ts`

Add: the Behavior Parity Contract suite (topic doc table, one test per row),
managed-stream unit tests, slot-replacement tests, two-runtime isolation at
hook level, the 050 convergence regression, and the T10 smoke.

## Deferred Follow-Ups

Explicitly out of scope; each is a deliberate future slice:

- Fast-fail demand fetches when the manager has given up, instead of the 15s
  bounded wait.
- Per-source auth-required signaling (today 401s broadcast through the global
  `authEvents`).
- Transport-owned `lastEventId` tracking (managed stream owns it for now).
- Eliminating the `forceReconnect()`/`ensureConnected()` overlap race (050
  aggravation 2) — preserved, not widened, by this work.
- Suspension policy for non-current runtimes (skip wake pings, downgrade
  activity) per the topology topic's resource-cost section.
- Server-instance identity populating `SavedHost.serverInstanceId` so one
  logical server reached via direct and relay is one source.
