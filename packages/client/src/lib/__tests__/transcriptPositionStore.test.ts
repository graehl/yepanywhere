import { describe, expect, it, vi } from "vitest";
import { createTranscriptPositionStore } from "../transcriptPositionStore";

function createFrameScheduler() {
  let callback: FrameRequestCallback | null = null;
  return {
    scheduler: {
      request: vi.fn((next: FrameRequestCallback) => {
        callback = next;
        return 1;
      }),
      cancel: vi.fn(() => {
        callback = null;
      }),
    },
    flush: () => {
      const pending = callback;
      callback = null;
      pending?.(0);
    },
  };
}

describe("transcriptPositionStore", () => {
  it("publishes only the latest position once per frame", () => {
    const frames = createFrameScheduler();
    const store = createTranscriptPositionStore(frames.scheduler);
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish(null);
    expect(frames.scheduler.request).not.toHaveBeenCalled();

    store.publish(1);
    store.publish(2);
    store.publish(3);

    expect(store.getSnapshot()).toBeNull();
    expect(frames.scheduler.request).toHaveBeenCalledTimes(1);
    frames.flush();
    expect(store.getSnapshot()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);

    store.publish(3);
    frames.flush();
    expect(listener).toHaveBeenCalledTimes(1);

    store.publish(null);
    frames.flush();
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("cancels unpublished positions when disposed", () => {
    const frames = createFrameScheduler();
    const store = createTranscriptPositionStore(frames.scheduler);
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish(1);
    store.dispose();
    frames.flush();

    expect(frames.scheduler.cancel).toHaveBeenCalledWith(1);
    expect(store.getSnapshot()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});
