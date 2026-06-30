# Session Queue Persistence Prep

Status: First persistence service chunk implemented locally.

Progress:

- [x] Capture desired semantics for future disk persistence of per-session
      queued messages.
- [x] Separate safe preparation work from live queue persistence.
- [x] Decide the first code slice: server-internal schema/store service only.
- [x] Add `SessionQueuePersistenceService` with load/save/mutation
      normalization tests.
- [ ] Wire `Process.deferredQueue` call sites to the persistence service.
- [ ] Add restart-paused session queue UI/API behavior.
- [ ] Integrate persisted session queues with safe restart.
- [ ] Reconcile `topics/queued-messages.md` once implementation is actually
      adopted.

Latest update:

- 2026-06-30: First code slice implemented locally. Added a server-internal
  `SessionQueuePersistenceService` for
  `{dataDir}/session-queued-messages.json`, with atomic writes, serialized
  mutations, malformed-record filtering, empty-file cleanup, and load-time
  normalization of `queued`/`claimed` items to `paused-after-restart`. Focused
  service tests cover round-trip behavior, restart normalization, malformed
  disk input, concurrent upserts, empty cleanup, and invalid caller mutations.
  No live `Process.deferredQueue`, `MessageQueue`, route, UI, or safe-restart
  call sites are wired yet.
- 2026-06-30: Tactical draft opened from discussion. The intended direction is
  to make normal per-session queued messages durable enough to survive a YA
  server restart, eventually letting safe restart drain or preserve them the
  same way Project Queue now does. This document is preparation only; current
  runtime behavior remains that session queued messages are process-local and
  lost on process/server restart.

## Context

YA currently has two different queue layers:

- **Project Queue** is durable project-scoped backlog. It is written to disk and
  survives YA server restart.
- **Per-session queued messages** are process-owned. `MessageQueue` holds direct
  provider queue entries, and `Process.deferredQueue` holds editable deferred or
  patient entries waiting for a delivery boundary. They are server-authoritative
  while the process is alive, but not persisted to disk.

That split is mostly reasonable, but it leaves a hole for dev restarts and hard
server exits: a user may have several normal session queued messages visible in
the UI, restart the backend, and lose those messages even though Project Queue
items survive.

The desired preparation is to define durable queued-message semantics before
hooking persistence into live dispatch.

Related docs:

- `topics/queued-messages.md` - current contract: server-authoritative,
  process-local, no disk persistence.
- `topics/queue-across-compaction.md` - standing patient queue should survive
  provider compaction/restart boundaries.
- `topics/project-queue.md` - durable backlog and restart-paused semantics.
- `docs/tactical/036-project-queue-dispatch-pause.md` - Project Queue
  pause-after-restart and dev safe restart.
- `topics/architecture-mandates.md` - no idle/session background loop may
  consume resources forever.

## Current Baseline

The existing queued-message contract intentionally says the queue is ephemeral:

- the client does not persist queue entries in `localStorage`;
- the server owns queue truth while the `Process` exists;
- refresh/reconnect shows whatever the server process reports;
- process restart/session stop drops the queue.

This draft proposes a future revision to that contract, but does not change it
until implementation lands. Do not update UI copy or promise restart recovery
until the server has an actual durable queue service wired into the relevant
paths.

## Product Decisions

- Per-session queued messages may become **durable server state**, not client
  state. The client still renders only server-reported queue entries.
- Restart recovery should be **paused after restart** by default. Loading
  persisted session queued messages must not auto-send them before the user has
  inspected interrupted sessions.
- Empty persisted state should normalize away. There is no hidden paused state
  for an empty session queue.
- Queue identity must be server-owned and stable. Do not match, recover, or
  delete queued messages by text.
- YA-visible session ids remain canonical. Provider-native ids may be stored as
  resume handles, but cannot replace YA session ids in persisted queue records
  or UI/API payloads.
- Direct queue and deferred/patient queue entries should be modeled separately
  because they have different runtime ownership:
  - direct entries are waiting in `MessageQueue` for the provider iterator;
  - deferred/patient entries remain YA-owned until their delivery boundary.
- A very small crash window around queue-to-provider handoff is acceptable for
  this feature. Exactly-once/idempotent provider delivery is not a prerequisite
  for persistence prep.

## Non-Goals

- Do not persist queue entries in browser storage.
- Do not resurrect messages that were already handed to the provider and
  should now be represented by provider transcript/history.
- Do not add queue editing, reordering, or richer queue management as part of
  persistence.
- Do not make safe restart depend on a full production lifecycle manager.
- Do not persist arbitrary process runtime machinery such as timers, listeners,
  async iterators, liveness snapshots, provider child process handles, or
  pending tool approvals.

## Durable Envelope

The first useful shape is a serializable queue envelope, not a persisted
`Process` object:

```ts
type PersistedSessionQueueKind = "direct" | "deferred" | "patient";

type PersistedSessionQueueStatus =
  | "queued"
  | "paused-after-restart"
  | "claimed";

interface PersistedSessionQueuedMessage {
  id: string;
  sessionId: string;
  projectId: UrlProjectId;
  projectPath: string;
  provider: ProviderName;
  executor?: string;
  model?: string;
  serviceTier?: string;
  mode?: PermissionMode;
  kind: PersistedSessionQueueKind;
  message: UserMessage;
  createdAt: string;
  updatedAt: string;
  queuedAt: string;
  status: PersistedSessionQueueStatus;
  source?: {
    clientId?: string;
    tempId?: string;
    requestId?: string;
  };
}
```

