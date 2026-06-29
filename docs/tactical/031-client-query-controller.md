# Client Query Controller

Status: Proposed, Sidebar retainer landed 2026-06-28.

This note tracks the next data-fetching cleanup after the client summary store
work. The immediate forcing bug is Sidebar session coverage: after a browser
refresh on routes such as Agents, Sidebar can render only the subset of session
entities that its own small feeds happened to load; visiting All Sessions warms
the same normalized store and makes the missing rows appear.

The broader problem is the same class: many client hooks still own ad-hoc
`useEffect` fetch lifecycles, local in-flight refs, debounce timers, and
loading/error state. That makes it easy for route-local fetches to incidentally
populate shared summary state, and hard for a component to state "this surface
requires this data coverage" without duplicate requests.

The follow-up forcing bug was the same layer from another angle: Agents polled
`/api/processes?includeTerminated=true` every 30 seconds because it had no
shared retained-query revalidation path for phone wake, tab foreground,
reconnect, or session metadata changes. That belongs here, not in a separate
"live collection" abstraction.

## Progress

- 2026-06-28: Added the minimal client query controller scaffold and focused
  unit tests. No feed has been migrated yet, so there is no user-visible
  behavior change in this slice.
- 2026-06-28: Moved `useGlobalSessionsFeed` onto the controller. Global-session
  list requests now use coverage-aware dedupe, stats fetches use a separate
  query key, and rows still normalize into `clientSummaryStore`.
- 2026-06-28: Mounted Sidebar session feed coverage from `NavigationLayout`, so
  the app shell retains Sidebar's global and starred session queries
  independently of the visual Sidebar branch.
- 2026-06-28: Corrected Sidebar rendering to use retained query memberships
  for Starred, Recent, and Older sections instead of broad "all known entity"
  projections that varied with fetch completion order.
- 2026-06-28: Fixed the remaining active-session race by allowing older full
  session snapshots to backfill missing fields left by newer partial live
  updates. The timestamp guards still protect newer values, but no longer keep
  active starred records too incomplete for Sidebar row rendering.
- 2026-06-29: Folded the Agents/Inbox live freshness follow-up back into this
  controller plan. The next target is retained-query revalidation for
  processes/Agents, not a parallel live-collection hook.
- 2026-06-29: Added `useRetainedClientQuery` as the React-facing retained
  query revalidation layer and moved `useProcesses` onto it. Agents no longer
  uses a 30s poll; the process list now fetches after readiness, revalidates
  on retained wake/reconnect/session/process events, and patches custom titles
  immediately from `session-metadata-changed`.

## Context

`clientSummaryStore` is the canonical normalized cache for shared summary
facts. It owns session/project/queue/inbox records and query membership. Feed
hooks still own request lifecycle:

- source-key capture;
- remote connection readiness;
- REST requests;
- loading/error state;
- pagination;
- request-started timestamps;
- snapshot reporting into `clientSummaryStore`.

That split remains correct. The missing layer is a shared query controller for
feed lifecycle, so multiple mounted consumers can ask for the same source/query
coverage without each hook independently issuing a request.

The existing client has partial patterns, but no common query layer:

- `useProviders` has a module-level TTL cache and shared in-flight promise.
- `useVersion` coalesces non-fresh version requests.
- `useBackgroundRevalidation` has hook-local in-flight suppression and a
  minimum interval, but is intentionally narrow and background-only.
- `useSessionMessages` has specialized in-flight suppression, incremental
  merge, and dev-only warm loading for transcripts.
- `InboxContext` is close to a singleton feed owner, with debounced activity-bus
  refetches and store snapshot reporting.
- `useGlobalSessionsFeed`, `useProjects`, `useProjectQueues`,
  `useServerSettings`, `usePublicShareStatus`, and similar hooks are still
  largely mount/effect fetchers.

Server-side code already uses this vocabulary more rigorously: index services
and provider readers have in-flight maps, TTL caches, and invalidation rules.
The client needs a small version of that for shared summary/list/config data.

## Current Fetch Inventory

Audited 2026-06-28. This is the starting map for migration priority.

