import { useEffect } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { activityBus } from "../lib/activityBus";

/**
 * Manages the activityBus connection for remote mode.
 *
 * Doesn't check auth state because remote mode is already authenticated
 * via SRP when this hook runs (the connection gate ensures this).
 *
 * Visibility handling and stale detection are owned by the source transport.
 */
export function useRemoteActivityBusConnection(): void {
  const runtime = useCurrentSourceRuntime();

  useEffect(() => {
    return activityBus.retainCurrentSourceStream(
      runtime.sourceKey,
      runtime.transport,
    );
  }, [runtime.sourceKey, runtime.transport]);
}
