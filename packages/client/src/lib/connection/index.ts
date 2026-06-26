export type {
  Connection,
  SessionSubscriptionOptions,
  StreamHandlers,
  Subscription,
  UploadOptions,
} from "./types";
export {
  WebSocketCloseError,
  RelayReconnectRequiredError,
  SubscriptionError,
  isNonRetryableError,
  NON_RETRYABLE_CLOSE_CODES,
} from "./types";
export {
  ConnectionManager,
  connectionManager,
  type ConnectionState,
  type ConnectionManagerConfig,
  type ReconnectFn,
  type SendPingFn,
  type TimerInterface,
  type VisibilityInterface,
} from "./ConnectionManager";
export { DirectConnection, directConnection } from "./DirectConnection";
export {
  WebSocketConnection,
  getWebSocketConnection,
} from "./WebSocketConnection";
// SecureConnection is NOT re-exported here to avoid eagerly loading tssrp6a,
// which crashes in non-secure contexts (HTTP on LAN IPs) because crypto.subtle
// is unavailable. Import directly from "./SecureConnection" where needed.

import type { Connection } from "./types";

/**
 * Check if this is the remote client build.
 *
 * The remote client is a statically-built version that MUST use SecureConnection
 * for all API requests. This is determined at build time via VITE_IS_REMOTE_CLIENT.
 *
 * This is different from isRemoteMode() which checks runtime state.
 * isRemoteClient() is a static check based on how the app was built.
 */
export function isRemoteClient(): boolean {
  return import.meta.env.VITE_IS_REMOTE_CLIENT === true;
}

/**
 * Default time {@link whenConnectionReady} waits for the relay connection
 * before rejecting. The relay handshake (WebSocket + pairing + SRP) is usually
 * a few seconds; this bounds the wait so callers still surface an error rather
 * than hanging forever if the connection never establishes.
 */
export const CONNECTION_READY_TIMEOUT_MS = 15_000;

/**
 * Global connection for remote mode.
 *
 * When set, this connection is used for all API calls instead of
 * the default DirectConnection/WebSocketConnection.
 *
 * Set this after successful SRP authentication in remote mode.
 */
let globalConnection: Connection | null = null;

/**
 * Waiters queued by {@link whenConnectionReady} while no connection is set.
 * Resolved when a connection next becomes available, or rejected when the
 * connection is torn down.
 */
let connectionReadyWaiters: Array<{
  resolve: (conn: Connection) => void;
  reject: (err: Error) => void;
}> = [];

/**
 * Set the global connection (for remote mode).
 *
 * Passing a connection resolves any outstanding {@link whenConnectionReady}
 * waiters. Passing `null` rejects them: both call sites that clear the
 * connection (intentional disconnect and provider unmount) are genuine
 * teardowns — transient reconnects keep the singleton set — so it is safe to
 * fail outstanding waiters immediately instead of letting them hang until the
 * timeout.
 */
export function setGlobalConnection(connection: Connection | null): void {
  globalConnection = connection;

  const waiters = connectionReadyWaiters;
  connectionReadyWaiters = [];
  if (connection) {
    for (const waiter of waiters) waiter.resolve(connection);
  } else {
    for (const waiter of waiters) {
      waiter.reject(new Error("Connection closed before it became ready"));
    }
  }
}

/**
 * Get the global connection if set.
 */
export function getGlobalConnection(): Connection | null {
  return globalConnection;
}

/**
 * Check if running in remote mode (global connection is set).
 */
export function isRemoteMode(): boolean {
  return globalConnection !== null;
}

/**
 * Resolve once the global (relay) connection is established.
 *
 * Returns the current connection immediately if one is already set; otherwise
 * waits for the next connection, rejecting if the connection is torn down or
 * `timeoutMs` elapses first.
 *
 * This lets API calls that fire during the connect/reconnect window wait for
 * the connection instead of failing outright. See
 * docs/tactical/021-client-connection-readiness-vs-state-consistency.md.
 */
export function whenConnectionReady(
  timeoutMs: number = CONNECTION_READY_TIMEOUT_MS,
): Promise<Connection> {
  if (globalConnection) {
    return Promise.resolve(globalConnection);
  }

  return new Promise<Connection>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;

    const waiter = {
      resolve: (conn: Connection) => {
        clearTimeout(timer);
        resolve(conn);
      },
      reject: (err: Error) => {
        clearTimeout(timer);
        reject(err);
      },
    };

    timer = setTimeout(() => {
      connectionReadyWaiters = connectionReadyWaiters.filter(
        (w) => w !== waiter,
      );
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for connection`));
    }, timeoutMs);

    connectionReadyWaiters.push(waiter);
  });
}

/**
 * The singleton ConnectionManager lives in ConnectionManager.ts so lower-level
 * connection modules can import it without creating a circular dependency.
 */