| Surface / hook | Endpoint shape | Current behavior | Query-controller fit |
| --- | --- | --- | --- |
| `useGlobalSessionsFeed` | `/api/sessions`, optional `/api/sessions/stats` | Source-scoped snapshot reporting, local loading/error, local debounce, local request sequence, no shared in-flight dedupe. `limit` is part of the query key, so 50-row Sidebar and 100-row All Sessions fetches do not satisfy each other. | First target. Needs coverage-aware rows and separate stats handling. |
| `useSidebarSessionFeeds` | two `useGlobalSessionsFeed` instances | Visual Sidebar owns unfiltered and starred fetches. Rows render from broad entity projections, so coverage is implicit and can be accidentally warmed by All Sessions. | Replace with an app-shell retainer plus shared global-session controls. |
| `useProjects` | `/api/projects` | Source-scoped snapshot reporting and activity-bus debounce, but hook-local `hasFetchedRef`, loading/error, and no shared in-flight dedupe. | Good second-wave target after global sessions. |
| `useProject` | `/api/projects/:id` | Source-scoped snapshot reporting, per-hook cancellation and debounce. Multiple consumers of the same project can duplicate fetches. | Second-wave target if repeated project detail fetches stay visible. |
| `InboxContext` | `/api/inbox` | Already close to a singleton feed owner. Handles readiness, stable tier ordering, source-scoped snapshot reporting, stale response protection, and debounced activity refetches. | Later migration only if the controller can preserve stable tier ordering cleanly. Not needed for Sidebar bug. |
| `useProcesses` | `/api/processes?includeTerminated=true` | Source-keyed process snapshot plus retained controller query. Revalidates on readiness, refresh/reconnect, process/session events, and patches metadata titles locally. Previously used hook-local rows plus a fixed 30s poll. | Completed first retained-revalidation target. A process summary store slice can wait. |
| `useProjectQueues` | `/api/projects/:id/queue` for each visible project | Source-scoped queue snapshots and mutation reporting, but each mounted consumer batches its own project ids and request lifecycle. Reconnect/refresh refetches are hook-local. | Good second-wave target. Needs per-project keying rather than one broad array key. |
| `useServerSettings` | `/api/settings` | Pure hook-local fetch/mutation state. Uses `useBackgroundRevalidation` for quiet reconnect/refresh updates. No source-key capture or shared in-flight cache. | Candidate after summary feeds, especially if settings become store-backed. |
| `useVersion` | `/api/version` | Module-level shared in-flight promise for non-fresh requests, but no source scoping and no retained cache entry. Pending speech backend polling is bespoke. | Maybe later. Existing dedupe is useful but source-blind in hosted remote scenarios. |
| `useProviders` | `/api/providers` | Module-level TTL cache and shared in-flight promise. No source scoping. | Maybe later. Existing shape is close to a generic query entry but must become source-aware first. |
| `usePublicShareStatus` | `/api/public-shares/status` | Hook-local fetch and optional 5s poll. Multiple mounted consumers can duplicate polling. | Candidate only if duplicate polling becomes noisy; keep out of first slice. |
| `useRecentSessions` | `/api/recents` plus mutations | Hook-local rows with optimistic local move/clear. Not currently normalized into `clientSummaryStore`. | Maybe later as a recent-visits membership slice; not needed for Sidebar bug. |
| `useSessionMessages` / `useSession` | `/api/projects/:projectId/sessions/:sessionId` plus stream endpoints | Specialized transcript logic: source-scoped dev warm cache, JSONL cursoring, stream buffering, replay dedupe, incremental message merge, older-page loading, pending-input/session metadata integration. | Deliberately not a controller target. Keep specialized. |

Findings:

- The original immediate bug was specific to global-session row coverage. That
  path now proves the query key, coverage, and Sidebar retainer shape.
- The next shared gap was retained-query revalidation. The controller can dedupe
  an `ensureClientQuery` call; `useRetainedClientQuery` is now the first
  React-facing layer that centralizes activity-bus refresh, reconnect,
  debounce, readiness, and forced refetch for a retained feed.
- Several hooks already solve one query-cache concern locally, but each solves a
  different subset: in-flight dedupe, TTL, debounce, stale response protection,
  or background revalidation.
- Some module-level caches (`useVersion`, `useProviders`) are not source-keyed.
  They are not the first bug, but a shared controller should avoid repeating
  that source-blind shape.
