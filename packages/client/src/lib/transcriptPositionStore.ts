export interface TranscriptPositionStore {
  getSnapshot(): number | null;
  publish(timestampMs: number | null): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(frameId: number): void;
}

const browserFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (frameId) => cancelAnimationFrame(frameId),
};

export function createTranscriptPositionStore(
  frameScheduler: FrameScheduler = browserFrameScheduler,
): TranscriptPositionStore {
  let snapshot: number | null = null;
  let pendingSnapshot: number | null = null;
  let hasPendingSnapshot = false;
  let frameId: number | null = null;
  const listeners = new Set<() => void>();

  const flush = (): void => {
    frameId = null;
    if (!hasPendingSnapshot) return;
    hasPendingSnapshot = false;
    if (pendingSnapshot === snapshot) return;
    snapshot = pendingSnapshot;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot: () => snapshot,
    publish: (timestampMs) => {
      if (frameId === null && timestampMs === snapshot) return;
      pendingSnapshot = timestampMs;
      hasPendingSnapshot = true;
      frameId ??= frameScheduler.request(flush);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (frameId !== null) {
        frameScheduler.cancel(frameId);
        frameId = null;
      }
      hasPendingSnapshot = false;
      pendingSnapshot = null;
      listeners.clear();
    },
  };
}
