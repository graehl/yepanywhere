# Client Summary Source Registry

Status: Implemented.

Progress:

- [x] 2026-06-28: Added the per-source registry shell inside
  `clientSummaryStore.ts`. `ClientSummaryState` remains unchanged, current
  selector hooks subscribe to the current source's Zustand store, test reset
  clears the full registry, and focused tests cover host switch invisibility,
  switch-back preservation, and current-source hook rerenders.
- [x] 2026-06-28: Added the remote/local source binding. Local app mounts bind
  `local`; remote login/unknown-host states bind `remote:none`; saved relay
  route changes bind the requested `host:<id>` before the new connection
  finishes; saved direct connections bind `host:<id>`; unsaved direct
  connections fall back to `direct:<normalized-ws-url>`.
- [x] 2026-06-28: Required source keys on REST snapshot reporters and migrated
  global sessions, inbox, projects, and project queue feeds to capture the
  request source before awaiting API responses. Queue mutation responses also
  write back to the source active when the mutation started. Added coverage for
  late source-keyed snapshots staying invisible to the current host until that
  source is selected again.
- [x] 2026-06-28: Scoped client-summary activity-bus reductions and local
  session mutation reporters. The lazy store-owned activity listener captures
  its retained source key and is replaced when the current-source subscription
  changes, so stale callbacks reduce into their original source instead of the
  visible host. `reportSessionCollectionCreated` and
  `reportSessionCollectionMetadataChanged` now require source keys.
- [x] 2026-06-28: Quarantined legacy draft decorations. Draft presence reports
  now require a source key, while the old `draft-message-*` localStorage scanner
  only populates the `local` source. Remote sources stay empty unless a
  source-keyed reporter supplies draft ids, which keeps the path clean for the
  planned server-authoritative draft migration without adding a temporary
  scoped localStorage format.
- [x] 2026-06-28: Removed the remaining unscoped store/snapshot compatibility
  exports. The mutable current-store lookup is now module-internal, the old
  current-source snapshot helpers are gone, and tests/debug reads use
  `getClientSummarySnapshotForSource(sourceKey)` instead.
- [x] 2026-06-28: Replaced the temporary remote-draft quarantine with
  source-scoped local draft storage. The composer keeps localStorage durability
  for unreliable networks, remote draft body keys include the source key, and a
  per-source draft index lets badge decoration avoid enumerating all
  localStorage keys. Legacy `draft-message-*` body keys remain local-only and
  backfill the local index.
- [x] 2026-06-28: Added sidebar-level source-switch regression coverage and
  reset source-sensitive fetch-hook bookkeeping. Sidebar now has a component
  test for current-source rows plus draft badges across host switches, and
  inbox/global-session/project hooks clear local loading/order refs when the
  source changes so stale responses cannot mutate current-source bookkeeping.

This doc tracks the next widening of the client summary store. The normalized
`ClientSummaryState` shape stays the same, but the store is no longer a single
module-global cache. It becomes a registry of per-backend-source caches, with
the existing UI hooks reading from the current source by default.

## Problem

Hosted remote clients can switch between multiple YA servers in one browser tab,
for example from `/macbook/sessions` to `/winnative/sessions`. The current
client summary store is a module singleton, so Sidebar, Inbox, Projects, and
other store-backed surfaces can render rows from the previous host until the
new host's snapshots arrive. A full page refresh hides the issue because it
recreates the module singleton empty.

This is a source-isolation bug, not a session-list ordering bug. Session ids,
project ids, queue state, inbox tiers, settings, and local decorations are only
valid relative to the backend that produced them.

## Decision

Keep `ClientSummaryState` normalized and unchanged per source:

```ts
interface ClientSummaryState {
  sessions: { entities: Map<string, SessionRecord>; queries: Map<string, Query> };
  projects: { entities: Map<string, ProjectRecord>; queries: Map<string, Query> };
  projectQueues: { byProject: Map<string, ProjectQueueSummaryState> };
  inbox: { tiers: Record<InboxTier, string[]> };
  localDecorations: { draftSessionIds: Set<string> };
}
```

Add one layer above it:

```ts
type ClientSummarySourceKey = string & {
  readonly __brand: "ClientSummarySourceKey";
};

const storesBySource = new Map<
  ClientSummarySourceKey,
  StoreApi<ClientSummaryState>
>();
```

Existing hooks such as `useRecentSessionRecords()`,
`useInboxCountsByProject()`, and `useProjectQueuedSessionIds(projectIds)` keep
their current call shape. They subscribe to the store for the current source.

Future multi-host aggregate UI should use explicit cross-source selectors. Do
not silently make today's Sidebar or session pages aggregate multiple hosts.

## Source Keys

Source keys identify the backend source, not the route component.

Preferred keys:

- local app: `local`;
- saved relay host: `host:<SavedHost.id>`;
- saved direct host: `host:<SavedHost.id>`;
- unsaved direct remote fallback: `direct:<normalized-ws-url>`;
- unauthenticated or between-host remote state: `remote:none`.

Use `SavedHost.id` when available. Relay usernames and URLs can change, while
the saved host id is the user's local identity for that backend.

## Current Source Binding

