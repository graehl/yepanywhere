# Source Transport Boundary

> Each client source should expose one explicit transport facade for talking to
> one YA server, while preserving visible status for the real channels that
> back it.

Topic: source-transport

Status: Proposal. Use this before moving session streams, activity streams,
remote API routing, upload routing, or reconnect/readiness state under
`YaSourceRuntime`.

## Problem

The client currently has three transport shapes that are all real:

- default localhost mode: same-origin browser requests for normal API calls,
  plus WebSocket channels for subscriptions and some uploads;
- plain multiplex WebSocket mode: one unencrypted `WebSocketConnection` carries
  request/response, uploads, session streams, watch streams, activity, ping,
  and reconnect;
- secure or relay mode: one `SecureConnection` carries the same multiplexed
  operations, adding SRP, encryption, and relay support.

Those shapes grew at different times, so consumers choose transport by reaching
into different globals:

- `api.fetchJSON` checks `getGlobalConnection()` and otherwise uses fetch;
- `useConnection` returns a global secure connection or `directConnection`;
- `useSessionStream`, `useSessionWatchStream`, and `activityBus` choose between
  `getGlobalConnection()` and `getWebSocketConnection()`;
- reconnect/backoff/readiness are exposed through the singleton
  `connectionManager` and `whenConnectionReady`.

That is workable with one current source. It is hard to reason about once a
source runtime owns its own API, streams, activity, summaries, and caches.

## Goal

Introduce an explicit `SourceTransport` contract: the boring, source-bound
facade for "how this browser talks to this YA server."

The facade should make the normal localhost mode fit the same outward shape as
the multiplexed modes, but without inventing false localhost lifecycle
semantics. Localhost source-level readiness is always ready; its stream
WebSocket remains visible as a channel in status/debug snapshots.

## Non-Goals

- Do not remove default localhost HTTP behavior.
- Do not make localhost source-level `reconnect()` secretly reconnect the
  stream WebSocket.
- Do not hide channel state in private objects that cannot be inspected.
- Do not claim two real remote sources can coexist until exercised against real
  servers.
- Do not rework SRP, NaCl, relay pairing, or WebSocket framing as part of this
  boundary.

## Current Code Facts

- [`WebSocketConnection`](../packages/client/src/lib/connection/WebSocketConnection.ts)
  is a single unencrypted WebSocket transport. It delegates request/response,
  upload, subscription, ping/pong, and reconnect behavior to `RelayProtocol`.
- [`SecureConnection`](../packages/client/src/lib/connection/SecureConnection.ts)
  exposes the same multiplexed surface, with SRP, encryption, session resume,
  and relay support layered around it.
- [`DirectConnection`](../packages/client/src/lib/connection/DirectConnection.ts)
  handles same-origin `fetch`/`fetchBlob` and upload helpers. Its subscription
  methods throw because default localhost subscriptions use the local
  `WebSocketConnection` path.
- [`useConnection`](../packages/client/src/hooks/useConnection.ts) returns a
  global secure connection when present, otherwise `directConnection`.
- [`api.fetchJSON`](../packages/client/src/api/client.ts) routes through the
  global secure connection when present, otherwise same-origin fetch.

## Proposed Interface

Names are intentionally low-level. This is transport plumbing, not a rich
domain client.

```ts
type SourceTransportKind = "localhost" | "websocket" | "secure";

interface SourceTransport {
  readonly kind: SourceTransportKind;
  readonly status: SourceTransportStatus;

  fetch<T>(path: string, init?: RequestInit): Promise<T>;
  fetchBlob(path: string): Promise<Blob>;
  upload(
    projectId: string,
    sessionId: string,
    file: File,
    options?: UploadOptions,
  ): Promise<UploadedFile>;
  uploadStagedAttachment(
    file: File,
    options?: UploadOptions & { batchId?: string },
  ): Promise<StagedAttachmentRef>;

  subscribeSession(
    sessionId: string,
    handlers: StreamHandlers,
    lastEventId?: string,
    options?: SessionSubscriptionOptions,
  ): Subscription;
  subscribeSessionWatch(
    sessionId: string,
    handlers: StreamHandlers,
    options?: { projectId?: string; provider?: string },
  ): Subscription;
  subscribeActivity(handlers: StreamHandlers): Subscription;

  dispose(): void;
}
```

Status is deliberately visible and inspectable:

```ts
type SourceTransportState =
  | "ready"
  | "connecting"
  | "reconnecting"
  | "disconnected";

interface SourceTransportStatus {
  getSnapshot(): SourceTransportStatusSnapshot;

  /**
   * Fires when either the source state or any channel snapshot changes.
   * Localhost can therefore stay source-ready while still publishing stream
   * WebSocket state changes for diagnostics or stream-specific consumers.
   */
  subscribe(listener: () => void): () => void;

  /**
   * Source-level reconnect.
   *
   * For localhost this is a no-op because the source is same-origin HTTP and
   * has no source connection to re-establish.
   */
  reconnect(): Promise<void>;
}

interface SourceTransportStatusSnapshot {
  kind: SourceTransportKind;
  state: SourceTransportState;
  channels: SourceTransportChannelSnapshot[];
}

type SourceTransportChannelName =
  | "same-origin-http"
  | "upload-websocket"
  | "stream-websocket"
  | "multiplex-websocket"
  | "secure-websocket"
  | "relay";

type SourceTransportChannelState =
  | "stateless"
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "unsupported";

interface SourceTransportChannelSnapshot {
  name: SourceTransportChannelName;
  state: SourceTransportChannelState;
  activeSubscriptions?: number;
  reconnectAttempts?: number;
  lastError?: string;
}
```