- Inbox is the most mature current feed owner. Treat it as a reference for
  source capture and stale response handling, but do not force its stable tier
  ordering through a generic abstraction prematurely.
- Transcript/session detail loading is intentionally outside the scope. Its
  merge and stream rules are endpoint-specific and load-bearing.

## Library Options

These libraries solve much of the generic server-state problem:

- TanStack Query: query keys, stale/fresh state, in-flight dedupe, background
  refetch, pagination, structural sharing, and cache garbage collection.
  Reference: https://tanstack.com/query/latest/docs/framework/react/overview
- SWR: a smaller stale-while-revalidate hook model with caching, revalidation,
  request deduplication, focus/reconnect behavior, and pagination helpers.
  Reference: https://swr.vercel.app/
- RTK Query: endpoint/parameter cache keys, subscription reference counts,
  request dedupe, cache lifetime, invalidation, and streaming update hooks.
  Reference:
  https://redux-toolkit.js.org/rtk-query/usage/cache-behavior

All three are credible options if YA's hand-built controller starts growing
into an underpowered reimplementation. Do not dismiss them on name familiarity
alone.

The first recommended step is still a small YA-owned controller. YA's hard part
is not only HTTP caching. REST snapshots, activity-bus events, successful local
mutations, source-scoped host caches, and field-group stale protection all feed
`clientSummaryStore`. An external query cache would still need adapters that
normalize every accepted result into the summary store, and would become a
second cache unless integrated carefully.

## Decision

Build a narrow client query controller for summary/list/config feeds.

Do not move transcript loading, stream state, or provider replay state into this
controller. Session detail loading already has bespoke rules around JSONL
cursors, stream buffering, replay dedupe, and incremental merges. Keep that
state local to `useSession`, `useSessionMessages`, and stream hooks.

The controller should be boring:

```ts
ensureQuery({
  sourceKey,
  key,
  coverage,
  staleTimeMs,
  fetch,
  applySnapshot,
});
```

It should provide:

- stable query-key serialization;
- source-key scoping;
- in-flight request sharing for identical or compatible coverage;
- fresh/stale timestamps;
- optional minimum refetch intervals;
- explicit invalidation;
- loading/error state selected by hooks;
- pagination or coverage metadata where the endpoint needs it;
- snapshot reporting into the appropriate store/action supplied by the caller.

It should not own canonical row objects for summary data. Accepted snapshots
still normalize into `clientSummaryStore`; UI rows still render from store
selectors.

## Coverage Model

The controller needs a concept of coverage, not only exact query identity.
Global sessions expose the problem clearly:

- Sidebar may need "unfiltered non-archived global sessions, at least 50 rows."
- Recent Sessions dropdown may need the same query, at least 15 rows.
- All Sessions may need the same query, at least 100 rows plus page controls.

A 100-row unfiltered fetch should satisfy a 50-row sidebar requirement for that
same source and filter shape. A 15-row dropdown fetch should not satisfy a
50-row requirement. `limit` is therefore partly coverage, not always a distinct
cache identity.

Suggested normalized shape:

```ts
interface QueryBaseKey {
  sourceKey: ClientSummarySourceKey;
  endpoint: "global-sessions";
  projectId?: string | null;
  searchQuery?: string;
  includeArchived?: boolean;
  starred?: boolean;
}

interface Coverage {
  minRows?: number;
  includeStats?: boolean;
  pagesLoaded?: number;
}
```

Stats should usually be separate from row coverage. `includeStats: true` should
not force a distinct row cache when the row query shape is otherwise identical.

## Sidebar Target

Sidebar should not rely on incidental store warming from All Sessions.

Introduce an app-shell retainer, likely under `NavigationLayout`, that ensures
Sidebar's session coverage while the app section is mounted. The visual
`Sidebar` component can remain collapsed, mobile-hidden, or temporarily absent;
the retainer still keeps the required query warm for the current source.

Target shape:

```tsx
function SidebarDataRetainer() {
  useGlobalSessionsQueryCoverage({
    minRows: SIDEBAR_SESSION_PAGE_SIZE,
  });
  useGlobalSessionsQueryCoverage({
    starred: true,
    minRows: SIDEBAR_SESSION_PAGE_SIZE,
  });
  return null;
}
```

