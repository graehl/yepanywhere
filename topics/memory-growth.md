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
