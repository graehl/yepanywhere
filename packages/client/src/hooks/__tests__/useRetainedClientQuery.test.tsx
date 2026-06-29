import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetClientQueryControllerForTests } from "../../lib/clientQueryController";
import {
  asClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "../../lib/clientSummaryStore";
import { useRetainedClientQuery } from "../useRetainedClientQuery";

const busMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    on: vi.fn((event: string, handler: () => void) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => handlers.get(event)?.delete(handler);
    }),
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
    reset() {
      handlers.clear();
    },
  };
});

vi.mock("../../lib/activityBus", () => ({
  activityBus: { on: busMock.on },
}));

const SOURCE = asClientSummarySourceKey("host:test");

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function renderRetainedQuery({
  sourceKey = SOURCE,
  ready = true,
  fetcher = vi.fn(async () => "loaded"),
  applySnapshot = vi.fn(),
}: {
  sourceKey?: ClientSummarySourceKey;
  ready?: boolean;
  fetcher?: ReturnType<typeof vi.fn<() => Promise<string>>>;
  applySnapshot?: ReturnType<typeof vi.fn>;
} = {}) {
  return renderHook(
    (props: { ready: boolean }) =>
      useRetainedClientQuery({
        sourceKey,
        key: { endpoint: "test" },
        ready: props.ready,
        debounceMs: 50,
        revalidateOn: ["refresh", "reconnect"],
        fetcher,
        applySnapshot,
      }),
    { initialProps: { ready } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  busMock.reset();
  busMock.on.mockClear();
  resetClientQueryControllerForTests();
});

afterEach(() => {
  cleanup();
  resetClientQueryControllerForTests();
  vi.useRealTimers();
});

describe("useRetainedClientQuery", () => {
  it("does not fetch before ready and fetches when ready flips true", async () => {
    const fetcher = vi.fn(async () => "loaded");
    const applySnapshot = vi.fn();
    const hook = renderRetainedQuery({
      ready: false,
      fetcher,
      applySnapshot,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(hook.result.current.loading).toBe(true);

    hook.rerender({ ready: true });

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(hook.result.current.loading).toBe(false);
    expect(applySnapshot).toHaveBeenCalledWith(
      "loaded",
      expect.objectContaining({ sourceKey: SOURCE }),
    );
  });

  it("coalesces refresh and reconnect events into one forced request", async () => {
    const fetcher = vi.fn(async () => "loaded");
    renderRetainedQuery({ fetcher });

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      busMock.emit("refresh");
      busMock.emit("reconnect");
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps background revalidation errors quiet after data has loaded", async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("loaded")
      .mockRejectedValueOnce(new Error("offline"));
    const hook = renderRetainedQuery({ fetcher });

    await settle();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).toBeNull();

    await act(async () => {
      busMock.emit("refresh");
      await vi.advanceTimersByTimeAsync(50);
    });

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.loading).toBe(false);
  });

  it("cleans up subscriptions and pending timers on unmount", async () => {
    const fetcher = vi.fn(async () => "loaded");
    const hook = renderRetainedQuery({ fetcher });
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      busMock.emit("refresh");
    });
    hook.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      busMock.emit("reconnect");
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
