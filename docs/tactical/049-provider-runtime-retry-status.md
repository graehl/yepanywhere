# Provider Runtime Retry Status

Topic: provider-runtime-status

Status: tactical implementation plan for the first minimal slice.

## Motivation

Claude Code can keep a turn alive while internally retrying provider API
failures. In a witnessed Claude session, the normal persisted transcript stopped
at the user prompt while the live SDK stream continued emitting:

```jsonc
{
  "type": "system",
  "subtype": "api_retry",
  "error_status": 429,
  "error": "rate_limit",
  "retry_delay_ms": 5034836,
  "max_retries": 2147483647
}
```

YA currently treats those provider messages as live progress, so the process
stays `in-turn` and the UI shows generic working/spinner state. The user sees
no reason for the stall and no retry time, even though the live stream has
structured information.

For this first slice, the goal is not to add YA-owned auto-retry, durable
provider incident tracking, or account-wide blocking. The goal is simply:

- if a live Claude turn is retrying due to provider rate limit or similar API
  retry state, show that fact on the affected session;
- preserve the existing Stop/manual recovery workflow;
- survive ordinary browser reload while the YA server process and provider
  process are still alive;
- keep the design provider-neutral enough that Codex can map similar runtime
  status later.

## Non-Goals

- Do not persist retry state to a sidecar in the first slice.
- Do not infer account-wide provider outages or warn every Claude session.
- Do not render retry events as transcript messages.
- Do not change provider input, queue delivery, or resume behavior.
- Do not add background polling, retry timers, or server work for closed tabs.
- Do not change the process state machine. A retrying turn remains `in-turn`.

## Existing Evidence

The existing architecture already explains most of the gap:

- `packages/server/src/sdk/providers/claude.ts` passes SDK messages through
  after logging raw messages when `LOG_SDK_MESSAGES=true`.
- `packages/server/src/supervisor/Process.ts` emits provider messages
  unconditionally and records them as provider progress.
- `packages/client/src/lib/preprocessMessages.ts` drops unallowlisted `system`
  messages, so `api_retry` is not rendered even when received live.
- `topics/claude-api-failures-and-retries.md` documents that `api_retry`
  messages are live-stream-only and absent from the persisted Claude transcript.

That means the correct first implementation point is the live Process, not the
Claude transcript reader.

## Data Model

Add a provider-neutral shared runtime status type. Keep it compact and focused
on the UI status surface:

```ts
export type ProviderRuntimeStatus =
  | {
      kind: "retrying";
      provider: ProviderName;
      reason:
        | "rate_limit"
        | "overloaded"
        | "server_error"
        | "network"
        | "unknown";
      httpStatus?: number;
      startedAt: string;
      lastSeenAt: string;
      retryAt?: string;
      retryDelayMs?: number;
      attempt?: number;
      maxRetries?: number | "unbounded";
      eventCount: number;
      source: string;
    }
  | null;
```

For Claude `system/api_retry`:

- `provider`: `"claude"`
- `reason`: map `message.error`
- `httpStatus`: `message.error_status`
- `retryDelayMs`: `message.retry_delay_ms`
- `retryAt`: `receivedAt + retryDelayMs`
- `attempt`: `message.attempt`
- `maxRetries`: `2147483647` becomes `"unbounded"`
- `source`: `"claude.system.api_retry"`

Unknown or missing fields should still produce a status with `reason:
"unknown"` if the message shape is clearly `system/api_retry`.

## Server Ownership

Store the current status in memory on the live `Process`.

Recommended Process additions:

- private `providerRuntimeStatus: ProviderRuntimeStatus`
- public getter or inclusion in `getInfo()`
- helper `observeProviderRuntimeStatus(message, receivedAt)`
- helper `clearProviderRuntimeStatus(reason)`

Do not make this a `ProcessState`. The process is still active; action gating
continues to use `in-turn`, `waiting-input`, and `idle`.

### Update Rules

Set or update status when Claude emits `system/api_retry`.

Clear status when any of these happen:

- a real assistant message or stream event resumes after the retry;
- a `result` message arrives;
- the process transitions to idle;
- the user aborts/stops and the process terminates or settles;
- a process error or termination path runs.

Use practical, conservative clearing. If an upstream message sequence is
ambiguous, stale retry text is worse than losing the retry banner early.

### Events

When the status changes, emit a lightweight process event, for example:

```ts
{ type: "provider-runtime-status-change" }
```

The websocket subscription layer can translate that into a client activity
event carrying the actual current status.

## API And Wire Surfaces

Expose `providerRuntimeStatus?: ProviderRuntimeStatus` through existing status
surfaces:

- `ProcessInfo` and `/api/processes`
- session metadata response
- session detail response if it already carries live process facts
- websocket `connected` payload for a session subscription
- websocket/activity event when the status changes

Avoid a new REST endpoint for the first slice. Reload should work because the
session metadata or process info request can read the still-live Process.

## Client Store

Use the client summary store as the single client read model for this runtime
overlay.

