import { useSyncExternalStore } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import type { SourceTransportState } from "../lib/transport";

type ConnectionState = "connected" | "reconnecting" | "disconnected";

interface ActivityBusState {
  connected: boolean;
  /** Transport-derived state: connected, reconnecting, or disconnected. */
  connectionState: ConnectionState;
  transportState: SourceTransportState;
}

function mapConnectionState(state: SourceTransportState): ConnectionState {
  if (state === "ready") return "connected";
  if (state === "connecting" || state === "reconnecting") {
    return "reconnecting";
  }
  return "disconnected";
}

/**
 * Hook to get the current source transport state.
 * Event-driven via SourceTransportStatus — no polling.
 */
export function useActivityBusState(): ActivityBusState {
  const runtime = useCurrentSourceRuntime();
  const transportState = useSyncExternalStore(
    (listener) => runtime.transport.status.subscribe(listener),
    () => runtime.transport.status.getSnapshot().state,
    () => runtime.transport.status.getSnapshot().state,
  );
  const connectionState = mapConnectionState(transportState);

  return {
    connected: connectionState === "connected",
    connectionState,
    transportState,
  };
}
