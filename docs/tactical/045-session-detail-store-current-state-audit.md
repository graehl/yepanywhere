# Session Detail Store Current-State Audit

Topic: session-detail-data-layer

Status: Current-state report, 2026-07-03. This is an audit of the shape that
landed after the session-detail data-layer migration, intended to guide a later
cleanup toward clearer cache-manager and per-session-store boundaries.

## Executive Snapshot

The current `defaultSessionDetailStore` is one singleton manager that stores
many keyed session-detail entries. It is not "one store per session" in the
conceptual sense. It is one class that combines:

- a cache registry keyed by source/project/session/window;
- per-entry `SessionDetailState` storage;
- keyed selector subscriptions;
- retain/release ownership;
- TTL and byte-budget eviction;
- route-snapshot compatibility APIs;
- reducer dispatch and store stats.

That shape is understandable historically: it replaced scattered hook-local
transcript mirrors and the old same-tab route snapshot cache while preserving
`useSessionMessages` behavior. The migration was successful in the important
ways: returned transcript data now comes from the store after reveal, direct
tests cover the main cache invariants, and the hook-local transcript fallback
path has been removed.

The conceptual smell is also real. Cache ownership and entry state are fused
inside one class, so a reader has to understand retention, eviction,
subscription equality, and reducer dispatch together. A cleaner next shape would
split the outer cache manager from a per-entry session detail store.

## Current Concrete Shape

The store is implemented in
`packages/client/src/lib/sessionDetail/sessionDetailStore.ts`.

Current structure:

```text
defaultSessionDetailStore: SessionDetailStore
  entries: Map<string, SessionDetailStoreEntry>
  listeners: Map<string, Set<SelectorSubscription>>

SessionDetailStoreEntry
  key/sourceKey/projectId/sessionId/tailTurns/tailFrom
  state: SessionDetailState
  retainCount
  createdAt/updatedAt/lastAccessedAt/expiresAt
  approxBytes
```

The key input is:

```ts
{
  sourceKey,
  projectId,
  sessionId,
  tailTurns?,
  tailFrom?,
}
```

The string key is:

```text
encode(sourceKey):encode(projectId):encode(sessionId)
```

with an optional variant suffix:

```text
?tailTurns=<n>
?tailFrom=<message-id>
```

Important implication: the current cache unit is not exactly "session". It is
`source + project + session + transcript window`. The same YA-visible session
can have multiple entries if default, `tailTurns`, and `tailFrom` windows have
all been loaded. Different remote/local sources do not collide because
`sourceKey` is part of the key.

## What Each Entry Stores

Each entry's `state` is `SessionDetailState`:

- `messages`
- `session`
- `pagination`
- `agentContent`
- `markdownAugments`
- `toolUseToAgentEntries`
- `lastMessageId`
- `maxPersistedTimestampMs`
- `deferredMessages`
- `scrollSnapshot`

The entry metadata stores cache/accounting facts:

- retain count;
- creation/update/access/expiry timestamps;
- approximate byte charge.

The byte charge is an approximate memory-retention budget, not a heap-accurate
measurement. Message rows, agent rows, augments, and tool-use mappings are
charged by `sessionDetail/transcriptCharge.ts`. Boundary paths measure uncached
rows; hot dispatch paths avoid serializing newly growing rows and use a fallback
charge unless the object was already measured. Aggregate eviction can dedupe
shared row objects across entries by identity.

## Store API Surface

The public store API is small but mixes manager and entry concerns:

- `read(input)` and `readRouteSnapshot(input)` synchronously read an entry.
- `readSelected(input, selector)` synchronously reads one selected value.
- `writeRouteSnapshot(input, snapshot)` writes/restores a route snapshot.
- `dispatch(input, action)` reduces one action into one keyed entry.
- `patchScrollSnapshot(input, snapshot, { notify? })` updates retained scroll.
- `subscribe(input, selector, listener, equality?)` subscribes to one keyed
  selected value.
- `retain(input)` and `release(input)` protect mounted entries.
- `evictExpired()`, `deleteEntry()`, `clear()`, and `getStats()` manage the
  whole registry.

This means a later split has a natural boundary:

