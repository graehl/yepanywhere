import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { activityBus } from "../lib/activityBus";

/**
 * Manages the activityBus connection based on authentication state.
 *
 * When auth is enabled but user is not authenticated, we don't connect
 * to avoid 401 errors that can trigger the browser's basic auth prompt.
 *
 * Visibility handling and stale detection are owned by the source transport.
 */
export function useActivityBusConnection(): void {
  const { isAuthenticated, authEnabled, isLoading } = useAuth();
  const runtime = useCurrentSourceRuntime();

  useEffect(() => {
    if (isLoading) return;
    const shouldConnect = !authEnabled || isAuthenticated;
    if (!shouldConnect) return;
    return activityBus.retainCurrentSourceStream(
      runtime.sourceKey,
      runtime.transport,
    );
  }, [
    runtime.sourceKey,
    runtime.transport,
    isAuthenticated,
    authEnabled,
    isLoading,
  ]);
}
