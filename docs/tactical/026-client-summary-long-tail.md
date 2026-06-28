# Client Summary Long Tail

Status: Tracking.

This doc tracks the incremental cleanup after the client summary store became
the shared home for session, project, queue, inbox, and draft summary facts.
The goal is not to move every hook into the store. The goal is to make shared
summary facts come from one normalized client cache while keeping fetch
lifecycle, page UI state, and heavy transcript state in the right places.

Immediate prerequisite: the store must become source-scoped before more
long-tail migration. Hosted remote clients can switch between multiple backend
hosts in one tab, so a singleton summary cache can leak rows from one machine
into another machine's Sidebar or pages. The source-registry work is tracked in
[`027-client-summary-source-registry.md`](027-client-summary-source-registry.md).

## Target Invariant

Shared summary facts are read from `clientSummaryStore`.

In hosted remote mode, "shared" means shared within the current backend source,
not across every saved host. Current-source selectors must not render stale
records from the previous host while a new host is connecting or loading.

Feed hooks own:

- remote/local readiness gates;
- current summary source key capture;
- targeted REST requests;
- loading and error state;
- pagination and mutation control state;
- request start timestamps;
- reporting accepted snapshots and successful mutations into the store.

Store selectors own:

- session rows and query membership;
- project rows and project-list membership;
- project queue summaries;
- inbox tier membership and derived counts;
- lightweight local decorations such as draft badges;
- cross-slice projections used by shared UI surfaces.

UI surfaces should not render authoritative session, project, inbox, or queue
rows directly from a hook-local array when those rows represent shared summary
state.

## Store Boundary

Good store candidates:

- session summary records;
- project summary records;
- project queue item summaries;
- inbox tier ids and counts;
- active/needs-attention session ids by project;
- server settings and client defaults that multiple surfaces render or mutate;
- recent-visit membership, if composed with session/project summaries;
- local decorations whose value affects shared session cards.

Keep out of the store:

- full session messages;
- raw JSONL and provider transcript payloads;
- streaming transcript deltas;
- rendered transcript bodies;
- composer text and form drafts;
- attachment upload progress;
- page filters, selection, expansion, and scroll state;
- device video streams and emulator stream state.

Session detail pages may keep heavy live transcript state local while reporting
useful summary facts into the store.

## Fetch Shape

The store should not imply "fetch the largest endpoint everywhere." Prefer the
smallest endpoint that provides the facts a mounted surface needs, then normalize
that response into the store.

Examples:

- A nav badge that only needs active-agent presence should not permanently need
  full inbox rows if a narrower feed or endpoint exists.
- Project queue badges should read targeted session ids/counts from selectors;
  feed ownership can stay with a mounted `useProjectQueues(projectIds)`.
- Settings can be store-fed from `useServerSettings` snapshots and successful
  mutations even if activity-bus settings events do not exist yet.

Narrow endpoints are optional follow-on work. They should be added when the
current endpoint is measurably wasteful or makes ownership confusing.

## Current Surface Matrix