The visual Sidebar keeps rendering from `clientSummaryStore` selectors and keeps
calling shared `loadMore` controls when the scroll container nears the end.

## Activity Bus Integration

The controller should not replace `activityBus`.

Activity events remain the fast path for local updates. The controller reacts to
events only for fetch-side lifecycle:

- mark relevant query keys stale;
- debounce reconciliation refetches;
- trigger a fetch on reconnect/refresh only when the query is retained and the
  connection is ready;
- avoid publishing authoritative empty snapshots before remote readiness.

Reducers and selectors remain in `clientSummaryState` / `clientSummaryStore`.
The controller should not duplicate session projection logic.

## Retained Query Revalidation

The controller core knows which queries are retained and can share in-flight
work. The React-facing revalidation layer tells retained feeds how to revalidate
when the app receives a wake, reconnect, mutation, or activity signal. Without
that layer, each hook rebuilds the same mechanics:

- local debounce timers;
- local readiness guards;
- local `activityBus` subscriptions;
- local force-refetch calls;
- local "do not flash loading over existing data" behavior.

Use a small React-facing layer on top of the controller. The first
implementation is `useRetainedClientQuery`:

```ts
useRetainedClientQuery({
  sourceKey,
  key,
  coverage,
  enabled,
  ready,
  staleTimeMs,
  revalidateOn,
  fetcher,
  applySnapshot,
});
```

The exact API can change, but the behavior should not:

- initial ensure runs once after `enabled && ready`;
- `refresh` and `reconnect` mark retained queries stale and schedule one
  debounced ensure;
- endpoint-specific activity events can invalidate or refetch matching query
  keys;
- no fixed polling interval is introduced;
- no request is started before the React-level readiness gate opens;
- `fetchJSON` remains the transport-level secure-connection wait;
- background revalidation errors preserve existing data and avoid loading
  flashes;
- unmounted entries do not keep timers, subscriptions, or server resources
  alive.

Local reducers still remain the fast path. For example, a
`session-metadata-changed` event should update any normalized session facts
immediately when it contains enough data, then invalidate retained server-owned
memberships only when membership or denormalized row fields may have changed.

## Mutations

Shared mutation helpers remain a separate but related track from
`030-client-summary-store-closeout.md`.

After a successful mutation:

- report the accepted fact into `clientSummaryStore`;
- invalidate query keys whose server-owned membership may have changed;
- refetch retained stale queries through the controller, not through every
  mounted component independently.

Examples:

- star/unstar changes starred query membership and derived Sidebar sections;
- archive/unarchive changes default non-archived query membership;
- mark read/unread affects inbox membership and unread filters/counts;
- project queue mutations update queue summaries and targeted-session badges.

## Implementation Chunks

### 1. Document Current Fetch Inventory

Status: Completed 2026-06-28.

Acceptance:

- clear list of first-class feeds vs deliberately-specialized hooks;
- no code behavior change.

### 2. Add A Minimal Query Controller Module

Status: Completed 2026-06-28.

Create a small client module, likely under `packages/client/src/lib/`, with
query entries keyed by source and normalized query key.

Initial capabilities:

- `ensureQuery(...)`;
- `invalidateQuery(...)` / `invalidateQueries(predicate)`;
- retained subscriber count;
- in-flight promise reuse;
- `fetchedAt`, `requestStartedAt`, and `error`;
- optional `staleTimeMs`;
- test reset helper.

Do not implement broad garbage collection, retries, persistence, or Suspense in
the first slice. Add those only after a concrete caller needs them.

Acceptance:

- two concurrent ensures for the same key/coverage call the fetcher once;
- a fresh entry satisfies a later ensure without network work;
- a larger coverage request fetches when a smaller cached coverage is
  insufficient;
- source keys isolate otherwise-identical queries;
- a late response writes through the source captured at request start.

### 3. Move Global Sessions Feed Onto The Controller

Status: Completed 2026-06-28.

Refactor `useGlobalSessionsFeed` so it asks the controller to ensure row
coverage and publishes accepted snapshots into `clientSummaryStore`.

Global sessions specifics:

- split base key from coverage (`limit`);
- keep stats separate from row coverage;
- keep `loadMore` based on query state ids and the last complete record until
  the server exposes an opaque cursor;