Add a small binding near the remote connection layer. It watches
`RemoteConnectionContext` and sets the current source key:

```tsx
function ClientSummarySourceBinding() {
  const remote = useOptionalRemoteConnection();
  const sourceKey = resolveClientSummarySourceKey(remote);

  useEffect(() => {
    setCurrentClientSummarySourceKey(sourceKey);
  }, [sourceKey]);

  return null;
}
```

For local `main.tsx`, the default source remains `local`.

During a relay host switch, `RelayConnectionGate` already notices the host
mismatch and disconnects before connecting to the requested host. The source
binding should move through `remote:none` or the requested saved host key so
current-source selectors stop reading the previous host immediately.

## Registry API

Target API shape:

```ts
export function getCurrentClientSummarySourceKey(): ClientSummarySourceKey;
export function useClientSummarySourceKey(): ClientSummarySourceKey;
export function setCurrentClientSummarySourceKey(key: ClientSummarySourceKey): void;
export function getClientSummaryStoreForSource(
  key: ClientSummarySourceKey,
): StoreApi<ClientSummaryState>;
export function clearClientSummarySource(key: ClientSummarySourceKey): void;
```

Hook internals should read the current source key, get that source's Zustand
store, and call `useStore(store, selector)`. Source-key changes must cause hooks
to resubscribe to the new store.

Tests should reset the whole registry, not just one store.

## Snapshot Writers

Report functions should require a source key. Do not silently default snapshot
writers to the current source, because that makes it easy for a late response
from one host to write into another host.

Target shape:

```ts
const sourceKey = useClientSummarySourceKey();
const requestSourceKey = sourceKey;
const requestStartedAt = Date.now();

const data = await api.getGlobalSessions(...);

reportGlobalSessionsCollectionSnapshot(
  requestSourceKey,
  snapshot,
  requestStartedAt,
);
```

If the user switches from `host:macbook` to `host:winnative` while the MacBook
request is in flight, the response updates `host:macbook`'s cache. It does not
update the visible `host:winnative` cache and does not need to be dropped.

Apply this to:

- global sessions snapshots and local created/prepended rows;
- inbox snapshots;
- project snapshots;
- project queue snapshots and mutation responses;
- successful session/project metadata mutations;
- any future settings snapshots.

## Activity Bus Events

Activity-bus events must also be source-aware. REST scoping alone is not enough.

The activity bus should tag events with the source key captured when the
activity subscription is opened. Client-summary reducers should reduce the event
into that source's store. If a stale subscription delivers a late event during a
host switch, it must write to the old source or be ignored, never to the new
current source by accident.

Possible implementation shapes:

- add a source key to the activity-bus subscription setup and expose
  `onWithSource`/event-envelope callbacks internally; or
- keep the public `useFileActivity` callback API unchanged, but let
  client-summary's activity-bus subscription capture a connect-time source key.

The chosen implementation should not require ordinary UI callbacks to reason
about multiple hosts unless they write shared summary state.

## Local Decorations

Draft badges currently derive from localStorage. That is also a source
boundary. The registry keeps draft decoration state per source, and draft
storage uses a source-scoped index so hosted remotes can retain offline draft
durability without scanning every localStorage key on each badge refresh:

- local legacy body keys stay in the old `draft-message-<sessionId>` format
  and are compatible with older clients;
- source-scoped remote body keys include the encoded source key and session id;
- each source has a compact draft index, and badge scans read only that index;
- the local compatibility scan reads old `draft-message-*` body keys only for
  `local` and backfills the local index.

Server-authoritative drafts can still replace or supplement this later, but do
not let source-global draft scans contaminate per-host session cards.

## Implementation Chunks

1. [x] Add the source-key registry and current-source subscription layer. Keep
   `ClientSummaryState` unchanged. Update tests for source switching and
   current-source hook resubscription.
2. [x] Add remote/local source binding and make current-source selectors switch to
   the requested host immediately during host changes.
3. [x] Require source keys on REST snapshot reporters and migrate sessions, inbox,
   projects, and project queue feed hooks.
4. [x] Scope activity-bus reductions and local mutation reporters.
5. [x] Scope local draft decorations with per-source localStorage indexes.
6. [x] Remove any compatibility default that allowed unscoped summary writes.

## Verification

Automated tests:

- a MacBook snapshot populates `host:macbook`;
- switching current source to `host:winnative` makes current-source selectors
  empty before any WinNative fetch completes;
- a late MacBook REST response updates only `host:macbook`;
- a WinNative snapshot populates only `host:winnative`;
- switching back to `host:macbook` preserves the MacBook cache;
- activity-bus events reduce into their connect-time source;
- hook subscriptions resubscribe on source changes and do not keep rendering
  records from the previous source.
- Sidebar renders only the current source's session rows and draft badges when
  switching from `host:macbook` to `host:winnative` and back;
- source-sensitive fetch-hook bookkeeping (such as inbox stable tier order)
  resets on source changes and ignores late stale responses for local UI refs.

Manual test:

- in the hosted remote client, open `/macbook/sessions`, then navigate to
  `/winnative/sessions` in the same tab. Sidebar and all store-backed surfaces
  must not show MacBook sessions while WinNative is connecting or loading.