```text
SessionDetailCache
  key construction
  entry lookup/create/delete
  retain/release
  TTL/byte eviction
  aggregate stats
  route snapshot compatibility

SessionDetailEntryStore
  SessionDetailState
  reduce action
  read selected state
  subscribe selected state
  notify/equality handling
```

`SessionDetailEntryStore` could be hand-built or backed by `zustand/vanilla`.
The outer cache manager remains custom either way.

## Current Ownership Boundaries

`useSessionMessages` still owns session-detail lifecycle timing:

- current source/project/session/window key;
- initial REST load;
- warm route snapshot hydration timing;
- stream buffering until initial load completes;
- incremental catch-up requests;
- older-page pagination requests;
- metadata ref updates;
- loading/progress state;
- cursor and timestamp-watermark refs;
- scroll snapshot refs and DOM-facing scroll restore inputs.

`defaultSessionDetailStore` owns the reducer-fed canonical transcript mirror and
same-tab retained entries:

- persisted load state;
- stream/catch-up/older-page transcript state;
- subagent content and context usage;
- tool-use-to-agent mappings;
- markdown augments;
- retained scroll snapshots;
- route snapshot read/write compatibility.

`MessageList` and renderers still own DOM-local behavior:

- actual scroll position and measurement;
- progressive rendering cadence;
- selection, quote, search, and focused preview UI;
- DOM patching and renderer-local visual state.

The important current cutover is that after hydration/reveal,
`useSessionMessages` returns `messages`, `agentContent`, and tool-use mappings
from the store-selected snapshot. The hook no longer maintains an independent
local transcript mirror for those surfaces.

## Write Paths Into The Store

Store writes enter mainly through `useSessionMessages`:

- mounted route calls `retain(snapshotKey)`, creating an empty retained entry if
  needed;
- warm route snapshot restore writes through `writeRouteSnapshot`;
- cold initial load dispatches `loadPersistedTranscript`;
- warm refresh dispatches `applyCatchupMessages` over the restored entry;
- stream events dispatch `applyStreamMessage`;
- streaming placeholder updates dispatch `upsertStreamingPlaceholder`;
- subagent stream events dispatch `applyStreamSubagentMessage`;
- subagent lazy loads dispatch `mergeLoadedAgentContent`;
- agent context usage dispatches `updateAgentContextUsage`;
- final placeholder cleanup dispatches `clearStreamingPlaceholders` or
  `clearAgentStreamingPlaceholders`;
- tool mappings dispatch `registerToolUseAgent`;
- incremental file-watch catch-up dispatches `applyCatchupMessages`;
- older-page loads dispatch `prependOlderMessages`;
- metadata patches dispatch `setSessionMetadata`;
- scroll snapshot updates call `patchScrollSnapshot`.

The store does not subscribe directly to the server activity bus or provider
streams. Session detail input still arrives through the mounted hook and related
session-page wiring. That is a major difference from `clientSummaryStore`, whose
activity-bus subscription is cross-page and lightweight.

## Reveal And Returned Data Contract

Returned transcript data is gated by:

```text
revealedSnapshotKey === current snapshot key && loading === false
```

Before reveal, the hook returns empty transcript surfaces even if a warm store
entry already has messages. This preserves the existing loading/reveal cadence
and avoids exposing stale route data during same-hook route changes.

After reveal, the returned subscription selects only:

- `state.messages`
- `state.agentContent`
- `state.toolUseToAgentEntries`

Metadata, pagination, scroll, and other non-transcript store changes do not
replace returned transcript references or notify that returned transcript
subscription unless one of those selected references changes.

If the store entry is unexpectedly missing after reveal, the hook returns empty
transcript surfaces and logs a dev diagnostic. This is treated as an
adapter/retention bug, not as a supported fallback path.

## Retention And Cleanup

Built-in store defaults are:

- TTL: 5 minutes;
- max entries: 3;
- max bytes: 24 MB.

At runtime, `useSessionPerformanceSettings` configures retention from user
preferences:

- transcript cache budget defaults to 0 MB, which means cache off;
- enabling a budget sets `maxBytes` to the chosen budget;
- `maxEntries` becomes `Infinity`, so byte budget and TTL are the real controls;
- TTL defaults to 1 hour and is user-configurable;
- setting budget to 0 clears retained route snapshots.