- preserve existing race policy based on `requestStartedAt`;
- keep event-created and metadata events reporting into the summary store.

Acceptance:

- Sidebar, All Sessions, and Recent Sessions do not issue duplicate initial
  requests for compatible global-session coverage;
- a 100-row All Sessions fetch satisfies the 50-row Sidebar need;
- a 15-row dropdown fetch does not block Sidebar from fetching 50 rows;
- mounted hooks still expose loading/error/refetch/loadMore controls;
- rows still come from `clientSummaryStore` selectors, never from hook-local
  response arrays.

### 4. Add Sidebar Data Retainer

Status: Completed 2026-06-28.

Mount a retainer in the navigation/app shell so Sidebar's required coverage is
ensured independently of the current page and visual sidebar state.

Acceptance:

- refreshing on Agents shows Sidebar session sections after the sidebar-retained
  queries resolve, without visiting All Sessions first;
- collapsed desktop Sidebar and closed mobile Sidebar do not disable data
  coverage for the mounted app shell;
- route-specific pages no longer need to warm the sidebar's data accidentally;
- no extra duplicate `/api/sessions` request when All Sessions is already
  retaining compatible coverage.

### 5. Move Agents Processes Onto The Controller

Status: Completed 2026-06-29.

Move `useProcesses` from a mount fetch plus 30s poll to a retained controller
query.

Process list specifics:

- add a process-list query key for `/api/processes?includeTerminated=true`;
- keep `useProcesses` local-state-backed in the first slice unless another
  surface needs process rows from `ClientSummaryState`;
- source-key the query so hosted/remote sources do not leak process rows;
- use retained-query revalidation for initial load, `refresh`, `reconnect`,
  `process-state-changed`, `session-created`, and session metadata/update
  events;
- patch custom titles locally from metadata events when the event carries
  enough data;
- fall back to a coalesced refetch when an event only identifies the affected
  session;
- remove `POLL_INTERVAL_MS` and `setInterval` from `useProcesses`.

Acceptance:

- [x] opening `/agents` performs one ready-gated process-list request;
- [x] StrictMode or multiple Agents consumers share the source-keyed process
  snapshot and controller query instead of owning independent poll loops;
- [x] backgrounding a tab or waking a phone causes at most one coalesced refresh
  after the connection is usable;
- [x] custom session titles appear on the Agents page without waiting for a timed
  poll;
- [x] existing rows stay visible during background revalidation failures;
- [x] no process-list request starts before remote secure-connection readiness.

### 6. Move Adjacent Summary Feeds Opportunistically

Status: Follow-on.

After global sessions and processes prove the controller shape, migrate only
feeds that get a clear simplification:

- Projects list and project details;
- project queues;
- inbox;
- server settings;
- version/provider catalog if their existing module-level caches can be
  replaced with the generic controller cleanly.

Acceptance:

- fewer hook-local `hasFetchedRef`, `inFlightRef`, and debounce implementations;
- existing store snapshot reporting remains source-scoped;
- no transcript/session-stream code moves into the query controller.

## Non-Goals

- Do not replace `clientSummaryStore`.
- Do not store full transcripts, stream deltas, rendered markdown, or composer
  state in the controller.
- Do not introduce polling loops as part of this cleanup.
- Do not adopt React Query/SWR/RTK Query in the first patch.
- Do not make the controller understand every endpoint on day one.
- Do not treat a short paginated response as proof that unrelated entities do
  not exist.

## Verification Checklist

- Refresh `/agents` and verify Sidebar no longer depends on visiting
  `/sessions`.
- Verify source switching in hosted remote mode does not leak prior-host query
  data.
- Verify late responses update the captured source, not the current source.
- Verify remote feeds do not publish empty snapshots before secure connection
  readiness.
- Verify activity-bus-created sessions remain visible through stale older
  snapshots.
- Verify Agents no longer polls, but still refreshes on tab foreground, phone
  wake, reconnect, and relevant process/session events.
- Verify Agents custom titles update from metadata changes or the next
  coalesced retained-query refresh.
- Verify star/archive/read mutations update store-backed surfaces immediately
  and invalidate retained server-owned memberships.
- Verify StrictMode or multiple mounted consumers do not double-fetch the same
  compatible query.
- Verify transcript/session detail flows still use their specialized merge and
  stream paths.
