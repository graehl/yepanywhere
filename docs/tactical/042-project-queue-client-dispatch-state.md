# Project Queue Client Dispatch State

Status: Implemented and verified.

## Problem

After a safe restart, Project Queue dispatch correctly remains globally paused
with `reason: "restart"` while queued items stay in `status: "queued"`. The
Projects page should therefore show the global `Resume` control.

The observed server state was correct:

```json
{
  "dispatchState": {
    "status": "paused",
    "reason": "restart"
  },
  "items": ["queued", "queued", "queued"]
}
```

The client could still show `Pause` after a fresh hosted-page reload. That is a
client state ownership bug, not a Project Queue semantics change.

## Root Cause

`useProjectQueues()` had two different state owners:

- Project Queue items were normalized into `clientSummaryStore`.
- Global `dispatchState` and recovered session-queue summaries were hook-local
  React state initialized to `{ status: "running" }`.

Several always-mounted or route-mounted surfaces call `useProjectQueues()`:
Sidebar, Inbox, Session page, New Session, Global Sessions, and Projects. The
retained query controller deduplicates the `/api/project-queue` request by
source/key. If a non-Projects consumer wins or joins the fetch first, its
`applySnapshot` updates its local `dispatchState`; later consumers can reuse the
fresh/in-flight query without receiving the snapshot. Queue rows still render
because they live in the shared store, but the Projects page's local
`dispatchState` can remain at its default `running`, producing a wrong `Pause`
button.

This is the same split-brain class that the client summary store was built to
avoid.

## Intended State Model

Project Queue client state should mirror the server ownership:

- Server owns the durable Project Queue and global dispatch gate.
- `clientSummaryStore` owns the latest client-known Project Queue snapshot for
  a source.
- The shared snapshot includes queue items, global `dispatchState`, and
  recovered session-queue summaries.
- `useProjectQueues()` selects all three from the shared store and only owns
  transient mutation/error flags.
- Retained-query dedupe order must not affect the visible Pause/Resume state.

## Fix Shape

1. Extend `ProjectQueueCollectionState` with shared:
   - `dispatchState`
   - `dispatchStateObservedAt`
   - `recoveredSessionQueues`
   - `recoveredSessionQueuesObservedAt`
2. Update Project Queue reducers so:
   - global snapshots update items, dispatch state, and recovered queues;
   - project snapshots and `project-queue-changed` events update items and
     dispatch state when present;
   - older snapshots do not overwrite newer dispatch/recovered facts.
3. Add selectors/hooks for shared dispatch state and recovered queues.
4. Simplify `useProjectQueues()` to read shared state instead of keeping local
   copies.
5. Add regression coverage for a second hook consumer mounting after the global
   Project Queue query has already been satisfied.

## Verification Plan

- Focused reducer tests for shared dispatch/recovered state.
- Focused hook tests for the retained-query dedupe race.
- Client tests covering Project Queue hook and summary reducer.
- Typecheck.

## Current Status

Implemented in the client shared-summary layer:

- `ProjectQueueCollectionState` now stores queue items, global
  `dispatchState`, recovered session-queue summaries, and project readiness
  statuses together.
- Project Queue snapshots and `project-queue-changed` events update the shared
  dispatch state when the server provides it.
- Global snapshots update recovered session queues, and older observations do
  not overwrite newer dispatch/recovered facts.
- `useProjectQueues()` now selects dispatch/recovered state from the shared
  store and only keeps transient mutation/error state locally.

Verified with:

- `pnpm --filter @yep-anywhere/client test -- src/hooks/__tests__/useProjectQueues.test.ts src/lib/__tests__/clientSummaryState.test.ts`
- `pnpm typecheck`
- `pnpm lint`

`pnpm lint` exits successfully. It still reports pre-existing unrelated
Biome advisory output in `packages/server/src/routes/sessions.ts` and
`packages/server/test/augments/task-list-augments.test.ts`.

## Follow-Up

The retained-query audit checked:

- `useServerSettings()`
- `usePublicShareStatus()`
- `useProcesses()`
- `useGitStatus()`
- `useProjects()` / `useProject()`
- `useGlobalSessionsFeed()`
- `InboxProvider`
- `useProjectQueues()`

Most consumers already store fetched server-visible data in either
`clientSummaryStore`, route retention, or a module-level external store read via
`useSyncExternalStore`. Their hook-local state is limited to transient loading,
error, mutation, or ordering flags.

The audit found one remaining Project Queue sibling state:
`projectStatusesByProject`. The Projects page renders those statuses as row
readiness/blocker details, but `useProjectQueues()` still kept them in local
React state updated only from Project Queue snapshot responses. That had the
same retained-query stale-state shape as `dispatchState`: a late consumer could
reuse a fresh query, render shared queue rows, and keep `{}` for the row status
map.

The follow-up fix moved project statuses into `ProjectQueueCollectionState`.
Global Project Queue snapshots replace the shared status map, per-project
snapshots merge their provided statuses, and older snapshots cannot remove
newer status facts.

No other retained-query consumer currently shows the same server-visible
snapshot/state split.