Important cleanup behavior:

- `retain()` creates or finds an entry and increments `retainCount`.
- the returned release function decrements `retainCount` on effect cleanup;
- retained entries are excluded from TTL/LRU eviction;
- on unmount, `useSessionMessages` attempts to persist the current store route
  snapshot if transcript cache is enabled;
- if persistence succeeds, the entry remains unretained and eligible for later
  TTL/byte eviction;
- if persistence is disabled or no route snapshot can be read, the hook deletes
  the entry immediately;
- a low-frequency browser interval calls `evictExpired()` so an idle tab can
  reclaim expired entries even without further store calls.

The audit-relevant subtlety: retain/release and unmount deletion are separate
effects. In the current shape, tests cover the intended outcomes, but the
control flow is still distributed across `useSessionMessages`,
`useSessionPerformanceSettings`, and `SessionDetailStore`.

## Safety Rules And Invariants

The current store enforces several important rules:

- Source scoping: entries for different `ClientSummarySourceKey` values are
  isolated.
- Window scoping: default, `tailTurns`, and `tailFrom` entries are isolated.
- Incremental actions do not fabricate entries. Only `restoreRouteSnapshot` and
  `loadPersistedTranscript` can create an entry through `dispatch`; a stream or
  catch-up action for a missing entry is dropped with a dev warning.
- Expired entries are not resurrected by later stream dispatch.
- `resetEntryState()` clears state while preserving the entry and retain count.
  This lets a mounted route restart loading without losing eviction protection.
- Scroll snapshot patches are non-notifying by default.
- Retained entries are not LRU/TTL candidates.
- Aggregate byte accounting can dedupe row objects shared across retained
  windows.

These are the semantics a refactor should preserve first, before deciding
whether a per-entry store should be Zustand-backed.

## Test Coverage Snapshot

Direct store tests cover:

- source-scoped keys and stats;
- selector notifications only when the selected value changes;
- `readSelected`;
- separate tail variants;
- single-entry deletion;
- non-notifying scroll patches;
- retain/release across expiry;
- missing-entry incremental action drops;
- expired entries not being resurrected by stream dispatch;
- reset in place while retaining;
- retained entries being skipped by LRU eviction.

Hook/cache tests cover:

- warm snapshot hydration after initial loading state;
- warm store-backed messages gated until hydration;
- stale route detail hidden across same-hook route changes before reveal;
- cache-disabled loads mirrored into the store but not retained after unmount;
- mounted entries retained against eviction;
- store-selected messages, agent content, and tool mappings;
- metadata-only store updates not rerendering returned transcript data;
- missing store data after reveal returning empty transcript surfaces;
- stream events, catch-up, older-page prepend, placeholders, subagents, metadata,
  and context usage flowing through the store;
- retained scroll snapshot selection;
- warm cache source isolation;
- disabled transcript cache not restoring retained messages;
- warm full-window retention versus compacted-tail refresh behavior;
- concurrent incremental refresh coalescing.

Reducer tests cover the core data semantics:

- persisted load shape;
- stream versus persisted parity;
- replay/catch-up dedupe;
- durable row replacement;
- placeholder upsert/cleanup;
- older-page prepend;
- subagent broad-shape state;
- tool mappings;
- agent context usage;
- scroll snapshot patching.

Coverage is reasonably strong around behavior. The weaker area is not test
absence so much as conceptual coupling: a reader cannot easily tell where cache
management ends and per-entry state begins.

## Current Smells And Refactor Pressure

1. **Manager and entry store are fused.** The class name reads like one store,
   but it is a registry of many entries plus per-entry subscription machinery.

2. **Cache unit naming is ambiguous.** Product discussion naturally says "one
   store per session", but the actual key is `source/project/session/window`.
   A refactor should name this explicitly, perhaps `SessionDetailEntryKey` or
   `SessionDetailWindowKey`.

3. **`retain()` creates empty state.** This protects mounted routes before
   initial load, but conceptually blurs "entry exists" with "entry has loaded
   transcript data". A split manager could make this explicit with states like
   retained-empty, loaded, and cached.