Notes:

- `kind: "patient"` is the durable form of
  `message.metadata.deliveryIntent === "patient"` and should continue to use
  the verified-idle path for providers where that matters.
- `kind: "deferred"` is turn-end deferred delivery.
- `kind: "direct"` is a message accepted by YA for normal provider queueing but
  not yet known to have been yielded to the provider.
- `message.tempId` can continue to support client chip clearing, but the
  durable queue id is the authoritative server id.
- Attachments are only persistable if they already point to durable
  server-owned uploaded-file records or stable paths. Browser `File` objects,
  blob URLs, and temporary local-only handles are invalid.

## Persistence Semantics

Suggested backing file:

```text
{dataDir}/session-queued-messages.json
```

Persistence rules:

- Use serialized mutations and atomic writes, matching Project Queue and other
  server metadata stores.
- Validate and normalize on load. Drop malformed items rather than blocking
  server startup.
- Group and order by `sessionId`, then queue order.
- Preserve FIFO order within each session and kind unless existing runtime
  behavior explicitly joins or promotes multiple messages at once.
- On startup, convert recoverable `queued` or `claimed` entries to
  `paused-after-restart`.
- Empty session groups are removed from disk.
- Startup should not create or retain a provider process solely because
  persisted queue entries exist.

`claimed` is intentionally weak. It is a local bookkeeping state for "YA was in
the act of handing this message toward runtime dispatch." After a hard restart,
it should be recoverable as paused unless a later implementation has stronger
evidence that the provider accepted it.

## Runtime Integration Direction

The safest implementation order is staged:

1. Add shared/server queue envelope types, validation, and normalization tests.
2. Add a `SessionQueuePersistenceService` with load/save/mutation tests, but no
   live queue call sites.
3. Persist only `Process.deferredQueue` entries first. They are still YA-owned,
   visible/cancellable, and conceptually closest to Project Queue items.
4. Rehydrate deferred/patient entries after restart as paused visible queue
   entries, not auto-dispatched work.
5. Add direct `MessageQueue` persistence only after the direct handoff boundary
   is represented well enough to avoid obvious ghost chips.
6. Teach safe restart to treat persisted session queued messages as preserved
   work, while still reporting live active sessions and any non-persistable
   queued work as blockers.

Steps 1 and 2 are implemented. The next likely chunk is step 3:
persist `Process.deferredQueue` entries only, rehydrate them as
paused-after-restart visible queue entries, and leave direct `MessageQueue`
persistence for a later slice.

## Restart UX

After a server restart with persisted per-session queued messages:

- do not automatically resume delivery;
- show the queue entries in their normal session surfaces if the user opens the
  session;
- indicate that they are paused after restart;
- let the user delete individual entries;
- provide an explicit resume path before any entry is sent.

This mirrors Project Queue's restart-pause principle, but the UI surface should
remain session-local. The Projects page should not become the primary normal
session-queue manager.

## Safe Restart Interaction

Today dev safe restart waits for active sessions and in-memory queued messages
to drain because queued messages would otherwise be lost.

Once per-session queued messages are durable, safe restart can become less
strict for that class of work:

- active provider sessions still block until they drain or are explicitly
  interrupted;
- non-persistable runtime work still blocks;
- persistable queued session messages can be flushed to disk, marked
  paused-after-restart, and reported as preserved rather than unsafe;
- the banner can say why restart is blocked only for the remaining live
  blockers.

This should be implemented after queue persistence is real, not as part of the
schema/store preparation.

## Verification

Schema/store tests:

- malformed persisted entries are ignored or quarantined without preventing
  startup;
- valid entries round-trip with stable ids and ordering;
- empty state normalizes to no file/no items;
- `claimed` entries load as `paused-after-restart`;
- YA session ids remain unchanged across serialization.

Runtime tests, when live persistence is wired:

- deferred/patient entries survive server restart and do not auto-send;
- deleting a recovered queued message removes it from disk and UI;
- resuming recovered entries preserves per-session order;
- Project Queue promotion still waits for recovered per-session queues before
  injecting project-level work;
- safe restart distinguishes active live blockers from persisted preserved
  queued work.

Manual smoke:

- queue several patient messages during an active Claude session;
- restart the YA backend with those entries still queued;
- confirm the session shows paused recovered entries and no provider turn starts
  until explicit resume.

## Open Questions

- Should recovered session queued messages have a single global resume control,
  or only per-session resume/delete controls?
- Should direct `MessageQueue` entries be included in the first live
  persistence slice, or should the first slice intentionally cover only
  deferred/patient entries?
- Should a hard server restart and a scheduled safe restart produce the same
  paused-after-restart status, or should safe restart use a more specific
  "preserved for restart" status?
- Should recovered entries remember their original queue kind visibly, or is
  that only internal dispatch metadata?
