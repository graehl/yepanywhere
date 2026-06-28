# Zustand Client Summary Store

Status: In Progress.

Progress:

- [x] Add Zustand as the client store substrate.
- [x] Port the existing session collection store to Zustand with no intended UI
      behavior changes.
- [x] Preserve the existing session collection hook surface while the substrate
      changes.
- [x] Add initial selector identity and selected-record render-isolation tests
      before widening the store.
- [x] Add the initial project slice and feed `useProjects` / `useProject`
      snapshots into it.
- [x] Add the project-queue slice after the project slice is stable.
- [x] Move Sidebar Project Queue badges to store-owned queue/session
      decoration facts.
- [x] Move All Sessions Project Queue badges to store-owned queue/session
      decoration facts.
- [x] Move Inbox Project Queue badges to store-owned queue/session decoration
      facts.
- [x] Move session draft badges into store-owned local decorations.
- [x] Nest session entities and queries under `sessions`.
- [x] Migrate Inbox to feed snapshots plus store selectors.
- [ ] Audit and retire long-tail hooks that privately own row-like session,
      project, or queue data.

Latest update:

- 2026-06-28: Added `zustand` to the client and ported the existing
  session-collection external-store shell to a vanilla Zustand store. The public
  hook/reporting surface stayed intact, activity-bus subscriptions remain lazy,
  and selected-record hooks now use a record-level selector. Added focused tests
  for unchanged record identity and no rerender on unrelated record updates.
- 2026-06-28: Added a project summary slice inside the same Zustand-backed
  collection store. `useProjects` and `useProject` now keep their loading/error
  lifecycle local but report `/api/projects` and `/api/projects/:id` snapshots
  into the shared store, with stale-response protection for project records and
  project-list ordering.
- 2026-06-28: Added project queue summaries to the shared store. Existing
  `useProjectQueues` callers still own queue fetch/mutation lifecycle, but
  queue snapshots, mutation responses, and `project-queue-changed` events now
  feed store-owned queue records. Sidebar keeps the queue feed mounted for its
  visible projects and reads `Q` badges from a store selector of targeted
  existing-session ids.
- 2026-06-28: Migrated All Sessions cards to the same store-owned Project Queue
  decoration path. The page keeps a queue feed mounted for the current result
  projects and passes `hasProjectQueue` from the shared targeted-session
  selector into both visible and hidden-duplicate session cards.
- 2026-06-28: Renamed the widened store shell from the old session collection
  naming to `clientSummaryState` / `clientSummaryStore`. Session-specific
  record, query, and reducer helpers keep their names, but aggregate state and
  store APIs now use `ClientSummaryState` so the "no transcript/message data"
  boundary is explicit before Inbox and draft data are added.
- 2026-06-28: Migrated Inbox `Q` badges to the shared Project Queue decoration
  path. `InboxContent` keeps queue feeds mounted for the currently visible
  projects and reads targeted existing-session ids from the client summary
  store, matching Sidebar and All Sessions. Session draft badges were left for
  the next local-decoration slice.
- 2026-06-28: Moved session draft badge ids into client-summary local
  decorations. The store wrapper owns the mounted `draft-message-*`
  localStorage scan and tears down its storage listener plus 1s polling interval
  when no draft-decoration consumer remains. Sidebar, Inbox, and All Sessions
  now read draft badge ids from `useDraftSessionIds`; the new-session draft
  nav badge remains a separate form-level hook.
- 2026-06-28: Nested the original session collection state under
  `ClientSummaryState.sessions`. The session reducer and selector names stay
  session-specific, but the aggregate state shape now matches the documented
  `{ sessions, projects, projectQueues, localDecorations }` layout before Inbox
  tier membership is added.
- 2026-06-28: Migrated Inbox tier membership into the client summary store.
  `InboxContext` still owns remote readiness, loading/error, stable tier order,
  debounced refetch, and refresh controls, but accepted `/api/inbox` snapshots
  now report ordered tier ids plus partial session facts into the store.
  Existing consumers keep using `useInboxContext` while its row arrays are
  selected from shared summary state.

## Context

`006-client-session-collection-store.md` and
`024-session-collection-feed-hooks.md` moved Sidebar, Global Sessions, and
Recent Sessions toward a normalized session collection:

- feed hooks own fetch readiness, REST requests, pagination, loading, and error
  state;
- the collection owns session facts, observation timestamps, query ids, and
  derived projections;