4. **Unmount cleanup is distributed.** Persistence, byte recording, deletion,
   and release happen through different hook/store/settings paths. Current
   tests cover outcomes, but the ownership is not easy to inspect.

5. **Route snapshot compatibility hides the new owner.** `sessionRouteSnapshots`
   is now a thin compatibility API over the detail store. That was useful for
   migration, but a future cleanup should decide whether the compatibility name
   still helps or obscures ownership.

6. **Store stats are manager stats, not entry store stats.** This is fine, but
   it reinforces that a cache-manager type should own stats and eviction.

7. **Zustand fit is per-entry, not whole-cache.** A single Zustand store holding
   all entries would not simplify source/window retention. If Zustand is used,
   it should likely back each entry's state/subscription surface while a custom
   cache manager owns the registry and budgets.

## Suggested Refactor Direction

A cleaner shape can be staged without behavior change:

```text
SessionDetailCache
  Map<SessionDetailEntryKey, SessionDetailEntry>
  getOrCreateEntry()
  readEntry()
  retainEntry()
  releaseEntry()
  deleteEntry()
  evictExpired()
  evictOverBudget()
  getStats()

SessionDetailEntry
  key metadata
  retain/accounting metadata
  SessionDetailEntryStore

SessionDetailEntryStore
  state
  dispatch(action)
  read()
  readSelected(selector)
  subscribe(selector, listener, equality)
```

Recommended sequence:

1. Rename concepts without changing behavior: introduce `SessionDetailEntryKey`
   and cache/entry terminology.
2. Extract a per-entry object while keeping the current hand-built subscription
   internals.
3. Move eviction and stats code into an explicit cache-manager section/type.
4. Only then consider replacing the per-entry subscription implementation with
   `zustand/vanilla`.

This keeps the library decision separate from the semantic cleanup. The main
goal is for a reader to see:

- one mounted route retains one entry key;
- one entry owns one session/window state;
- the cache manager owns lifecycle and memory bounds.

## Working Decisions And Remaining Questions

Working answers after the first design discussion:

- Treat the immediate cleanup as **one entry store per session window**, not a
  canonical one-store-per-session model. The current behavior already depends
  on source and transcript-window scoping; hiding that under "session" naming
  would make the next reader less safe.
- Keep `tailTurns` and `tailFrom` variants independent for the first refactor.
  A canonical session store that serves derived windows may be worthwhile later,
  but it is a separate semantic change involving pagination, warm-cache
  behavior, compacted-tail refreshes, and older-page expansion.
- Preserve the current mounted-route behavior where retention protects an entry
  before load, but make the API/model clearer about the difference between
  route ownership and loaded transcript data.
- Keep `sessionRouteSnapshots` as a compatibility facade until the cache
  manager boundary is explicit enough to absorb or rename it cleanly.
- Keep scroll snapshots associated with the same entry key for now, while
  preserving the non-notifying patch behavior.
- Keep aggregate diagnostics on the cache manager. Per-entry stores should not
  own global memory-budget or eviction stats.

Questions that remain useful to revisit during implementation:

- Should the public concept be "one store per session" or "one store per
  session window"? Current behavior requires window separation unless the
  transcript window model changes.
- Should `tailTurns` and `tailFrom` variants remain independent entries, or can
  a broader canonical session store serve derived windows?
- Should `retain()` create an empty entry, or should mount ownership be tracked
  separately until the first entry-creating action?
- Should route snapshot compatibility stay as `sessionRouteSnapshots`, or
  should callers use the cache manager directly once the split is clear?
- Should scroll snapshot live inside the same entry store long term, or should
  it become cache-manager metadata associated with a transcript entry?
- What diagnostics should replace `getStats()` if the manager and entry store
  split? The current aggregate stats are useful and should not disappear.

## Bottom Line

The current detail store landed in a functional but mixed shape. It successfully
centralized transcript data and same-tab retention, but it still reads as one
object doing two jobs. The best next cleanup is not immediately "convert it to
Zustand"; it is to split the cache manager from the per-entry session detail
store. Once that boundary exists, Zustand can be evaluated narrowly as the
implementation of each entry store's selector/subscription surface.

Implementation tracking for that split lives in
[`046-session-detail-store-boundary-refactor.md`](046-session-detail-store-boundary-refactor.md).
