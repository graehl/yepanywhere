# Session ID Remap Events

Status: problem statement. No implementation has landed yet.

## Problem

A project-queue new session can briefly render as two sidebar rows for one
logical provider session when YA publishes a temporary startup ID and the
provider reports the canonical ID immediately afterward. This is a session
identity bug, not a duplicate-title display problem.

The observed duplicate was created from Project Queue instead of the normal New
Session page. The screenshots from July 6, 2026 showed two active `mclone` rows
with the same prompt. One tooltip only identified Claude; the other identified
the later Fable model. The duplicate disappeared after the summary data caught
up, but it should have reconciled at identity level as soon as the canonical ID
arrived.

## Evidence

Server log evidence for the observed `mclone` session:

- `2026-07-06T10:20:19.202Z`: `session_registered` emitted for temporary ID
  `5f84842d-6f10-4b5d-92c9-929b99b922bd` and forwarded as `session-created`.
- `2026-07-06T10:20:19.229Z`: the Claude SDK reported canonical ID
  `42042f7a-30d8-4eba-8b52-59fb8683846f`.
- `2026-07-06T10:20:19.230Z`: Supervisor logged
  `session_id_mapping_updated` from the temporary ID to the canonical ID.
- The adjacent activity forwarding after the remap included
  `session-status-changed`, `project-queue-changed`, `file-change`, and later
  `session-updated`; it did not include a public remap event.
- The canonical session JSONL and SDK raw stream identified the model as
  `claude-fable-5`, matching the Fable tooltip row.

This also rules out the "missing session id" theory. The provisional row had a
real YA-generated UUID. The issue is that the client never learned that the
temporary UUID and canonical UUID were the same logical session.

## Current Flow

The startup path is:

1. `ProjectQueueScheduler.dispatchNewSessionItem` calls
   `supervisor.startSession` for new-session queue items without staged
   attachments.
2. `Supervisor` constructs a `Process` with a generated temporary session ID.
3. `Process.waitForSessionId(timeoutMs = 5000)` resolves with the current
   temporary ID if the SDK init message has not arrived by the timeout.
4. `Supervisor.registerProcess` records `process.sessionId` and emits an
   optimistic `session-created` activity event using that temporary ID.
5. The SDK init message then updates `Process._sessionId` and emits the
   internal `session-id-changed` process event.
6. `Supervisor.observeProcessEvents` handles the internal event by adding a
   `sessionToProcess` mapping for the canonical ID, keeping the old mapping,
   emitting ownership for the new ID, and scheduling initial reconciliation.
7. No public activity event tells clients that the old and new IDs are aliases.
8. The client summary store keys session rows by `session.id`. It upserts the
   temporary `session-created` row and later upserts canonical `session-updated`
   or snapshot rows separately.
9. The sidebar intentionally does not dedupe active rows, so both rows can be
   visible until replacement snapshots or the recent event-created-row TTL
   remove the temporary row.

Relevant code surfaces:

- `packages/server/src/services/ProjectQueueScheduler.ts`
- `packages/server/src/supervisor/Process.ts`
- `packages/server/src/supervisor/Supervisor.ts`
- `packages/client/src/lib/activityBus.ts`
- `packages/client/src/lib/clientSummaryState.ts`
- `packages/client/src/lib/clientSummaryStore.ts`
- `packages/client/src/hooks/useGlobalSessionsFeed.ts`
- `packages/client/src/components/Sidebar.tsx`

## Invariant

If YA exposes a temporary public session ID and later learns the canonical
public session ID, every client-facing identity surface must be able to
reconcile the two IDs. Provider-native IDs must not silently replace
YA-visible session IDs; when the public ID changes, the mapping must be
explicit in the event contract and client stores.

## Likely Fix Shape

Add a public activity event, probably named `session-id-remapped`, with at
least:

- `oldSessionId`
- `newSessionId`
- `projectId`
- `processId`
- `provider`
- `timestamp`

Emit it from the Supervisor `session-id-changed` handler when
`oldSessionId !== newSessionId`, near the existing mapping update, ownership
change, and initial reconciliation scheduling.

Teach the client summary store to apply the remap as an identity merge:

- Move or merge the old session record into the new session record.
- Remove the old ID from query membership arrays, inbox tiers, provider runtime
  status maps, activity maps, and any other normalized session-id collections.
- Preserve the canonical record's authoritative fields while using the
  temporary record to backfill optimistic fields that the canonical record does
  not have yet.
- Ensure later old-ID events either resolve through a short-lived alias map or
  safely no-op after the merge.
- Avoid duplicate IDs in list projections.

Also add the event to the client activity-bus types and valid event list, and
teach source-scoped summary-store subscriptions to route it through the
reducer.

For open session-detail routes, keep the server-side old-ID mapping at least
long enough for in-flight clients. A client currently viewing the temporary URL
can then either continue through the existing mapping or replace the route with
the canonical URL after receiving the remap event.

## Tests

Focused coverage should include:

- Server emits a public remap event when a process changes from temporary ID to
  canonical ID.
- Activity bus accepts and dispatches the new event type.
- Client summary reducer merges a temporary `session-created` record into a
  canonical record without leaving the old ID in query lists or inbox tiers.
- Provider runtime / activity maps keyed by the temporary ID move to the
  canonical ID.
- Sidebar projections do not show two active rows for the same remapped
  session.
- A late old-ID event after remap does not recreate the duplicate row.

## Non-Goals

- Do not solve this by hiding duplicate titles in the sidebar. Title-based
  hiding can mask real parallel sessions, forks, helper sessions, or owned
  active sessions.
- Do not delay every `session-created` until a canonical ID is available. That
  would hide useful startup feedback and still would not cover providers that
  remap after initial display.
- Do not change Project Queue dispatch semantics as part of the identity fix.
- Do not broaden this into the larger client source-runtime refactor.

## Open Questions

- Should the public event name mirror the internal `session-id-changed` process
  event, or should it use the more explicit `session-id-remapped` name?
- How long should the client retain an old-to-new alias for late events?
- Should route replacement to the canonical ID be automatic for focused session
  pages, or should the server-side alias remain the only compatibility layer?
