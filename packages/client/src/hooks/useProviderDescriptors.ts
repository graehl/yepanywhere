import type { ProviderDescriptor } from "@yep-anywhere/shared";
import { useCallback, useSyncExternalStore } from "react";
import {
  type ClientSummarySourceKey,
  useClientSummarySourceKey,
} from "../lib/clientSummaryStore";
import { getSourceRuntimeRegistry } from "../lib/sourceRuntime";
import { useRetainedClientQuery } from "./useRetainedClientQuery";

// One small identity list per connected source, like the provider-row cache.
// These records contain no installation, authentication or model authority.
const snapshots = new Map<ClientSummarySourceKey, ProviderDescriptor[]>();
const listeners = new Set<() => void>();
const queryKey = { endpoint: "provider-descriptors" };
const revalidateOn = ["refresh", "reconnect"] as const;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call only when the current source advertises provider-descriptors. */
export function useProviderDescriptors(enabled: boolean) {
  const sourceKey = useClientSummarySourceKey();
  const readSnapshot = useCallback(() => snapshots.get(sourceKey), [sourceKey]);
  const providers = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
  const query = useRetainedClientQuery<{ providers: ProviderDescriptor[] }>({
    sourceKey,
    key: queryKey,
    enabled,
    hasData: providers !== undefined,
    bootstrapTier: "route",
    revalidateOn,
    fetcher: ({ sourceKey: requestSourceKey }) =>
      getSourceRuntimeRegistry()
        .getOrCreateSourceRuntime(requestSourceKey)
        .transport.fetch("/providers/descriptors"),
    applySnapshot: (result, context) => {
      snapshots.set(context.sourceKey, result.providers);
      for (const listener of listeners) listener();
    },
  });
  return { ...query, providers: enabled ? providers : undefined };
}
