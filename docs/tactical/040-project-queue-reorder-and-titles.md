# Project Queue Reorder And Titles

Status: title enrichment, project-local move-to-top, and paused global
move-to-top slices complete; narrow viewport visual QA remains.

Topic: project-queue-reorder-and-titles

## Problem Statement

The Project Queue manager needs two small but related usability upgrades:

- a control that moves an item to the top of that item's project queue;
- display text for the target session, not just the session id.

"Top" means top within the same project backlog. Project Queue is already a
project-scoped feature, so this does not need a new capability flag or a new
cross-project priority model before release.

Session-title display should be enriched by the server list API. The client
should not fan out one title request per queue row. The tactical dependency is
a clean server-side way to resolve a known session id to display metadata while
using the session index cache first.

## Decisions

- Keep running reorder scope project-local. A move-to-top action must not move
  an item ahead of lower-level work that Project Queue already waits behind.
  While global dispatch is paused, the Projects page may additionally move an
  item to the top of the visible global Project Queue list before Resume when
  the server advertises the transitional
  `projectQueueGlobalMoveToTop` capability.
- Do not reuse the existing `promoted` event reason for manual reorder. In this
  feature, promotion already means scheduler dispatch from Project Queue into
  provider/session work. Use a reorder-oriented reason such as `reordered`.
- Add title fields to the queue list response. Prefer a single enriched
  `GET /api/project-queue` payload over client-side N+1 title requests.
- Use cache-first session-index reads for target session titles. Direct reader
  calls are only the fallback on cache miss, stale file stats, or a reader that
  cannot expose a concrete file path.
- Preserve project queue order in client projections. Any client sorting by
  `createdAt` must not mask server-side reorder.

## First Slice

The first implementation slice is the server service primitive:

- add `ISessionIndexService.getSessionSummaryWithCache(...)`;
- make `SessionIndexService.getSessionTitle(...)` delegate to that primitive;
- route cache misses through the existing summary parse queue when the reader
  exposes a concrete file path;
- make `findSessionSummaryAcrossProviders(...)` use the session index service
  when available.

This gives queue API enrichment an easy, cache-first interface for both
`title` and `fullTitle`, without teaching route code or client hooks how the
session-index cache is structured.

Implementation status:

- [x] Cache-first single-session summary primitive.
- [x] Title lookup delegates to the summary primitive.
- [x] Provider summary resolution uses the index service when available.
- [x] Project Queue API title enrichment.
- [x] Project-local move-to-top mutation.
- [x] Paused global move-to-top mutation with transitional capability gate.
- [x] Client hook and manager UI controls.

## Remaining Implementation

1. Enrich queue read models with target-session display metadata. (Complete)
   Existing-session items should include nullable target title fields resolved
   through `findSessionSummaryAcrossProviders(...)` or an equivalent helper
   that uses the cache-first summary path.

2. Add a project-local move-to-top service method. (Complete)
   It should move only queued/failed items if dispatching items are already
   claimed, preserve item contents, update `updatedAt`, persist atomically, and
   emit a reorder-specific project-queue event.

3. Add an API mutation for move-to-top. (Complete)
   Keep it under the existing project queue route family, for example
   `POST /api/projects/:projectId/queue/:itemId/move-to-top`.

4. Add client API and hook support. (Complete)
   `useProjectQueues` should expose the mutation and refresh from the
   reorder-specific event reason without sorting away the server order.

5. Add the Project Queue manager button. (Complete)
   Use a compact action button consistent with existing queue controls. The
   button should be disabled or hidden when the item is already first among
   movable items for that project, and should not appear for claimed
   dispatching work.

## Verification Plan

- [x] Server service tests for cache hit, stale/missing summary fallback, and
  provider-resolution index use.
- [x] ProjectQueueService tests for project-local reorder and persistence.
- [x] Route tests for the new move-to-top endpoint and enriched title response.
- [x] Client hook/component tests for preserved order, button enablement, and title
  rendering.
- [ ] A narrow viewport check of the Project Queue card so the title, prompt text,
  and action buttons do not overlap.

Commands run:

- `pnpm --filter @yep-anywhere/server test -- test/services/ProjectQueueService.test.ts test/routes/project-queue.test.ts`
- `pnpm --filter @yep-anywhere/client test -- src/hooks/__tests__/useProjectQueues.test.ts src/components/__tests__/ProjectQueueSection.test.tsx`
- `pnpm typecheck`