- UI surfaces render rows from collection selectors, not hook-local arrays.

That fixed the first split-brain session bugs, but newer Project Queue work shows
the next consistency boundary:

- Project Queue `Q` badges are currently sidebar-only because only Sidebar maps
  project queue items back to targeted session ids.
- Inbox renders from `InboxContext`, but that context now selects rows from the
  shared client summary store instead of owning local row arrays.
- project data (`activeOwnedCount`, `activeExternalCount`,
  `projectQueueBlockingCount`) is fetched and cached by project hooks, not the
  collection.
- several surfaces need "what sessions/projects are active or blocking?" facts,
  and one-off hooks keep recreating partial views of the same server state.

The current hand-rolled external store proved the data model. Once it broadens
from sessions into projects, queues, inbox projections, and decorations, the
subscription plumbing itself becomes a risk. Zustand gives selector-oriented
React subscriptions without bringing in a request cache or a full Redux-style
framework.

## Decision

Use Zustand as the substrate for the coarse client summary store.

Do not use React Query as the canonical row/session/project source. React Query
could manage request lifecycle someday, but query-keyed HTTP caches would still
need to report every result into a normalized client store. The hard problem
here is not generic HTTP caching. It is reconciling REST snapshots, activity-bus
events, successful local actions, local-only draft facts, and remote-readiness
gates into one stable projection.

The first implementation should be boring: migrate the existing session
collection from `useSyncExternalStore` plumbing to Zustand while preserving
current behavior and most public hooks. Do not add project/queue features in the
same patch that changes the store substrate.

## Store Boundary

The store is a coarse client summary cache. It should contain:

- session summary records: title, project, provider, model, counts, ownership,
  activity, pending-input type, unread, star/archive metadata, hover excerpt;
- session query membership: all sessions, starred, project-filtered,
  search-filtered, recent/sidebar projections;
- project summary records: id, path, name, session counts, last activity,
  active counts, Project Queue blocking count;
- project queue summaries: queued/dispatching/failed item summaries by project;
- inbox tier membership as ordered session ids, when the inbox is migrated;
- lightweight session decorations derived from other summary slices, such as
  targeted Project Queue item count or draft presence.

The store should not contain:

- full session messages;
- raw JSONL or provider-native transcript payloads;
- rendered transcript display objects for a session detail page;
- streaming deltas or in-flight transcript chunks;
- composer text, form drafts, or attachment upload internals;
- large file contents or preview bodies;
- arbitrary per-page UI state such as selected filters, expanded panels, or
  scroll position.

Session detail pages can keep their heavier live transcript state local. They
may report summary facts into the store when those facts are useful elsewhere.

## Target Shape

The broader summary store keeps session, project, queue, and local-decoration
facts in separate slices without duplicating project facts on every session
record:

```ts
interface ClientSummaryState {
  sessions: {
    entities: Map<string, SessionSummaryRecord>;
    queries: Map<string, SessionQueryState>;
  };
  projects: {
    entities: Map<string, ProjectSummaryRecord>;
    queries: Map<string, ProjectQueryState>;
  };
  projectQueues: {
    byProject: Map<string, ProjectQueueSummaryState>;
  };
  inbox: {
    tiers: Record<InboxTier, string[]>;
    requestStartedAt?: number;
    fetchedAt?: number;
  };
  localDecorations: {
    draftSessionIds: Set<string>;
  };
}
```

Exact names can change during implementation. The important rule is ownership:
session facts live on session records, project facts live on project records,
and project-queue facts live in a project queue slice. Session-card selectors can
compose across slices to produce badges.

Example selector concepts:

```ts
useSessionRecord(sessionId);
useSessionQueryRecords(query);
useProjectRecord(projectId);
useProjectQueueSummary(projectId);
useSessionCardDecorations(sessionId);
```

Selectors should usually return existing records, primitive values, ordered ids,
or memoized arrays. Selectors that allocate fresh objects/arrays on every store
change are not acceptable for hot row surfaces.

## Feed Ownership

Feed hooks remain the right layer for request lifecycle:

- connection readiness, including remote secure-connection readiness;
- initial fetch, refetch, and pagination;
- loading and error state;
- request start timestamps used for stale-snapshot protection;
- reporting snapshots into the store.

The store itself should not know whether the client is local or remote. It
reduces snapshots and events that actually arrive.

Target feed shape:

```ts
const feed = useGlobalSessionsFeed(options);
const rows = useSessionQueryRecords(feed.query);
```

