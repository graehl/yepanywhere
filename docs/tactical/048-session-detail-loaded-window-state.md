# Session Detail Loaded Window State

Topic: session-detail-data-layer

Status: reducer boundary invariant implemented; loaded-window wrapper rename
deferred.

## 2026-07-03 Slice B Status

The reducer now enforces the loaded-window boundary invariant directly:

- `applyCatchupMessages` can merge newer persisted rows and update count-like
  pagination fields, but it preserves `hasOlderMessages`,
  `truncatedBeforeMessageId`, and `truncatedBy` from the existing loaded
  window.
- `replaceTailWindow` is the explicit action for the one incremental-response
  case that may move the window start: an `afterMessageId` request whose anchor
  missed and whose server response is a compacted tail re-slice.
- Warm-refresh preparation no longer reconciles pagination in hook/helper code.
  (2026-07-04: the prepare step was then removed entirely — progress counts
  read from post-dispatch reducer state, and the `warmRefresh` module and its
  tests are gone.) Window metadata is a reducer concern.

The `SessionDetailLoadedWindow` wrapper proposed below is still a naming/design
follow-up, not part of this slice.

## Motivation

`SessionDetailState.pagination` currently works, but the name and placement are
muddy. It is stored beside transcript content:

```ts
interface SessionDetailState {
  messages: Message[];
  session: SessionMetadata | null;
  pagination?: PaginationInfo;
  // ...
}
```

That can read as if `pagination` is durable session truth. In practice it is
metadata for the **loaded transcript window** represented by `messages`: whether
the current window has older rows, which cursor loads the next older page, and
how the returned count compares to the total count.

The current behavior is good enough. The cleanup goal is to make the concept
legible without changing `tailTurns`, `tailFrom`, older-page, warm-refresh, or
route-cache semantics.

## Terms

- **Session detail entry:** the current cache unit keyed by
  `sourceKey + projectId + sessionId + tailTurns/tailFrom`.
- **Loaded window:** the transcript rows currently held by one entry, plus the
  server metadata describing that window.
- **`PaginationInfo`:** the REST/API DTO returned by the server.
- **Canonical session store:** a future, broader design where one store owns
  known transcript truth for `source/project/session` and route windows are
  derived views. This document does not enact that design.

## Behavior To Preserve

- The cache entry key remains
  `sourceKey + projectId + sessionId + tailTurns/tailFrom`.
- Default, `tailTurns`, and `tailFrom` route variants remain independent
  entries.
- `restoreRouteSnapshot` restores the same route snapshot DTO shape, including
  `snapshot.pagination`.
- `loadPersistedTranscript` represents the REST-returned transcript window,
  including ordinary `tailCompactions: 2` responses where
  `totalMessageCount > returnedMessageCount`.
- Warm refresh no longer reconciles pagination outside the reducer. Ordinary
  after-cursor deltas preserve the restored window boundary; explicit
  anchor-miss fallback responses replace the loaded tail window.
- `prependOlderMessages` still atomically prepends rows and updates the window
  metadata returned by the older-page request.
- `applyCatchupMessages` updates count-like metadata only; it does not move the
  loaded-window start.
- `replaceTailWindow` is the explicit action for after-cursor anchor-miss
  re-slice responses.
- `useSessionMessages` keeps returning `pagination` to existing UI callers.
- Route snapshots and the legacy `sessionRouteSnapshots` facade keep their
  current `pagination?: PaginationInfo` DTO field.

## Deferred Follow-Up: Name The Loaded Window

Introduce an explicit state wrapper:

```ts
export interface SessionDetailLoadedWindow {
  pagination?: PaginationInfo;
}

export interface SessionDetailState {
  messages: Message[];
  session: SessionMetadata | null;
  loadedWindow: SessionDetailLoadedWindow;
  agentContent: AgentContentMap;
  markdownAugments: MarkdownAugmentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  deferredMessages: DeferredQueueMessage[];
}
```

This follow-up would be a wrapper/rename inside the reducer state:

- action payloads may keep `pagination?: PaginationInfo` initially;
- reducers assign `loadedWindow: { pagination: action.pagination }`;
- `selectSessionDetailPagination(state)` continues to return
  `state.loadedWindow.pagination`;
- route snapshot conversion maps between `state.loadedWindow.pagination` and
  `SessionRouteSnapshot.pagination`;
- hook callers and component props do not change.

This should stay behavior-preserving and reviewable while making the state read
as "messages plus loaded-window metadata", not "session plus pagination".

## Optional Follow-Up: Stronger Window Type

After the wrapper lands, decide whether to normalize the raw API DTO into a
client-owned type:

```ts
interface SessionDetailLoadedWindow {
  hasOlderMessages: boolean;
  beforeMessageId?: string;
  totalMessageCount?: number;
  returnedMessageCount?: number;
  source: "route-snapshot" | "initial-load" | "warm-refresh" | "catchup" | "older-page";
}
```

