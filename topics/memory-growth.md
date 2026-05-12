# Memory-growth notes

## 2026-05-12: heartbeat session `019e1ac6-c836-7e33-891e-2ba878d27ca5`

- Confirmed metadata persisted for `019e1ac6-c836-7e33-891e-2ba878d27ca5` includes:
  - `heartbeatTurnsEnabled: true`
  - `heartbeatTurnsAfterMinutes: 30`
  - `heartbeatForceAfterMinutes: 5`
  - provider `codex`.
- `session-metadata.json` is authoritative at `~/.yep-anywhere/session-metadata.json`.

## Heartbeat pipeline checkpoints that could block delivery

- For owned processes, supervisor checks:
  - heartbeat enabled for session,
  - `process.isTerminated === false`,
  - `process.isHeld === false`,
  - `process.queueDepth === 0`,
  - `process.isProcessAlive === true`,
  - state/derived status is either `idle` + `verified-idle` OR `in-turn` +
    one of `verified-progressing`, `recently-active-unverified`,
    `long-silent-unverified`.
- For unowned candidates, it additionally requires `hasPendingToolCall === true`,
  candidate provider supports steering, and metadata flag enabled.
- No explicit heartbeat text is sent if any of the above are false.

## Current observed evidence

- Search across `~/.yep-anywhere` did not find any
  `heartbeat_turn_queued`/`heartbeat_turn_failed` entries containing the session.
- No session-specific heartbeat trace exists in local persisted JSONL logs.
- `recents.json` shows this session was visited at `2026-05-12T14:56:52.826Z`.
- Index metadata (`~/.yep-anywhere/indexes/...json`) shows it is the most
  recently updated `tend` session and near context/window limits (~93% usage),
  but this does not itself indicate heartbeat state.

## Likely next checks

- At runtime, inspect the live process object for this session:
  `getProcessForSession(sessionId)` state fields (`isProcessAlive`, `queueDepth`,
  `isHeld`, derived liveness) at heartbeat tick.
- Confirm heartbeat scheduler is actually running and logger sink captures
  `heartbeat_turn_*` events in the server runtime you are attached to.