| Surface | Current source | Target source | Status |
| --- | --- | --- | --- |
| Sidebar sessions | `useSidebarSessionFeeds` feeds, store selectors render rows | Store selectors for rows, badges, counts; feeds return controls only | Mostly migrated |
| Sidebar inbox badge | `useInboxCounts()` selector | `useInboxCounts()` selector | Migrated |
| Sidebar queue/draft badges | Queue feed plus store selectors; draft selector | Store selectors | Migrated |
| All Sessions rows | `useGlobalSessionsFeed` plus store query selector | Store query selector | Migrated |
| All Sessions stats/filter options | Feed-local stats/project options from `/api/sessions` | Keep feed-local unless shared elsewhere | Acceptable |
| All Sessions bulk metadata | Direct API calls | Shared mutation helpers that report store updates | Pending |
| Inbox rows | `InboxContext` selects store rows | Direct selectors or compatibility context while feed remains mounted | Mostly migrated |
| Inbox queue/draft badges | Store selectors | Store selectors | Migrated |
| Projects page rows | `useProjects` feeds store project records | Store project selectors | Migrated |
| Projects page active/attention counts | `useInboxCountsByProject()` selector | `useInboxCountsByProject()` selector | Migrated |
| Projects page queue counts | `useProjectQueues` return data | Store queue count selectors | Pending |
| New Session project chooser | `useProjects`, `useProject`, `useRecentSessions` | Store project selectors; possible recent-visit slice | Partial |
| New Session queue visibility | `useActiveProjectSessionIds()` plus queue hook data | active-session and queue selectors by project | Partial |
| Session Page transcript | `useSession`, `useSessionMessages`, streams | Keep local; report summary facts as needed | Keep local |
| Session Page project queue affordances | `useActiveProjectSessionIds()` plus queue hook data | active-session and queue selectors by project | Partial |
| Session Page metadata actions | Direct API calls and local state | Shared mutation helpers that report store updates | Pending |
| Agents nav badge | `useGlobalActiveAgents` wrapper over store selector | Active-agent selector | Migrated |
| Agents page process rows | `useProcesses` polling | Keep feed-local or future `processes` slice | Open |
| Settings pages/hooks | Independent settings hooks | Candidate `settings` slice fed by snapshots/mutations | Open |

## Long-Tail Work Items

### Inbox-Derived Selectors

Priority: High.

Add purpose-built selectors/hooks for facts currently pulled through broad
`useInboxContext`:

- `useInboxCounts()`;
- `useInboxCountsByProject()`;
- `useActiveProjectSessionIds(projectId)`;
- `useHasActiveAgents()` or `useActiveAgentCount()`.

Candidate consumers:

- `AgentsNavItem` / `useGlobalActiveAgents` (migrated);
- `useNeedsAttentionBadge` (migrated);
- Sidebar inbox badge (migrated);
- `ProjectsPage` (migrated);
- `NewSessionForm` (migrated for active session ids);
- `SessionPage` (migrated for active session ids).

Expected result: fewer independent `api.getInbox()` calls and fewer broad
context subscriptions for components that only need counts or ids.

### Project Queue Selector Cleanup

Priority: High.

`useProjectQueues(projectIds)` should remain a feed/mutation hook, but UI should
avoid relying on its returned row data for shared display facts when a selector
can express the same thing.

Useful selectors:

- queue item count by project;
- blocking/visible queue item count by project;
- targeted existing-session ids by project;
- queue presence for a single session.

Candidate consumers:

- Sidebar;
- All Sessions;
- Inbox;
- Projects page;
- New Session;
- Session Page.

### Metadata And Seen Mutation Helpers

Priority: Medium.

Several surfaces call session metadata/read APIs directly:

- `SessionListItem`;
- `GlobalSessionsPage` bulk actions;
- `SessionPage` title/star/archive/read actions;
- engagement/read tracking hooks.

Introduce shared client action helpers for successful mutations:

- update session metadata and report `session-metadata-changed`;
- mark session seen and report store unread state;
- mark session unread and report store unread state, if no activity-bus event
  exists for that path;
- project add/delete helpers that report project-list changes when possible.

Expected result: all shared surfaces update immediately after successful local
actions, without waiting for a later REST snapshot.

### Settings Slice

Priority: Medium-low.

Settings are coarse, shared, and consistency-sensitive enough to belong in the
client summary store eventually. They are lower urgency than live session data
because they change less often and are not currently activity-bus fed.

Candidate state:

- server settings;
- client defaults;
- model/voice/display defaults that multiple surfaces read;
- version/capability-gated settings values only if they are summary-like.

Feed ownership can initially stay with existing hooks such as
`useServerSettings`. Successful settings mutations should report the accepted
response into the store. Activity-bus settings events can remain a later
enhancement if cross-tab settings drift becomes visible.

### Recent Visits

Priority: Low-medium.

`useRecentSessions` returns enriched recent-visit rows for New Session project
selection. This is conceptually a membership list plus session/project summary
facts.

Possible target:

- a `recentVisits` slice stores ordered visit ids and timestamps;
- selectors compose visit membership with session/project records;
- the existing `recordSessionVisit` helper reports local successful visits.

Keep this lower priority unless the enriched recent rows start diverging from
session/project summaries in visible UI.

### Agents And Processes

Priority: Open.

`useProcesses` returns process rows for the Agents page. This is adjacent to
session summary data but not identical to it.

Options:

- leave `useProcesses` as a process feed and make only the nav badge read from
  inbox/session selectors;
- add a separate `processes` slice if Agents page data needs to compose with
  Sidebar, Projects, or Session Page in more places.

Do not force process rows into `sessions` unless the fields are stable session
summary facts.

### Retire Obsolete Local Status Hooks

Priority: Low.

`useSessionStatuses` appears to duplicate activity/unread status tracking that
the summary store now owns. If it has no production consumers, remove it. If a
consumer appears, migrate that consumer to session-summary selectors first.

## First Recommended Chunk

Replace broad inbox context consumers with purpose selectors:

1. [x] Add reducer/selectors/hooks for inbox counts, counts by project, and
   active session ids by project.
2. [x] Migrate `useGlobalActiveAgents` or replace it at `AgentsNavItem`.
3. [x] Migrate `useNeedsAttentionBadge` and Sidebar inbox badge.
4. [x] Migrate `ProjectsPage`, `NewSessionForm`, and `SessionPage` from
   `useInboxContext` row arrays to targeted selectors.
5. [x] Keep `InboxContext` as the fetch/lifecycle provider and compatibility
   layer for `InboxContent`.

This is the highest-value cleanup because it removes duplicate inbox fetching
and narrows several consumers that currently subscribe to full inbox row arrays.

## Progress Log

- 2026-06-28: Created this tracker after the Zustand client summary store,
  project slice, project queue slice, draft decorations, nested `sessions`
  shape, and Inbox tier migration landed. Remaining work is long-tail
  migration, selector narrowing, and optional new slices rather than store
  substrate work.
- 2026-06-28: Added targeted inbox selector hooks for counts, per-project
  counts, active project session ids, and active-agent presence. Migrated
  `useGlobalActiveAgents`, `useNeedsAttentionBadge`, and the Sidebar inbox
  badge off broad `useInboxContext` consumption; `ProjectsPage`,
  `NewSessionForm`, and `SessionPage` still need the project-scoped selector
  migration.
- 2026-06-28: Migrated the project-scoped inbox consumers. `ProjectsPage`
  now reads per-project inbox counts from the client summary store, while
  `NewSessionForm` and `SessionPage` use active project session id selectors
  for Project Queue visibility. The remaining `useInboxContext` production
  consumer is `InboxContent`, with `InboxContext` still owning the `/api/inbox`
  feed.
- 2026-06-28: Paused further long-tail migration behind the source-registry
  prerequisite in `027-client-summary-source-registry.md`. The next store
  substrate change keeps the current `ClientSummaryState` shape but creates
  one cache per backend source so hosted remote host switches cannot render
  sessions from the previous machine.

## Verification Checklist

For each long-tail chunk:

- feed hooks do not publish authoritative empty snapshots before remote
  readiness;
- successful local mutations update store-backed surfaces immediately;
- stale REST snapshots cannot undo newer events or local successful actions;
- hot list rows do not subscribe to the whole store when a narrower selector is
  practical;
- tests cover unchanged record identity or selected-hook render isolation when
  a chunk touches hot row surfaces;
- no transcript/message/composer state moves into the global store.

## Immediate Next Chunk

Implement the client summary source registry from
[`027-client-summary-source-registry.md`](027-client-summary-source-registry.md)
before continuing queue selector cleanup or settings migration.

Reason: moving more surfaces onto an unscoped singleton store would increase
the blast radius of the multi-host leakage bug. The registry keeps the current
`ClientSummaryState` shape but creates one store per backend source, so the
existing selector migration can continue without mixing MacBook, WinNative, Pi,
or local summaries.
