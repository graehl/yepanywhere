# Project Queue

> Project Queue is a durable, server-owned backlog for work that should start
> only after a whole project becomes quiet.

Topic: project-queue

It is project-scoped, not global across the YA install, and it is separate from
the existing per-session queue.

This topic describes the current single-lane model: one project checkout is
treated as the scheduling unit. [`workstreams.md`](workstreams.md) describes
a proposed lane-aware extension where Project Queue items can target a
specific lane — the canonical main checkout or a separate lane checkout —
instead of waiting for the whole project.

## Core Semantics

- Project Queue items are persisted on the server. Clients must not mirror the
  queue in localStorage or hold invisible scheduled sends.
- Queue targets are either an existing YA session id or a future new session in
  a project.
- Delivery never rewrites user text with hidden prompt framing, elapsed-time
  markers, or automatic anchors.
- A normal session queue is lower-level than Project Queue. Existing in-turn
  work, direct provider queue depth, deferred queue depth, pending input, and
  retained provider work must all drain before a Project Queue item promotes.
- Project Queue promotion requires the project to remain idle for the configured
  project-quiet window, then re-checks project idleness immediately after
  claiming the item.
- Promotion handles one Project Queue item per project-idle boundary. Do not
  drain the project backlog in one burst.
- A global Project Queue dispatch pause gates promotion above all project
  items. Paused items remain editable/retryable/deletable; the scheduler simply
  must not claim queued items until dispatch resumes.
- A server restart with persisted Project Queue backlog starts
  paused-after-restart by default. The user must explicitly resume dispatch
  after inspecting any work that may have been interrupted by the restart.
- Dev-mode scheduled safe restart also pauses Project Queue dispatch before
  waiting for active sessions and in-memory session queued messages, including
  per-process direct/short-term deferred queues, to drain. Live patient
  session-queue entries are preserved as restart-paused work once those
  volatile blockers have drained. The durable Project Queue backlog survives
  the restart and remains visibly paused until the user resumes it. Persisted
  recovered patient session-queue entries are reported as preserved work in
  safe-restart status rather than as drain blockers, but they still count as
  project-busy for Project Queue promotion so project-level work cannot jump
  ahead of restart-paused per-session work.
- Empty Project Queue state is always normal/running. Do not preserve a hidden
  pause after the last queued/failed/dispatching item leaves the queue.

The intended ordering is:

1. Active provider turn.
2. Per-session direct queue.
3. Per-session deferred/patient queue according to its own rules.
4. Verified project idle.
5. One Project Queue item.

This means a session with five normal queued messages should finish those
messages before Project Queue starts. Project Queue is not a competing second
queue on the same session; it is a project-level backlog that injects only
after all lower-level work in the project is done.

## Quiet Window

Project Queue's quiet window is a user-interaction patience setting, not a
replacement for the idle predicate. Per-session direct/deferred/patient queues,
pending input, active provider turns, retained provider work, worker queue
entries, and known external ownership still block Project Queue absolutely.
Once those blockers clear, the project must stay clear for the quiet window
before one Project Queue item may promote.

Queue status must be server-computed. Project Queue responses expose each
project's scheduler state (`blocked`, `waiting-quiet`, `ready`, `dispatching`,
`paused`, or `empty`), the configured quiet window, the next eligible timestamp,
and raw blocker strings. The client may format that state as "waiting for quiet"
or "blocked by ..." copy, but it must not infer idleness from stale local
session rows.

Blocked automatic attempts must stay live. If a quiet-window timer fires while
absolute blockers remain, the scheduler keeps a bounded retry armed while
backlog remains so decaying liveness or external-ownership evidence cannot leave
the Project Queue inert forever.

The configurable range is 0-300 seconds, default 30 seconds. A value of 0 means
"promote as soon as the project idle predicate is true", while still performing
the immediate post-claim idle re-check. The effective minimum is therefore the
time required for lower-level queues to actually drain plus the configured
Project Queue quiet window; Project Queue must not rely on the patient-queue
safety margin as its only protection against launching too early.

## Project Idle Predicate

A project is not idle while any owned session in that project has:

- active `in-turn` or `waiting-input` state;
- retained provider work while otherwise idle;
- direct provider queue depth greater than zero;
- deferred queue depth greater than zero;
- pending input;
- liveness other than `verified-idle`.

A project is also not idle while it has a worker/startup queue entry or known
external session ownership. Project Queue promotion also treats persisted
`paused-after-restart` patient session-queue entries in the project as
not-idle, even when no live process currently owns those entries. External
ownership is best-effort and can decay; UI copy must not promise perfect
detection of all outside provider activity.

## UI Semantics

The toolbar affordance is YA-novel behavior, so it is hidden/default-off unless
the user opts into showing the Project Queue button.

