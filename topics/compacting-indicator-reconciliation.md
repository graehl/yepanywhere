# Compacting Indicator Reconciliation

> Tactical note for the client-owned compaction spinner and the future
> server-authoritative operation-state refactor.

Topic: compacting-indicator-reconciliation

Related topics: [resume-compaction](resume-compaction.md),
[session-liveness](session-liveness.md),
[provider-state-machine](provider-state-machine.md),
[message-control-steer-queue-btw-later-interrupt](message-control-steer-queue-btw-later-interrupt.md)

## Current Problem

The client currently shows "Compacting context..." from a local
`isCompacting` flag. Live provider messages can start or clear that flag:
Codex emits a transient `system/status` message while compaction is running,
and providers emit a durable `system/compact_boundary` when compaction
finishes.

That is correct for a live tab, but fragile for a mobile tab that sleeps or
loses its WebSocket. The server replay buffer is intentionally short
(roughly 15-30 seconds), while phone suspend windows are routinely longer.
When the tab wakes, the client fetches durable transcript and ownership
metadata, but a stale local spinner can survive if the terminal live event was
missed.

## Tactical Fix

For now, keep the lifecycle client-side and reconcile it from durable/session
snapshots:

- Live compact status or an auto-compact acknowledgement may still start the
  local spinner, because JSONL cannot represent "compaction is happening
  right now" before a boundary exists.
- Non-owned session state (`owner` other than `"self"`) clears the spinner,
  because there is no active YA-owned process that can still be compacting.
- A compact boundary observed after the current compact attempt started
  clears the spinner, including when it arrives from JSONL catch-up rather
  than the live stream.
- Session switches reset the flag rather than carrying transient state across
  URLs.

This deliberately avoids changing server protocol shape during a narrow
stability fix. The client is still compensating for a missed event, but the
compensation is centralized instead of scattered through every reconnect or
completion handler.

## Future Direction

The cleaner long-term model is server-authoritative transient operation state
owned by `Process`, for example:

```ts
transientOperation: null | {
  type: "compacting";
  startedAt: string;
  source: "provider" | "ya-auto" | "manual";
}
```

`Process` would set that state when YA queues or dispatches compaction, update
it when provider status arrives, and clear it on compact boundary, error,
termination, or completion. `connected`, `status`, and REST metadata/session
detail would expose the snapshot, and the client would render it rather than
owning the lifecycle.

That refactor is preferable when compaction state next touches server routing
or provider contracts. It is broader than this bug fix because it changes the
session/process snapshot contract rather than only repairing stale client UI.
