# Forked recap lifecycle

> Server-side lifecycle of the `fork` recap strategy: how a forked
> away-recap request is gated, deduped, deferred while the parent is
> busy, and cancelled when the parent becomes active again.

This is the supervisor-level companion to [recaps.md](recaps.md), which
owns the product contract (what a recap is, the on-wire `away_summary`
shape, the native/tailed/forked modes, and the no-extra-turns / no-persist
invariants). Read recaps.md first; this doc is only the worker lifecycle
for the high-fidelity fork path, plus the currently-known gaps.

See also: [side-session-config.md](side-session-config.md) (shared helper
config), [fork-from-turn.md](fork-from-turn.md) (the fork-after-summary
strategy this reuses), [session-hovercard-recent-activity.md](session-hovercard-recent-activity.md)
(where an emitted recap surfaces as the session's current agent line).

## Recap modes (recap of recaps.md)

`RecapMode` ∈ `off | native | side-session | fork`. The UI labels them
**Off / Native / Tailed / Forked** (`side-session` == "Tailed"). Dispatch
is by mode in `Supervisor.requestRecap` (`Supervisor.ts:3059`):

- `fork` → `Supervisor.requestForkedRecap` (this doc).
- `native` / `side-session` / `off` → `Process.requestRecap`
  (`Process.ts:1593`): `off` declines; `native` returns
  "provider-owned" (the provider emits its own `away_summary`, YA does
  not synthesize); `side-session` runs the cheap recent-text helper,
  guarded by a `recapInFlight` boolean (`Process.ts:446`).

## Lifecycle contract (fork path)

The forked path creates an archived/hidden generator fork, runs one
helper turn there via `provider.generateSummary({strategy:"fork", …})`,
and emits only the resulting text as a synthetic `away_summary`. The
supervisor must uphold:

1. **At most one fork worker per process.** A second concurrent request
   while one is in flight is refused with reason "recap already in
   flight" (`requestForkedRecap`, `Supervisor.ts:2098`).
   **Accepted limitation:** keyed by **process id**, not session id. A
   replaced/reactivated process for the same session would not see the
   prior in-flight flag. This is acceptable — one live process per
   session in practice — and will not be changed.

2. **Never start a fork while the parent is mid-turn.** If
   `process.state.type === "in-turn"` at request time, the request is
   *deferred* (`pendingForkedRecapRequests.set`, `Supervisor.ts:2106`)
   and flushed when the parent next returns to `idle`
   (`flushPendingForkedRecapRequest`, called from the state-change
   handler at `Supervisor.ts:3374`).

3. **Cancel an in-flight/deferred fork when the parent turns active.**
   `forkedRecapInFlight: Map<processId, AbortController>`
   (`Supervisor.ts:510`); the controller's `signal` is passed into
   `generateSummary` (`Supervisor.ts:2124`+call). On a parent transition
   to `in-turn` the handler calls `cancelInFlightForkedRecap`
   (`Supervisor.ts:3379`), which aborts the generator-fork helper turn
   and drops any not-yet-started deferred request
   (`Supervisor.ts:2193`). Process teardown also aborts
   (`unregisterProcess`, `Supervisor.ts:3470`). An aborted generation is
   reported as "cancelled by new activity", not logged as a failure
   (`Supervisor.ts` catch in `requestForkedRecap`).

4. **Suppress empty recaps.** No recent assistant text since the user
   left ⇒ no recap (`getRecentAssistantText`, `Supervisor.ts:2110`-ish).

The provider honours the abort: `generateForkBackedSummary`
(`claude.ts:1106`) wires `request.signal` to an `AbortController` plus a
60 s `SUMMARY_TIMEOUT_MS` hard cap (`claude.ts:1117-1125`).

## Trigger model (where "away" is decided)

There is **no server-managed idle timer.** The trigger is **client tab
visibility**: `useSession.ts:643` records `hiddenSinceMs` on
`document.visibilitychange` hidden, and on return POSTs
`/api/processes/:id/recap` (`processes.ts:191` →
`Supervisor.requestRecap`) iff hidden ≥ `RECAP_AWAY_THRESHOLD_MS` and not
within `RECAP_REQUEST_COOLDOWN_MS`. Both are **hard-coded constants** in
`useSession.ts:51-52` (5 min away, 30 s cooldown). The server *does*
track per-session last activity — `updatedAt` from JSONL `stats.mtime`
(`reader.ts:323`, cached in `SessionIndexService`); that is the source of
the "4m ago" hovercard line — but nothing on the server fires a recap
from it.

## Status and remaining gaps

- **Done:** dedup (1), in-turn deferral (2), cancellation-on-activity
  (3), empty suppression (4). Cancellation landed in
  "Cancel in-flight forked recap when the parent turns active".
- **Gap — configurable idle threshold.** The away threshold is a fixed
  client constant. Intended: a per-new-session "recap within _ s"
  control in/under the Recap new-session block, plumbed to the trigger
  (and surfaced/overridable like other recap config). See the active
  task handoff in `tasks/` for the plan.
- **Gap — server-driven trigger (optional).** The visibility-based
  client trigger only fires on tab hide→show, not on general inactivity
  while the tab stays focused. A server idle trigger off the existing
  activity timestamp is possible but not required for the threshold
  control; treat as a separate decision.

## Tests that should fail on regressions

- Two concurrent fork requests for one process ⇒ at most one generator
  fork created.
- A fork request while `in-turn` does not start a generator until idle.
- A parent turn starting mid-generation aborts the generator turn (no
  late `away_summary` emitted after the new turn began).
- A recap with no assistant output since the user left emits nothing.
