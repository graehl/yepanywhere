# Project Queue

Status: In Progress.

Progress:

- [x] Define durable server-side project queue storage and lifecycle.
- [x] Add project-queue CRUD APIs.
- [x] Add shared API types, client wrappers, activity event type, and focused
      server tests.
- [ ] Add project-idle promotion logic with bounded scheduling.
- [ ] Show project queues on the projects page.
- [ ] Add an optional toolbar affordance, hidden by default.
- [ ] Add tests for idle gating, projects-page display, and UI visibility
      defaults.

Latest update:

- 2026-06-27: Landed the first server/API slice: `ProjectQueueService`
  persists `project-queues.json` with serialized mutations and atomic writes;
  malformed persisted items are ignored; `dispatching` items reload as queued;
  CRUD routes are mounted at `/api/projects/:projectId/queue`; mutations emit
  `project-queue-changed`; client API wrappers are available. Idle promotion
  and projects-page UI are still pending.

## Context

The current session queue is useful but scoped to one live session. A common
single-worktree workflow is broader:

- one project / worktree / branch is active at a time;
- several sessions in that project may be working or settling;
- the user has follow-up work ready, but wants it to start only after the
  project is fully idle;
- today the user waits, watches the project, and manually clicks send when it
  looks ready.

The requested feature is a **Project Queue**: a durable server-owned queue of
messages or new-session starts that deliver only after all sessions in that
project are idle. It should be visible and cancellable on the projects page,
and optionally available from the composer toolbar. It must not be implemented
as client-side localStorage or an invisible reminder.

Relevant standing contracts:

- `topics/vanilla-defaults.md` - YA-novel behavior is default-off / hidden.
- `topics/architecture-mandates.md` - idle sessions and closed tabs must not
  create unbounded or repeating server work.
- `topics/queued-messages.md` - queued-message state is server-authoritative.
- `topics/session-ui-customization.md` - advanced toolbar controls belong in
  toolbar visibility settings.
- `topics/session-liveness.md` - queue intent is not liveness evidence, and
  delivery decisions must use explicit idle/liveness gates.

## Product Decisions

- Name the feature **Project Queue**. Avoid "global queue" in UI copy because
  delivery is scoped to a project id, not the whole YA install.
- The queue is **durable server state**. It must survive browser refresh,
  closed tabs, and server restart.
- The queue is **visible where it matters**. The projects page shows queued
  items and supports edit, cancel/delete, and retry actions as they land.
- Toolbar access is **hidden by default**. Users can reveal it through
  Appearance -> Session Toolbar visibility. Showing a toolbar button does not
  change delivery defaults.
- Queued text remains **verbatim**. Project-queue delivery must not add prompt
  prefixes, elapsed-time markers, or hidden framing.
- Promotion is **one project-queue item per project-idle boundary** by default.
  Do not drain the full project backlog at once.
- Project queue is **not a replacement for per-session queueing**. Per-session
  queue continues to handle "after this session turn/boundary"; Project Queue
  handles "after this whole project is quiet."

## Data Model

Add a server-side `ProjectQueueService` backed by a JSON file in the YA data
dir, for example:

```text
{dataDir}/project-queues.json
```

Suggested item shape:

```ts
type ProjectQueueTarget =
  | {
      type: "existing-session";
      sessionId: string;
      provider?: ProviderName;
      mode?: PermissionMode;
      model?: string;
      serviceTier?: string;
      executor?: ExecutorSelection;
    }
  | {
      type: "new-session";
      provider?: ProviderName;
      mode?: PermissionMode;
      model?: string;
      serviceTier?: string;
      executor?: ExecutorSelection;
      title?: string;
    };

interface ProjectQueueItem {
  id: string;
  projectId: UrlProjectId;
  projectPath: string;
  target: ProjectQueueTarget;
  message: UserMessage;
  createdAt: string;
  updatedAt: string;
  createdFrom?: {
    sessionId?: string;
    client?: "toolbar" | "projects-page" | "new-session";
  };
  status: "queued" | "dispatching" | "failed";
  lastError?: string;
  lastAttemptAt?: string;
}
```

Notes:

- Store project ids as YA URL project ids. Do not substitute provider-native
  ids for public/session-facing ids.
- Store enough resolved target context that delivery after restart does not
  depend on a stale browser request.
- Store attachments only after they are uploaded to durable server storage. Do
  not persist browser `File` objects, blob URLs, or client-local references.
- Use atomic write semantics matching existing metadata/settings services.
- Serialize queue mutations in-process so concurrent CRUD requests cannot
  reorder or drop writes. A single YA server process owns the file.
- On startup, load the file before routes accept mutations and arm promotion
  checks for any non-empty project queues after the Supervisor is ready.

## API

Add project-scoped CRUD endpoints, mounted near existing project routes:

```http
GET    /api/projects/:projectId/queue
POST   /api/projects/:projectId/queue
PATCH  /api/projects/:projectId/queue/:itemId
DELETE /api/projects/:projectId/queue/:itemId
POST   /api/projects/:projectId/queue/:itemId/retry
```

These are the authoritative create/read/update/delete operations for the
feature. Clients should never mirror project-queue state in localStorage.

Response summaries should include:

- item id;
- target type and display label;
- message preview;
- created/updated timestamps;
- attachment count;
- status and last error;
- current project-idle blocking summary, if cheap to derive.

`POST` should support at least:

- queue message to an existing session after project idle;
- queue new session with an initial message after project idle.

`PATCH` can start narrow:

- update message text;
- update target session/new-session options when still queued;
- later: reorder.

All mutation routes should emit a project-queue event so open clients refresh
without polling.

## Idle Predicate

Project Queue can promote only when the project is fully idle. The first
implementation should use existing server-owned state, not per-session polling.

A project is blocked when any session in the project has:

- owned process ownership with active `state.type` of `in-turn` or
  `waiting-input`;
- owned idle process that is retaining provider work
  (`process.isRetainingProviderWork()`);
- owned process with direct queue depth or deferred queue depth greater than
  zero;
- pending input request;
- external ownership still tracked by `ExternalSessionTracker`;
- a worker/startup queue entry for that project.

A project can promote when all of the above are false and the state has stayed
quiet for a short grace period. Use the same spirit as patient queue:

- event-driven re-checks on process state, ownership, deferred-queue, session
  created/updated, external decay, and worker queue events;
- one-shot timers only while project-queue items exist;
- timers are cleared when the queue becomes empty;
- no per-session polling loop created by stale client state.

External-session idleness is best-effort because file activity decays after
`ExternalSessionTracker.decayMs`. UI copy should avoid promising perfect
knowledge of outside provider processes.

## Promotion Algorithm

When a project becomes eligible:

1. Load the first queued item for that project by creation order.
2. Mark it `dispatching` and persist.
3. Re-check the idle predicate immediately before dispatch.
4. Dispatch by target:
   - `existing-session`: use the normal session resume/queue path
     (`Supervisor.queueMessageToSession`) so model, permission, compaction, and
     provider handling stay centralized.
   - `new-session`: create the session and queue the first user message through
     the same create + queue flow used by `NewSessionForm`.
5. On success, remove the project-queue item and emit events for queue change
   and session creation/update.
6. On failure, persist `status: "failed"` with `lastError`, emit a queue
   change, and stop promotion for that project until the user retries or edits
   the item.

Only one item should be promoted per quiet boundary. Dispatching the first item
will normally create active project work, so the next item waits for the next
project-idle boundary.

## UI Surfaces

### Projects Page

Add a **Project Queue** section to `ProjectsPage`:

- show only projects with queued/failed items, plus an empty state when the user
  has explicitly opened the section;
- group items by project;
- show item target, preview, age, attachment count, and status;
- support editing queued/failed item text before retry or dispatch;
- show cancel/delete for queued and failed items;
- show retry for failed items;
- link target sessions when applicable;
- keep rows compact enough for mobile scanning.

Project cards should show a small queue count badge when a project has queued
or failed project-queue items. This makes queued work discoverable without
turning the projects list into a queue manager.

### Composer Toolbar

Add a separate optional control for **Send after project idle**:

- hidden by default in `DEFAULT_SESSION_TOOLBAR_VISIBILITY`;
- add a new visibility key such as `projectQueue`;
- exposed in Appearance -> Session Toolbar visibility and the toolbar preview;
- visible only when a current `projectId` is known and the user can submit
  message text;
- works while a session is busy or idle, because the point is project-level
  scheduling rather than current-session queueing;
- opens a confirmation/menu when the target is ambiguous.

Avoid a split button as the only mobile path. A dedicated icon button with a
clear tooltip/aria label is easier to discover and tap.

### New Session

`NewSessionForm` should support **Start after project idle** when a project is
selected. This queues a `new-session` target rather than creating an idle
placeholder session immediately.

## Visibility And Defaults

Project Queue is YA-novel behavior. It must be hidden/default-off for new users:

- no toolbar button by default;
- no primary-send default change;
- no automatic conversion of normal sends into project-queue items;
- no hidden project queue when the user presses Enter.

The queue manager on the projects page may appear when queued items exist,
because accepted server work must be inspectable and cancellable. The ability
to show a creation affordance there should still be behind an explicit UI
choice or advanced entry point.

Configuration split:

- **Server behavior and queue contents** live on the server.
- **Toolbar visibility** follows the existing session toolbar visibility model:
  server `clientDefaults.sessionToolbarVisibility` supplies defaults, and
  browser-local explicit overrides may hide/show chrome.

## Non-Goals

- No client-local project queue mirror.
- No invisible scheduled sends.
- No cross-project global FIFO in the first slice.
- No automatic branch/worktree detection beyond the existing project id.
- No batching multiple project-queue items into one provider turn.
- No prompt rewriting or time anchors.
- No guarantee that external provider activity outside YA can be detected
  forever after file activity stops.

## Implementation Slices

### 1. Server Queue Core

- [x] Add `ProjectQueueService` with atomic JSON persistence.
- [x] Add item validation and summary helpers.
- [x] Add unit tests for add/list/update/delete, restart persistence, and
      corrupt file recovery behavior.

### 2. APIs And Events

- [x] Add CRUD routes under `/api/projects/:projectId/queue`.
- [x] Add `project-queue-changed` EventBus event.
- [x] Forward the event through the existing activity stream.
- [x] Add client API methods.
- [ ] Add a `useProjectQueue` hook for UI consumers.

### 3. Idle Gate And Promotion

- Add event-driven project-idle evaluation to the server.
- Reuse existing process, external tracker, worker queue, and deferred-queue
  signals.
- Add bounded one-shot scheduling only while queue items exist.
- Dispatch through existing create/resume/queue paths.
- Persist failed dispatches instead of dropping items.

### 4. Projects Page UI

- Add a project queue section and project-card count badges.
- Support cancel/delete and retry.
- Keep copy i18n-ready through `useI18n().t(...)`.
- Verify on a narrow viewport.

### 5. Composer And New-Session Entry Points

- Add the `projectQueue` toolbar visibility key, default false.
- Add the optional toolbar icon/button and preview wiring.
- Add project-queue submission from `MessageInput`.
- Add `Start after project idle` from `NewSessionForm`.

## Tests

Server:

- queue items persist across service re-instantiation;
- list is scoped by `projectId`;
- delete removes only the addressed item;
- invalid project/session ids are rejected;
- first queued item promotes only when project-idle predicate is true;
- active owned process blocks promotion;
- retained provider work blocks promotion;
- per-session deferred queue blocks promotion;
- external ownership blocks until decay/removal;
- failed dispatch stores `failed` state and does not drop the item;
- retry returns failed item to queued/dispatchable state.

Client:

- projects page renders queue summaries and action buttons;
- project-card queue count updates after a queue event;
- toolbar project-queue control is hidden by default;
- Appearance settings can reveal the toolbar control and preview;
- submitting through the toolbar calls the project-queue API, not localStorage;
- new-session project-queue submission creates a `new-session` queue item.

Manual:

- start two sessions in one project, queue a project item, confirm it waits;
- let both sessions finish, confirm exactly one item starts;
- refresh browser while queued, confirm the projects page still shows it;
- restart server while queued, confirm the item survives;
- cancel a queued item from another tab and confirm all tabs update;
- verify mobile projects page and toolbar tap targets.
