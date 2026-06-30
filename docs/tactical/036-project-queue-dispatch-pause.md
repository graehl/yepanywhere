# Project Queue Dispatch Pause

Status: Safe restart chunk implemented locally.

Progress:

- [x] Capture desired semantics for global Project Queue pause/resume.
- [x] Persist a global dispatch pause state with restart-aware startup behavior.
- [x] Gate Project Queue scheduler promotion while paused.
- [x] Expose pause/resume APIs.
- [x] Add Projects page pause/resume controls.
- [x] Rename destructive Project Queue item removal from Cancel to Delete.
- [x] Add focused service, scheduler, route, and client tests.
- [x] Update durable Project Queue topic docs.
- [x] Scope scheduled graceful backend restart as a follow-up chunk.
- [x] Add dev banner `Restart When Safe` action.
- [x] Wait for active sessions and in-memory session queued messages to drain.
- [x] Report drain blockers in the reload banner.

Latest update:

- 2026-06-30: Scheduled safe restart implemented for dev/manual reload mode.
  Blocked backend reload banners now offer `Restart When Safe`; scheduling
  pauses Project Queue dispatch, waits for active provider sessions and
  in-memory session queued messages to drain, reports the blocker counts in the
  banner, and then uses the existing backend restart path.
- 2026-06-30: First implementation chunk landed locally. Project Queue dispatch
  state is persisted, non-empty queues loaded after restart become
  paused-after-restart, empty queues normalize back to running, pause/resume is
  exposed through global API routes and the Projects page, destructive Project
  Queue removal copy now says Delete, and focused plus full workspace tests pass.
- 2026-06-30: Tactical doc opened from discussion. The intended first slice is
  a persisted global dispatch gate above Project Queue items: a server restart
  with persisted backlog starts paused-after-restart instead of immediately
  promoting the next item, and the Projects page provides the visible
  pause/resume surface.

## Context

Project Queue items are already durable server state in
`{dataDir}/project-queues.json`. That is useful, but it also means a backend
restart can load a non-empty queue and immediately resume automated dispatch
before the user has inspected or manually restarted sessions that were active
before the restart.

The desired behavior is conservative: durability should preserve user intent,
not turn restart into an implicit "continue automation now" action.

Relevant standing contracts:

- `topics/project-queue.md` - Project Queue is durable, project-scoped, and
  promotes only after lower-level work drains.
- `topics/architecture-mandates.md` - background schedulers must have bounded
  ownership and teardown.
- `topics/vanilla-defaults.md` - YA-novel behavior must be visible and
  unsurprising.

## Product Decisions

- The pause is a **global Project Queue dispatch gate**, not an item status.
  Items remain `queued`, `dispatching`, or `failed`; pause controls whether the
  scheduler may claim queued items.
- Pause is only meaningful while backlog exists. If the queue becomes empty,
  dispatch state returns to normal running.
- Startup with persisted Project Queue backlog defaults to
  `paused-after-restart`, unless a manual paused state was already persisted.
- Startup with no Project Queue backlog starts in normal running state.
- Creating, editing, retrying, and deleting Project Queue items remain allowed
  while paused. Retry changes a failed item back to queued, but dispatch remains
  gated until resume.
- The Projects page is the authoritative global pause/resume surface.
- Destructive Project Queue item removal should say **Delete**, not **Cancel**.

## Data Model

Extend the existing Project Queue state file:

```ts
type ProjectQueueDispatchState =
  | { status: "running" }
  | {
      status: "paused";
      reason: "manual" | "restart";
      pausedAt: string;
    };

interface ProjectQueueState {
  version: number;
  items: ProjectQueueItem[];
  dispatchState?: ProjectQueueDispatchState;
}
```

Persistence rules:

- omit or normalize `running` state on disk if useful;
- clear paused state when `items.length === 0`;
- on startup with valid items and no persisted pause, set
  `{ status: "paused", reason: "restart", pausedAt: now }`;
- normalize stale `dispatching` items back to `queued` on startup as today.

## API

Add global Project Queue dispatch endpoints:

```http
POST /api/project-queue/pause
POST /api/project-queue/resume
```

Responses should include:

- `items` - global queue summaries;
- `dispatchState` - current global dispatch gate.

Project-scoped queue responses may also include `dispatchState` so existing
mutation responses can keep clients current.

## Scheduler

The scheduler should treat paused dispatch as "no dispatchable item":

- do not arm timers while paused;
- clear existing timers when pause is requested;
- resume should immediately schedule normal dispatch checks for all projects
  with queued head items;
- the normal verified-idle predicate is unchanged after resume.

## UI

On the Projects page Project Queue section:

- show `Pause` when backlog exists and dispatch is running;
- show `Resume` when backlog exists and dispatch is paused;
- show paused copy when `reason === "manual"`;
- show paused-after-restart copy when `reason === "restart"`;
- hide the entire section and return to normal running state when backlog is
  empty.

Do not expose a latent pause button for an empty queue; an empty queue should
not remember hidden paused state.

## Verification

- Service tests:
  - reloading non-empty queue pauses after restart;
  - manual pause persists across reload;
  - deleting/completing last item clears pause.
- Scheduler tests:
  - paused dispatch does not promote idle work;
  - resume schedules dispatch.
- Route tests:
  - pause/resume responses include dispatch state;
  - pause rejects an empty queue.
- Client tests:
  - Projects page/section shows Pause/Resume states;
  - delete label replaces cancel for Project Queue item removal.

## Follow-Up Chunk

The scheduled graceful backend restart chunk is intentionally dev/manual reload
only. It is exposed through the existing backend reload banner rather than a
general production lifecycle control.

Implemented behavior:

- `Restart When Safe` appears beside `Reload Anyway` only when a backend reload
  has active session or in-memory queued-message blockers.
- Scheduling pauses Project Queue dispatch with restart semantics so persisted
  backlog does not promote more automatic work while the restart is pending.
- The restart waits for both:
  - active provider sessions that would be interrupted;
  - in-memory session queued messages that would otherwise be lost, including
    supervisor worker-queue entries and live-process direct/deferred queues.
- The banner reports exact blocker counts and changes the safe-restart action
  to `Cancel Restart` while scheduled.
- When blockers drain, YA calls the same backend restart path used by
  `Reload Anyway`.

Out of scope for this chunk:

- Persisting the normal in-memory session queue across restarts.
- A production/server lifecycle manager.
- Draining or persisting arbitrary non-session background jobs beyond the
  existing worker activity signal.