Feed hooks may return control state and query descriptors. They should not return
authoritative row arrays for UI rendering.

## Activity And Snapshot Inputs

The existing session collection already reduces:

- `session-created`;
- `session-updated`;
- `session-metadata-changed`;
- `session-status-changed`;
- `process-state-changed`;
- `session-seen`;
- `/api/sessions` snapshots.

The widened store should add:

- `/api/projects` and `/api/projects/:id` snapshots;
- `/api/inbox` snapshots, with tier ids and partial session upserts;
- `/api/projects/:projectId/queue` snapshots;
- `project-queue-changed` events;
- successful queue mutation responses;
- successful project/session metadata actions;
- draft localStorage scans or events, when draft badges are migrated.

Snapshots may fill missing fields, but must not overwrite field groups observed
from newer events or local successful actions.

## Performance Contract

Zustand removes the custom subscription plumbing, but it does not remove the
need for disciplined structural sharing.

Reducers/actions should:

- replace only changed record objects;
- replace only maps whose contents changed;
- keep query id arrays stable when membership and order did not change;
- preserve project queue arrays when a `project-queue-changed` event carries the
  same item summaries;
- avoid rebuilding all session rows when one activity field changes.

Selectors should:

- use `Object.is` equality by default;
- return existing record objects, primitive values, or stable arrays;
- use shallow equality only for deliberate small composite values;
- avoid inline allocation for hot list rows;
- prefer row components subscribing to their own record/decorations when list
  churn becomes measurable.

## Initial Migration Plan

1. [x] Add the Zustand dependency to `@yep-anywhere/client`.
2. [x] Port `clientSummaryStore` to a Zustand store module.
   - Keep `ClientSummaryState` and the pure reducer helpers initially.
   - Expose actions like `reportGlobalSessionsCollectionSnapshot`,
     `reportSessionCollectionCreated`, and
     `reportSessionCollectionMetadataChanged`.
   - Subscribe to the same activity-bus session events.
3. [x] Preserve existing public hooks where practical:
   - `useSessionCollectionRecord`;
   - `useStarredSessionRecords`;
   - `useRecentSessionRecords`;
   - `useOlderSessionRecords`;
   - `useSessionCollectionQueryRecords`;
   - `useSessionCollectionQueryState`.
4. [x] Verify Sidebar, Global Sessions, and Recent Sessions still behave the same
   beyond focused unit/type/lint coverage.
5. [x] Add initial tests for selector stability and selected-record render
   isolation.
6. [x] Add the initial project slice and route `useProjects` / `useProject`
   snapshots through it.
7. [x] Add project-queue snapshots/events and migrate Sidebar queue
   decorations.
8. [x] Migrate All Sessions queue decorations.
9. [x] Migrate Inbox session-card queue decorations.
10. [x] Migrate Inbox tier membership and partial row facts into the client
    summary store while keeping `InboxContext` as the feed/lifecycle owner.

## Follow-On Slices

After the no-behavior-change port:

1. Enrich `/api/sessions` or reduce project-queue events enough for Sidebar and
   All Sessions to show targeted queue badges without extra per-surface queue
   fetches.
2. Audit Agents, Projects, New Session, and Session Page for hook-local summary
   facts that should be store-fed instead.
3. Split purpose-built selectors out of broad context/store hooks for hot
   surfaces when row render churn becomes measurable.

## Verification Checklist

- Current client summary reducer tests still pass after the Zustand port.
- A stale `/api/sessions` snapshot cannot remove a session created by a newer
  `session-created` event.
- Starring and archiving still update sidebar/global projections immediately
  after successful local actions.
- A change to session A does not change session B's record object identity.
- A change to project A does not change project B's record object identity.
- A session row subscribed to session A does not re-render for an unrelated
  session B update.
- Query selectors keep array identity when ids and referenced records did not
  change.
- Remote relay feeds do not publish authoritative empty snapshots before the
  secure connection is ready.
- Project Queue `Q` badges show consistently on Sidebar, Inbox, and All Sessions
  once the queue/decorations slice is in place.

## Non-Goals

- Do not move transcript messages into the global store.
- Do not introduce React Query as part of this migration.
- Do not rewrite every data hook in the Zustand port.
- Do not make activity-bus events durable. REST snapshots remain the recovery
  path for missed events.
- Do not move page-local UI state into the store unless it is truly shared
  summary state.
