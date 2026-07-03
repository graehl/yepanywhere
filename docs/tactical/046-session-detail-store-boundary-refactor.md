# Session Detail Store Boundary Refactor

Topic: session-detail-data-layer

Status: Proposed tracking doc. This follows the current-state audit in
[`045-session-detail-store-current-state-audit.md`](045-session-detail-store-current-state-audit.md).

## Goal

Split the current singleton `SessionDetailStore` shape into a clearer cache
manager plus one session-detail entry store per cache key, without changing
session-detail behavior.

The cleanup target is:

```text
SessionDetailCache
  owns keys, lookup, creation, retain/release, eviction, stats

SessionDetailEntry
  owns key metadata, retain/accounting metadata, one entry store

SessionDetailEntryStore
  owns SessionDetailState, reducer dispatch, selectors, notifications
```

This is not intended to canonicalize all windows for one session. The first
refactor keeps the current cache unit:

```text
sourceKey + projectId + sessionId + tailTurns/tailFrom
```

That means "one entry store per session window", not a broader "one canonical
store per session" model.

## Why This Is Worth Doing

The current code works, but `SessionDetailStore` is doing two jobs:

- cache manager: source/window keying, mounted ownership, retention, TTL,
  byte-budget eviction, stats;
- entry store: per-entry `SessionDetailState`, reducer dispatch, selected
  reads, selected subscriptions, notification equality.

Separating those jobs gives future readers and agents a simpler mental model:

- a route retains one explicit entry key;
- one entry owns one transcript-window state;
- the cache manager owns memory and lifetime;
- any future Zustand decision is scoped to entry-store mechanics only.

This is bigger than a pure rename because cache ownership moves out of the
entry state container, but it should be smaller and safer than changing the
transcript-window semantics.

## Non-Goals

- Do not merge `tailTurns`, `tailFrom`, and default windows into one canonical
  per-session transcript store.
- Do not change warm-cache reveal behavior.
- Do not change compacted-tail refresh behavior.
- Do not change older-page pagination semantics.
- Do not move token-sized streaming or scroll ticks into broad React
  subscriptions.
- Do not replace the entry-store implementation with Zustand in the same patch
  that extracts the cache manager.
- Do not retire `sessionRouteSnapshots` until the manager boundary is explicit.

## Working Decisions

- **Entry identity:** use explicit session-window terminology. A likely name is
  `SessionDetailEntryKey`; if the code needs stronger emphasis on tail variants,
  consider `SessionDetailWindowKey`.
- **Window variants:** preserve independent entries for default, `tailTurns`,
  and `tailFrom`.
- **Mounted ownership:** preserve current behavior where a mounted route is
  protected before load. The new API should make route ownership distinct from
  loaded transcript data.
- **Scroll snapshots:** keep them associated with the entry key for this
  refactor and preserve non-notifying patch behavior.
- **Diagnostics:** keep aggregate `getStats()` on the cache manager.
- **Zustand:** evaluate only after the cache/entry boundary exists. If used, it
  should likely back `SessionDetailEntryStore`, not the whole cache registry.

## Proposed API Shape

Names can change during implementation, but the boundary should stay clear:

```ts
interface SessionDetailCache {
  retain(key: SessionDetailEntryKey): () => void;
  read(key: SessionDetailEntryKey): SessionDetailState | undefined;
  readRouteSnapshot(key: SessionDetailEntryKey): SessionRouteSnapshot | undefined;
  readSelected<T>(
    key: SessionDetailEntryKey,
    selector: (state: SessionDetailState) => T,
  ): T | undefined;
  dispatch(
    key: SessionDetailEntryKey,
    action: SessionDetailAction,
  ): SessionDetailState | undefined;
  writeRouteSnapshot(
    key: SessionDetailEntryKey,
    snapshot: SessionRouteSnapshot,
  ): boolean;
  patchScrollSnapshot(
    key: SessionDetailEntryKey,
    snapshot: SessionRouteScrollSnapshot,
    options?: { notify?: boolean },
  ): void;
  subscribe<T>(
    key: SessionDetailEntryKey,
    selector: (state: SessionDetailState | undefined) => T,
    listener: () => void,
    equality?: (left: T, right: T) => boolean,
  ): () => void;
  deleteEntry(key: SessionDetailEntryKey): boolean;
  evictExpired(): number;
  clear(): void;
  getStats(): SessionDetailStoreStats;
}
```

The initial extraction can keep this compatibility surface so
`useSessionMessages` and `sessionRouteSnapshots` do not change at the same time
as the internal split.

## Phase 1: Name The Cache Key

Status: Implemented.

Intent:

- Introduce explicit entry-key naming around `SessionDetailEntryKeyInput` and
  `getSessionDetailEntryKey`.
- Keep existing exports as aliases if needed for compatibility.
- Update tests and nearby docs to say "entry" or "session window" where that is
  the real concept.

Acceptance:

- No behavior changes.
- Existing store and hook tests pass.
- A reader can tell from names that the key is source/session/window scoped.

Implementation note:

- Added `SessionDetailEntryKeyInput` and `getSessionDetailEntryKey`, while
  keeping `SessionDetailStoreKeyInput` and `getSessionDetailStoreKey` as
  compatibility aliases.
- Updated `sessionRouteSnapshots` and direct store tests to prefer the
  entry-key names.

## Phase 2: Extract Per-Entry Object

Status: Implemented.

Intent:

- Introduce a private `SessionDetailEntry` object that owns one entry's state,
  selected subscriptions, dispatch, scroll patch, and route snapshot conversion.
- Keep retain/accounting metadata either on `SessionDetailEntry` or in an
  adjacent cache-owned record, but do not leave per-entry state buried directly
  in the manager map.
- Preserve current notification behavior, especially selector equality and
  non-notifying scroll patches.

Acceptance:

- Direct store tests still pass.
- Metadata-only store updates still do not rerender returned transcript data.
- Missing-entry incremental actions are still dropped.

Implementation note:

- Added a private `SessionDetailEntry` object that owns one entry's
  `SessionDetailState`, selected subscriptions, notification equality, dispatch
  state replacement, scroll patching, reset, and stats projection.
- Preserved subscription-before-load behavior by allowing subscription-only
  entry slots that do not count as retained/cached records.
- Kept retention, eviction, aggregate byte accounting, and public singleton APIs
  on the outer `SessionDetailStore`; those remain Phase 3 cache-manager work.

## Phase 3: Extract Cache Manager Responsibilities

Status: Implemented.

Intent:

- Make the outer type visibly own lookup, creation, delete, retain/release,
  TTL, byte-budget eviction, and aggregate stats.
- Keep the public singleton name stable if it reduces churn, but make internal
  names reflect cache-manager versus entry-store roles.
- Keep byte accounting and deduped aggregate accounting on the manager side.

Acceptance:

- Mounted entries remain protected from expiry/eviction.
- Cache-disabled unmount deletes the active entry.
- Cache-enabled unmount releases but preserves a cacheable snapshot.
- Budget-zero settings still clear retained snapshots.
- `getStats()` remains useful for diagnostics and tests.

Implementation note:

- Added a private `SessionDetailCache` manager that owns entry lookup, creation,
  delete, retain/release, TTL eviction, LRU/byte eviction, and aggregate stats.
- Kept exported `SessionDetailStore` as the stable compatibility facade over
  that cache, so hook and route snapshot callers did not move in this phase.
- Split per-entry data into `SessionDetailEntry` metadata plus
  `SessionDetailEntryStore` reducer/subscription state. This leaves each entry
  with one session-window store while the cache owns lifecycle and diagnostics.

## Phase 4: Compatibility Facade Cleanup

Status: Implemented.

Intent:

- Review `sessionRouteSnapshots` after the cache manager is explicit.
- Either keep it as a named compatibility layer or rename/collapse callers onto
  clearer cache APIs.

Acceptance:

- Route snapshot read/write behavior is unchanged.
- Warm restore, source scoping, and cache-disabled behavior remain covered.

Implementation note:

- Moved active `useSessionMessages` cache reads/writes from
  `sessionRouteSnapshots` helpers onto `defaultSessionDetailStore` directly,
  while preserving the transcript-cache enabled check and SSR guard.
- Removed the duplicate scroll-snapshot patch that existed because the old
  route-snapshot cache had been merged into the detail store.
- Updated the budget-zero performance-settings clear path and its test to use
  `defaultSessionDetailStore.clear()` directly.
- Kept `sessionRouteSnapshots` as the serializable snapshot DTO module and
  documented its remaining functions as a legacy compatibility surface.

## Phase 5: Optional Entry Store Substrate Spike

Status: Deferred.

Intent:

- Evaluate whether each `SessionDetailEntryStore` should use
  `zustand/vanilla`.
- Measure whether it deletes bespoke subscription code without weakening cache
  ownership or notification semantics.

Acceptance for adopting Zustand:

- The cache manager remains custom and owns entry registry, retention, eviction,
  and stats.
- Per-entry selected subscriptions are at least as narrow as today.
- Scroll snapshot patches can remain non-notifying for returned transcript
  subscribers.
- Bundle/dependency impact remains acceptable.

## Tests To Preserve

Before and after each implementation phase, run focused coverage for:

- `packages/client/src/lib/sessionDetail/__tests__/sessionDetailStore.test.ts`
- `packages/client/src/hooks/__tests__/useSessionMessages.cache.test.tsx`
- `packages/client/src/hooks/__tests__/useSessionPerformanceSettings.test.ts`
- `packages/client/src/lib/sessionDetail/__tests__/transcriptReducer.test.ts`

For implementation phases touching hook behavior, also run the project lint and
typecheck wrappers before landing.

## Open Follow-Up: Canonical Per-Session Store

A later, separate design could try to make one canonical store per
`source/project/session` and derive requested windows from it. That is
intentionally out of scope here because it would change the semantics around:

- compacted-tail initial loads;
- retained broader windows versus requested tail windows;
- older-page expansion;
- pagination fields such as returned versus total counts;
- route-cache restore behavior.

The boundary refactor should make that future design easier, but should not
enact it.