Add a top-level client summary section:

```ts
interface ClientSummaryState {
  sessions: SessionCollectionState;
  projects: ProjectCollectionState;
  projectQueues: ProjectQueueCollectionState;
  inbox: InboxCollectionState;
  localDecorations: LocalDecorationState;
  providerRuntime: {
    bySessionId: ReadonlyMap<string, ProviderRuntimeStatusRecord>;
  };
}
```

For the first slice, session-scoped state is enough. A broader provider-scope
issue model can be added later if there is a demonstrated need to warn other
Claude sessions.

Add reducers/selectors:

- `applyProviderRuntimeStatusChanged`
- `applyProviderRuntimeStatusFromSessionSnapshot`
- `selectProviderRuntimeStatusForSession`

Every API surface that returns `providerRuntimeStatus` should feed this same
store so the session page, process modal, inbox, and global lists do not invent
separate local state.

## UI

Render retry status as active-turn chrome, not transcript content.

Suggested first surfaces:

- session composer/model indicator: show `Rate limited` or `Retrying`
  instead of generic `Thinking` while retrying;
- toolbar/liveness chip detail: show `Claude rate limited - retrying at 5:20 PM`;
- Process info modal: show provider, reason, HTTP status, retry time,
  `lastSeenAt`, event count, and source.

Controls should remain those of `in-turn`:

- Stop remains available and prominent.
- Queue/steer behavior does not change.
- Sending another direct turn remains blocked or queued according to existing
  active-turn rules.

Copy should avoid implying YA is choosing to retry. Claude is retrying its own
request. Prefer wording like:

- `Claude is rate limited`
- `Claude will retry at 5:20 PM`
- `Stop this turn if you do not want to wait`

## Codex Extension Later

Keep the shared type provider-neutral, but do not implement Codex in this
slice.

Possible future Codex sources:

- app-server/system error events;
- token-count or rate-limit metadata already present in Codex schemas;
- runtime status from Codex thread status if it exposes retry or rate-limit
  details.

Codex should map provider-specific evidence into the same
`ProviderRuntimeStatus` shape. The UI should not need Codex-specific retry
branches for the basic banner/chip.

## Implementation Plan

### First Chunk

Land the smallest server-visible slice before touching the client summary store
or session UI:

1. Add the shared `ProviderRuntimeStatus` type.
2. Add in-memory `providerRuntimeStatus` tracking to `Process`.
3. Detect Claude `system/api_retry` in `Process.processMessages()`.
4. Clear status on `result`, idle transition, error, termination, and real
   assistant progress.
5. Include `providerRuntimeStatus` in `ProcessInfo` and `/api/processes`.
6. Add server unit tests for set, update, and clear behavior.

This chunk proves the core model with a live/debuggable API shape. It can be
verified against a retrying process with:

```bash
curl -k https://localhost:3400/api/processes \
  | jq '.processes[] | {sessionId,state,providerRuntimeStatus}'
```

Do not add the websocket activity event in this first chunk. REST/process-info
exposure is enough to validate the model without debugging protocol, client
store, and UI state at the same time.

### Full Slice

1. Add `ProviderRuntimeStatus` shared type.
2. Add in-memory runtime status tracking to `Process`.
3. Detect Claude `system/api_retry` in Process message handling.
4. Clear status on assistant/result/idle/error/termination paths.
5. Include `providerRuntimeStatus` in `ProcessInfo`.
6. Include `providerRuntimeStatus` in session metadata/session detail responses
   when a live Process owns the session.
7. Add a websocket/activity event for status changes, or piggyback on an
   existing state/liveness update if that keeps the contract simpler.
8. Add client summary store state, reducer, and selector for
   `providerRuntime.bySessionId`.
9. Wire REST snapshots and activity events into that store.
10. Render the status in the session composer/toolbar and Process info modal.
11. Add focused tests for the reducer, Process update/clear behavior, and UI
    display selection.

## Test Plan

Server unit tests:

- Claude `system/api_retry` creates `ProviderRuntimeStatus`.
- repeated retry messages update `lastSeenAt`, `retryAt`, and `eventCount`.
- `result`, idle transition, abort/termination, and assistant progress clear it.
- `ProcessInfo` includes the active status.

Client tests:

- client summary reducer stores and clears status by session id;
- session UI prefers retry copy over generic `Thinking`;
- Stop remains available while retry status is present;
- reload-style metadata snapshot repopulates the client store.

Manual verification:

- with a captured or mocked Claude retry stream, confirm the session no longer
  appears as a generic spinner-only turn;
- refresh the browser while the server process is still live and confirm the
  retry status returns from metadata/process info;
- stop the turn and confirm the retry status disappears.

## Deferred Options

These are explicitly not part of the first slice:

- durable sidecar persistence across YA server restarts;
- provider/account-scope issue aggregation;
- warning all sessions under the same provider;
- full retry history display;
- transcript enrichment or persisted synthetic system rows.

Revisit these only if the minimal session-scoped runtime status proves
insufficient in normal use.