Project Queue UI must also be capability-gated on `/api/version` advertising
`projectQueue`. Treat missing capabilities as unsupported so newer remote
clients do not show Project Queue entry points against older servers.
Hosted remote clients must additionally require the current remote
compatibility generation, because early Project Queue-capable source checkouts
predate the compatibility marker and can expose partial Project Queue behavior
to newer hosted clients.

When the button is visible by user preference, the UI should still suppress it
when Project Queue adds no useful semantics:

- Hide when the project is fully idle, has no Project Queue backlog, and normal
  send/start is equivalent.
- Hide when the only active thing is the current session and it has no
  server-visible normal queued/deferred backlog; normal queue is enough.
- Show when the current session already has normal queued/deferred work,
  because Project Queue then means "after this session backlog drains."
- Show when any other session, external session, or worker queue entry in the
  project is active.
- Show when the project already has Project Queue backlog, so a normal send or
  start does not accidentally jump ahead of accepted queued project work.

New-session Project Queue follows the same rule: hide when the selected project
is idle and has no Project Queue backlog; show when the project has active work
or existing Project Queue backlog.

The new-session initial-turn composer is part of the Project Queue contract.
When it queues a new session, the durable prompt/copy source is the text
accepted from that composer, because that is what the user typed (including
slash-command arguments). The promoted session should persist that text as its
initial prompt and derive its title/display fallback from that saved prompt.
Known gap: the initial-turn composer currently has no Project Queue button, so
a user can queue later work from an existing session but cannot queue "start
this new session after the project backlog drains" at the moment they write the
initial turn. The missing affordance should reuse the same Project Queue target
shape (`target.type === "new-session"`) and the same visibility rules above,
not a separate client-held draft queue.

UI visibility should use both exact active session ids, when available, and
project-level Project Queue blocking-count summaries. The count fallback covers
cases such as a fresh client after server restart where a project has
queue-blocking work but the current session composer has not yet seen every
active sibling session in its local inbox tiers. Do not derive this fallback
from owned-process counts alone; idle retained YA processes should not expose
the advanced Project Queue action.

When the Project Queue action is visible and the Project Queue Ctrl+Enter
preference is enabled, Ctrl+Enter submits through Project Queue instead of the
regular per-session alternate action. This binding applies to both existing
session composers and the new-session composer. It is intentionally conditioned
on the same availability as the visible Project Queue button, so hiding or
disabling Project Queue cannot silently steal Ctrl+Enter from regular
queue/steer behavior.

## Inline Rendering

Session views should render Project Queue items that target the current session
inline near the existing queued-message UI. Use the Project Queue purple action
color, not the normal per-session queue color. Each inline item should display
its Project Queue position within the project backlog so users can distinguish
local session queue order from project-wide queue order.

Inline rendering is a visibility and cancel mirror for items that target the
current session. The projects page remains the authoritative queue manager for
cross-project inspection, edit, and retry.

The projects page is also the authoritative global dispatch pause surface. Show
Pause/Resume only while Project Queue has visible backlog. When dispatch is
paused after server restart, copy must distinguish that state from a manual
pause so users understand why durable backlog is not promoting automatically.
Destructive item removal should use Delete/Remove wording, not Cancel, because
it permanently removes the persisted queue item.

Each item on the projects page may offer a Start now control. Start now skips
only the remaining quiet-window countdown; it still refuses when dispatch is
paused, another item is already in flight for that project, or the project idle
predicate reports blockers. When blockers remain visible, the same item may
offer an explicit Force start control. Force start is an override of the idle
predicate, not of dispatch pause or per-project in-flight protection, and the UI
must surface the blockers before making that override available.

When recovered `paused-after-restart` patient session-queue entries exist, the
projects page should show them above Project Queue items because they run first
and block Project Queue promotion. This is a read-only overview grouped by
session and linked back to the session page; resume/delete controls remain on
the session surface until project-level queue management is intentionally added.

## Attachments

Existing-session Project Queue items may contain already uploaded attachment
references because the session id and upload destination exist at compose time.

New-session Project Queue cannot safely support attachments until durable
pre-session attachment staging exists. Today, new-session attachments upload
after a real session is created, into storage scoped to that session. A queued
new session does not have that durable session upload destination yet. The
client also cannot persist browser `File` objects, blob URLs, or in-flight
upload handles in the server queue file.

The missing capability is a server-owned staging area for attachments before a
session exists. The current tactical plan is
`docs/tactical/028-pre-session-attachment-staging.md`: upload pre-session files
to a temporary YA data-dir staging area, persist only server-owned staged
references in new-session Project Queue items, and materialize those files into
the normal final session attachment destination when the queued new session is
promoted.
