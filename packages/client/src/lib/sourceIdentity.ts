/**
 * Source identity: which logical YA server a source key refers to, as
 * distinct from the connection route used to reach it.
 *
 * Today every key is route-scoped: `host:<savedHostId>` binds to one saved
 * host record (which has a single relay-or-direct mode) and `direct:<wsUrl>`
 * binds to one URL string. The same server reached via direct and relay
 * therefore resolves to two different sources, and a direct-to-relay
 * failover changes the key — orphaning all source-scoped state.
 *
 * The seam for changing that is `SavedHost.serverInstanceId`: when the
 * server advertises a stable instance id during auth/pairing, hosts that
 * carry it resolve to a `server:<instanceId>` key that survives transport
 * failover and collapses direct+relay records for one server into one
 * source. Nothing populates the field yet; until then keys stay
 * route-scoped, and consumers must treat every key as opaque.
 *
 * See topics/client-source-runtime-topology.md, "Source Identity Versus
 * Connection Route".
 */

import {
  asClientSummarySourceKey,
  type ClientSummarySourceKey,
  createClientSummaryDirectSourceKey,
  createClientSummaryHostSourceKey,
} from "./clientSummaryStore";
import type { SavedHost } from "./hostStorage";

export function createServerInstanceSourceKey(
  serverInstanceId: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`server:${serverInstanceId}`);
}

export function resolveSourceKeyForSavedHost(
  host: SavedHost,
): ClientSummarySourceKey {
  if (host.serverInstanceId) {
    return createServerInstanceSourceKey(host.serverInstanceId);
  }
  return createClientSummaryHostSourceKey(host.id);
}

export function resolveSourceKeyForDirectUrl(
  wsUrl: string,
): ClientSummarySourceKey {
  return createClientSummaryDirectSourceKey(normalizeDirectSourceUrl(wsUrl));
}

function normalizeDirectSourceUrl(wsUrl: string): string {
  const trimmed = wsUrl.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}
