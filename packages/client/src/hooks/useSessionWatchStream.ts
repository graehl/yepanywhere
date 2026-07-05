import { useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { isNonRetryableError } from "../lib/connection/types";
import { createManagedStream, type ManagedStream } from "../lib/transport";

export interface SessionWatchTarget {
  sessionId: string;
  projectId: string;
  provider?: string;
}

interface UseSessionWatchStreamOptions {
  onChange: () => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

function getSessionWatchTargetKey(
  target: SessionWatchTarget | null,
): string | null {
  if (!target) {
    return null;
  }
  return `${target.projectId}\0${target.sessionId}\0${target.provider ?? ""}`;
}

/**
 * Focused session file-change subscription.
 *
 * Used by session detail pages for non-owned sessions so updates are driven by
 * a targeted server watch for the currently viewed session file.
 */
export function useSessionWatchStream(
  target: SessionWatchTarget | null,
  options: UseSessionWatchStreamOptions,
) {
  const [connected, setConnected] = useState(false);
  const runtime = useCurrentSourceRuntime();
  const streamRef = useRef<ManagedStream | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetKey = getSessionWatchTargetKey(target);

  useEffect(() => {
    const currentTarget = targetRef.current;
    if (!currentTarget || !targetKey) {
      setConnected(false);
      return undefined;
    }

    const stream = createManagedStream(runtime.transport, {
      subscribe: ({ transport, handlers }) =>
        transport.subscribeSessionWatch(currentTarget.sessionId, handlers, {
          projectId: currentTarget.projectId,
          provider: currentTarget.provider,
        }),
      onEvent: (event) => {
        if (event.eventType === "heartbeat") {
          return;
        }
        if (event.eventType === "session-watch-change") {
          optionsRef.current.onChange();
        }
      },
      onOpen: () => {
        setConnected(true);
        optionsRef.current.onOpen?.();
      },
      onError: (error) => {
        setConnected(false);
        optionsRef.current.onError?.(new Event("error"));
        if (isNonRetryableError(error)) {
          console.warn(
            "[useSessionWatchStream] Non-retryable error, not reconnecting:",
            error.message,
          );
        }
      },
      onClose: () => {
        setConnected(false);
      },
    });
    streamRef.current = stream;
    const unsubscribe = stream.subscribe(() => {
      setConnected(stream.getSnapshot().connected);
    });
    setConnected(stream.getSnapshot().connected);

    return () => {
      unsubscribe();
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      stream.close();
    };
  }, [runtime.transport, targetKey]);

  return { connected };
}