This would make reducer intent clearer, but it has a larger adapter surface:

- all API responses must be converted into the client window type;
- route snapshots must convert back to `PaginationInfo`;
- `warmRefresh` tests need to prove the normalized form still preserves broader
  warm windows;
- any server field added to `PaginationInfo` must be intentionally mapped.

Treat this as a second slice only if the wrapper still feels too leaky.

## Options Considered

### 1. Wrapper Rename Only

Store `pagination` under `state.loadedWindow.pagination`.

Pros:

- smallest behavior-preserving diff;
- fixes the conceptual smell in the state shape;
- selectors can preserve existing hook/component API;
- easy to test with existing reducer, route snapshot, and hook fixtures.

Cons:

- still stores raw `PaginationInfo`;
- action payloads may still say `pagination` until a later cleanup.

### 2. Normalize Into A Client Window Type

Replace raw `PaginationInfo` in state with a YA-owned
`SessionDetailLoadedWindow`.

Pros:

- cleaner domain language;
- makes loaded-window source and cursor semantics explicit;
- reduces the sense that API pagination is session truth.

Cons:

- more mapping and test surface;
- possible field drift between server DTO and client state;
- less mechanical as a first cleanup.

### 3. Move Pagination To Cache-Entry Metadata

Keep transcript reducer state free of pagination and store the loaded-window
metadata beside scroll snapshots and retention metadata on the entry.

Pros:

- separates transcript content from non-transcript metadata.

Cons:

- `messages` and loaded-window metadata must update atomically for initial
  loads, catch-up, and older-page prepends;
- splitting that atom across reducer state and entry metadata makes correctness
  harder, not easier;
- scroll snapshots were safe to move because they are DOM hints, not part of
  the transcript-window contract.

Recommendation: do not use this for pagination.

### 4. Keep Pagination Hook-Local

Let `useSessionMessages` own pagination while the store owns messages.

Pros:

- simple local UI state at first glance.

Cons:

- recreates split ownership between store transcript rows and hook window
  metadata;
- makes route snapshots and warm restore less coherent;
- works against the recent store-authoritative return path.

Recommendation: avoid.

### 5. Canonical Per-Session Store With Derived Windows

Unify default, `tailTurns`, and `tailFrom` entries under one
`source/project/session` store and derive route windows from known transcript
ranges.

Pros:

- conceptually attractive long-term;
- one session has one transcript truth;
- broader retained windows can serve narrower views.

Cons:

- semantic change, not a cleanup;
- affects compacted-tail initial loads, older-page expansion, pagination
  counts, warm-cache restore, and scroll-memory expectations;
- requires explicit range/window modeling rather than a simple state rename.

Recommendation: design separately before implementation.

## Deferred Wrapper Implementation Plan

1. Add `SessionDetailLoadedWindow` to `sessionDetail/types.ts`.
2. Replace `SessionDetailState.pagination` with `loadedWindow`.
3. Update `createInitialSessionDetailState`.
4. Update reducer assignments:
   - `restoreRouteSnapshot`;
   - `loadPersistedTranscript`;
   - `applyCatchupMessages`;
   - `replaceTailWindow`;
   - `prependOlderMessages`.
5. Update selectors:
   - keep `selectSessionDetailPagination`;
   - optionally add `selectSessionDetailLoadedWindow`.
6. Update route snapshot conversion to preserve the public
   `SessionRouteSnapshot.pagination` field.
7. Update shadow diagnostics and load-progress plumbing only where they read
   directly from state instead of selectors.
8. Update tests that inspect reducer state directly.

## Acceptance Criteria For Wrapper Follow-Up

- No user-visible behavior changes.
- `useSessionMessages` still returns `pagination` with the same shape.
- Existing `tailTurns`, `tailFrom`, older-page, and warm-refresh tests pass.
- Reducer tests make it clear that pagination belongs to the loaded window.
- Route snapshots still serialize and restore the same DTO shape.
- No scroll-memory or follow-tail behavior changes ride in this patch.

## Focused Checks

Run at minimum:

- `pnpm --filter @yep-anywhere/client test -- src/lib/sessionDetail/__tests__/transcriptReducer.test.ts src/lib/sessionDetail/__tests__/revealSnapshot.test.ts src/lib/sessionDetail/__tests__/sessionDetailStore.test.ts src/hooks/__tests__/useSessionMessages.cache.test.tsx`
- `pnpm lint`
- `pnpm typecheck`

If client files outside `sessionDetail` are touched, also run
`pnpm console:scan`.

## Open Questions

- Should the first slice keep action payload names as `pagination`, or should it
  rename them to `loadedWindow` at the same time?
- Should `SessionDetailLoadedWindow` include a source/kind field immediately, or
  would that be fake precision until a normalized window type exists?
- Should public docs use "loaded window", "transcript window", or "session
  window" consistently?
- Is there a small helper name, such as `paginationToLoadedWindow`, that would
  make future normalization easier without over-abstracting the wrapper slice?
