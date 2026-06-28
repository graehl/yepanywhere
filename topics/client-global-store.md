# Client Global Store

> YA's client global store is a coarse, normalized cache of server-visible
> summary state. It is the place UI surfaces read shared facts about sessions,
> projects, queues, and inbox membership. It is not a transcript cache.

Topic: client-global-store

See also:

- [`ui-architecture.md`](ui-architecture.md)
- [`project-queue.md`](project-queue.md)
- [`sidebar-session-ordering.md`](sidebar-session-ordering.md)
- [`../docs/tactical/025-zustand-client-summary-store.md`](../docs/tactical/025-zustand-client-summary-store.md)
- [`../docs/tactical/026-client-summary-long-tail.md`](../docs/tactical/026-client-summary-long-tail.md)

## Purpose

YA has several UI surfaces that render overlapping summaries of the same
underlying work:

- Sidebar;
- All Sessions;
- Inbox;
- Projects;
- New Session project chooser;
- Session Page composer affordances;
- Agents/process views.

When each surface fetches and caches its own row arrays, small feature work tends
to create inconsistencies: a badge appears in one place, a liveness hint appears
in another, and a stale response can undo a newer activity event. The global
store should be the center of gravity for shared summary facts so UI features
compose from the same records and projections.

The code uses the `clientSummary` name for this widened store shell. "Summary"
is intentional: it is a shared cache for coarse server-visible facts, not a home
for full session message data or provider transcript payloads.

## Boundary

The store owns coarse summary state:

- session summaries and query membership;
- project summaries and project list membership;
- project queue summaries;
- inbox tier membership;
- shared settings snapshots, once migrated;
- local lightweight decorations such as draft badges;
- observation timestamps for stale snapshot protection.

The store does not own heavy or page-local state:

- full messages;
- provider JSONL;
- streaming transcript deltas;
- rendered transcript bodies;
- composer text;
- upload progress internals;
- per-page filters, selection, expansion, and scroll state.

The Session Page can keep detailed live transcript state local while reporting
summary updates into the store.

## Source Model

The store is fed by multiple inputs:

- REST snapshots from sessions, projects, inbox, and project queue APIs;
- settings API snapshots and successful settings mutations, once migrated;
- activity-bus events;
- successful local actions such as star/archive/rename and queue mutations;
- local browser facts such as draft presence, where appropriate.

REST snapshots are authoritative for what they queried, but they are not allowed
to overwrite newer field groups observed from events or local successful
actions. Missed activity events are healed by later REST snapshots.

The activity bus remains the fast event transport. The global store does not
replace it and does not make events durable.

## Fetch Model

Feed hooks own fetch mechanics:

- remote connection readiness;
- pagination;
- loading and error state;
- request start timestamps;
- reporting snapshots into the store.

Store selectors own UI data:

```ts
const feed = useGlobalSessionsFeed(options);
const rows = useSessionQueryRecords(feed.query);
```

The UI should not render authoritative session/project row arrays returned
directly from data hooks. Feed hooks may expose query descriptors and controls;
selectors return the shared records/projections.

## Shape

The store should remain normalized:

```ts
{
  sessions: {
    entities: Map<sessionId, SessionRecord>,
    queries: Map<queryKey, SessionQueryState>
  },
  projects: {
    entities: Map<projectId, ProjectRecord>,
    queries: Map<queryKey, ProjectQueryState>
  },
  projectQueues: {
    byProject: Map<projectId, ProjectQueueSummaryState>
  },
  inbox: {
    tiers: Record<InboxTier, sessionId[]>
  }
}
```

Do not copy project facts onto every session. Compose them at selector time.
For example, a session card can read its session record, its project record, the
project queue summary, and local draft state to produce badges.

## Performance Contract

The store may be global internally, but components should subscribe narrowly.

Selectors should return stable values whenever the selected data did not change.
Hot row surfaces should not subscribe to the whole store. Updates should replace
only changed records and changed query membership arrays.

When new slices are added, add tests for:

- unchanged entity object identity after unrelated updates;
- unchanged query array identity when membership and record refs are stable;
- row render isolation for common list surfaces.

## Current Direction

The first widened-store step migrated the existing session collection substrate
to Zustand, then renamed the aggregate shell to `clientSummaryState` /
`clientSummaryStore` once project and queue slices made the older name too
narrow. The next slice added project summary records and project-list membership
to the same store, with `useProjects` and `useProject` feeding snapshots while
keeping request lifecycle local.

The next slice added project queue summaries. `useProjectQueues` remains the
feed/mutation hook, but queue snapshots, mutation responses, and
`project-queue-changed` events now reduce into the shared store. Sidebar keeps a
queue feed mounted for visible projects and reads `Q` badges from a store-owned
targeted-session selector.

All Sessions and Inbox now use the same Project Queue decoration path for
visible session cards. Session draft badges also read from client-summary local
decorations: the store wrapper owns the mounted `draft-message-*` localStorage
scan and tears down its storage listener plus polling interval when the last
draft-decoration consumer unmounts.

The original session collection fields are now nested under `sessions`, matching
the documented normalized shape.

Inbox tier membership now lives in the summary store as ordered session ids.
`InboxContext` remains the feed/lifecycle boundary for remote readiness,
loading/error, stable tier ordering, debounced refetch, and refresh controls,
but accepted `/api/inbox` snapshots report partial session facts plus tier ids
into the store. Existing consumers still read through `useInboxContext`, whose
arrays are selected from the shared store.

The next likely work is tracked in
[`026-client-summary-long-tail.md`](../docs/tactical/026-client-summary-long-tail.md):
audit long-tail hooks and pages that still own row-like session/project truth,
replace direct row returns with feed controls plus store selectors where
practical, and add narrower selectors for hot surfaces if broad context/store
subscriptions become noisy.
