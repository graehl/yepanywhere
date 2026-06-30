# Project Queue

Topic: project-queue

Project Queue is a durable, server-owned backlog for work that should start
only after a whole project becomes quiet. It is project-scoped, not global
across the YA install, and it is separate from the existing per-session queue.

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
- Project Queue promotion requires the project to remain idle for a short grace
  window, then re-checks project idleness immediately after claiming the item.
- Promotion handles one Project Queue item per project-idle boundary. Do not
  drain the project backlog in one burst.
- A global Project Queue dispatch pause gates promotion above all project
  items. Paused items remain editable/retryable/deletable; the scheduler simply
  must not claim queued items until dispatch resumes.
- A server restart with persisted Project Queue backlog starts
  paused-after-restart by default. The user must explicitly resume dispatch
  after inspecting any work that may have been interrupted by the restart.
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

## Project Idle Predicate

A project is not idle while any owned session in that project has:

- active `in-turn` or `waiting-input` state;
- retained provider work while otherwise idle;
- direct provider queue depth greater than zero;
- deferred queue depth greater than zero;
- pending input;
- liveness other than `verified-idle`.

A project is also not idle while it has a worker/startup queue entry or known
external session ownership. External ownership is best-effort and can decay;
UI copy must not promise perfect detection of all outside provider activity.

## UI Semantics

The toolbar affordance is YA-novel behavior, so it is hidden/default-off unless
the user opts into showing the Project Queue button.

Project Queue UI must also be capability-gated on `/api/version` advertising
`projectQueue`. Treat missing capabilities as unsupported so newer remote
clients do not show Project Queue entry points against older servers.

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