The source-level state answers "can this source be addressed?" Channel snapshots
answer "what is really happening underneath?" They are not private diagnostics;
they are part of the type-level contract for debuggability. `subscribe` covers
the whole snapshot, not only the source-level state.

## Mode Semantics

### Default Localhost Transport

`LocalhostSourceTransport` is the primary local mode.

- `fetch` calls same-origin browser fetch.
- `fetchBlob` calls same-origin browser fetch.
- uploads use the existing upload helper path.
- `subscribeSession`, `subscribeSessionWatch`, and `subscribeActivity` use the
  local `WebSocketConnection` subscription path.
- `status.getSnapshot().state` is always `ready`.
- `status.reconnect()` is a no-op.
- `status.getSnapshot().channels` includes `same-origin-http` as `stateless`
  and the local stream/upload WebSocket channels with their real observable
  state.
- `status.subscribe()` may still fire for channel changes, even though the
  source-level state remains `ready`.

This keeps localhost semantics honest: ordinary API requests do not require a
connection lifecycle, but the persistent channels remain visible.

### Plain Multiplex WebSocket Transport

`WebSocketSourceTransport` wraps one `WebSocketConnection`.

- `fetch`, uploads, session streams, watch streams, activity, ping/pong, and
  reconnect all use the same unencrypted WebSocket.
- `status.reconnect()` calls `WebSocketConnection.reconnect()`.
- the channel snapshot exposes one `multiplex-websocket` channel.

This is the unencrypted sibling of secure mode, not a variant of the localhost
composite path.

### Secure Or Relay Transport

`SecureSourceTransport` wraps one `SecureConnection`.

- `fetch`, uploads, session streams, watch streams, activity, ping/pong, and
  reconnect all use the same secure connection.
- `status.reconnect()` calls `SecureConnection.forceReconnect()`.
- the channel snapshot exposes `secure-websocket`, plus relay details when the
  connection is relay-backed.

This preserves the existing SRP/encrypted multiplexed transport while making it
source-owned instead of global.

## Relationship To ConnectionManager

`ConnectionManager` remains a useful reconnect/backoff state machine, but it
should not be the app-facing source interface. It is an implementation detail
used by transport implementations and surfaced through `SourceTransportStatus`
and channel snapshots.

This means callers should stop importing the singleton `connectionManager` for
source-owned work. They should observe `runtime.transport.status` instead. The
status surface can expose reconnect attempts, state, and errors without forcing
callers to know which concrete manager instance exists underneath.

## Runtime Placement

`YaSourceRuntime` should carry one transport:

```ts
interface YaSourceRuntime {
  sourceKey: ClientSummarySourceKey;
  transport: SourceTransport;
  summary: SourceSummaryRuntime;
  sessionDetails: SessionDetailRuntime;
}
```

The existing narrow `SourceApiClient` can remain as a session-detail-facing
subset while the broader transport boundary is introduced. Over time, the
source runtime should prefer `runtime.transport` for API, stream, activity,
upload, and status ownership.

## Implementation Slices

1. Add the `SourceTransport` types and status snapshot types.
2. Implement `LocalhostSourceTransport` over same-origin fetch plus the current
   local WebSocket subscription path. Source status is ready/no-op reconnect;
   channel snapshots expose the real subchannels.
3. Implement `WebSocketSourceTransport` over `WebSocketConnection`.
4. Implement `SecureSourceTransport` over `SecureConnection`.
5. Add `transport` to `YaSourceRuntime`, with the current-source runtime
   creating the correct transport for existing single-source behavior.
6. Move `useSessionStream` and `useSessionWatchStream` to
   `runtime.transport.subscribeSession*` and `runtime.transport.status` instead
   of `getGlobalConnection()`, `getWebSocketConnection()`, and the singleton
   `connectionManager`.
7. Move the activity bus transport ownership under `runtime.transport`.
8. Move remaining global connection consumers, including remote media,
   emulator stream, uploads, and `useConnection`, toward the source transport
   surface.

## Validation

- Unit-test the three transport implementations with fake underlying
  connections.
- Prove localhost source status is ready and `status.reconnect()` is a no-op,
  while channel snapshots still expose stream/upload channel state and
  snapshot subscribers can observe channel changes.
- Prove plain multiplex WebSocket and secure transport both route fetch,
  uploads, activity, session streams, watch streams, ping/pong, and reconnect
  through one backing connection.
- Add hook tests with two fake source runtimes: reconnect/status changes in one
  runtime must not resubscribe or clear subscriptions in the other.
- Preserve teardown behavior: closing a tab/component releases the session or
  watch subscription exactly once.
- Preserve non-retryable subscription-error behavior.
- Before claiming real coexistence support, run two YA servers with independent
  transports and show that disposing one source does not affect the other.

## Open Questions

- Should `SourceTransportStatus` eventually expose explicit channel-control
  methods, or are source-level `reconnect()` plus channel snapshots enough?
- Should managed subscriptions eventually resubscribe inside the transport,
  rather than requiring hooks to listen to status and recreate subscriptions?
- How should upload WebSockets in default localhost mode report channel state
  without creating long-lived bookkeeping for every short upload?
