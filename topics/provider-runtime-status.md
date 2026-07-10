# Provider runtime notifications and user-visible status

> Provider retry and terminal-failure notifications must remain distinguishable
> from transcript content, survive the lifecycle that owns them, and tell the
> user whether recovery is automatic or requires action.

Topic: provider-runtime-status

## Layers

Provider failures reach YA through three related but distinct layers:

1. **Provider notification.** The native SDK or app-server emits its own event.
   Examples include Claude `system/api_retry` messages and Codex app-server
   `error` notifications followed by `turn/completed`.
2. **Normalized SDK message.** The provider adapter converts the native event
   into YA's loose `SDKMessage` envelope. Live transcript errors need stable
   identities so a following id-less result/status message cannot replace them.
3. **Session runtime status.** `Process` and `Supervisor` project actionable
   retry/failure state into REST, session subscriptions, the activity bus, and
   the composer status surface. This is status about the provider runtime, not
   a provider-authored conversation turn.

Do not infer terminal failure from silence. A terminal status requires an
explicit provider error or failed-turn signal. Liveness remains a separate
answer to whether the process is alive, active, idle, or waiting for input.

## Recovery semantics and color

Color follows recovery behavior rather than the underlying error taxonomy:

| Runtime kind | Meaning | Surface tone | Clear condition |
| --- | --- | --- | --- |
| `retrying` | The provider says it will retry automatically. | Warning/yellow | Provider progress, completed turn, abort, or replacement status. |
| `terminal` | The current turn ended and will not retry automatically. The session may still be usable. | Danger/red | The next user turn begins, or YA restarts. |

“Terminal” is turn-scoped. UI copy should say that the provider stopped or the
turn ended; it must not imply that the session or provider process crashed.
Hover/title detail should say explicitly whether retry is automatic and include
the provider's error text when available.

Codex `CodexErrorInfo` classifications map to the shared reasons as follows:

- `serverOverloaded` -> `overloaded`
- `usageLimitExceeded` and `sessionBudgetExceeded` -> `rate_limit`
- `internalServerError` -> `server_error`
- HTTP/response-stream connection and disconnect variants -> `network`
- all other terminal errors -> `unknown`

## Surfaces

### Composer status

The composer status is the durable-within-the-running-YA explanation of why a
turn stopped. Retrying status may show a retry clock. Terminal status stays
visible while the user is deciding whether to retry or change models.

The status is available through session REST snapshots, live subscription
snapshots, and activity events so reconnecting clients converge.

### Live transcript

A provider error may also appear at the live transcript tail, where it explains
the exact turn boundary. Codex's first-party TUI renders `serverOverloaded` as
a warning history row. YA may choose its stronger terminal/danger tone while
preserving the provider message.

This row is live-only when the provider does not persist the notification. It
must have a stable message id, but YA must not write a shadow provider turn to
make it survive reload.

### Diagnostics

Process info may expose kind, reason, provider message, source notification,
turn id, timestamps, retry timing, and attempt counts. Diagnostic detail must
not be the only place the user can learn that a turn ended.

## Persistence and resource ownership

Codex rollout `task_complete` currently stores a turn id and nullable last
agent message, but not the app-server error or failed status. Therefore YA
cannot reconstruct `serverOverloaded` from the provider transcript after the
fact.

Terminal runtime status is retained in a bounded, in-memory Supervisor map
keyed by YA session id. It survives provider process reaping and client
disconnects, but not a YA server restart. It is not stored in
`session-metadata.json` and is not a transcript display object.

The map has a fixed entry cap and no timer or background loop. A retained
status must never retain a provider process, watcher, heartbeat, or client
subscription. The next user message clears the old incident before the new
turn proceeds; a repeated failure records a new terminal incident.

## Tests

Coverage should prove:

- retrying and terminal statuses have different color/copy semantics;
- Codex `willRetry: false` errors become terminal status with the right reason;
- terminal status survives `result`, idle transition, and idle process reap;
- the Supervisor serves retained terminal status without a live process;
- a new user message clears the retained incident;
- a following id-less/result message does not replace the live error row;
- subscriptions and REST snapshots carry both status kinds.
