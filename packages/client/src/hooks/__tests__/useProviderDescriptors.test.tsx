import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProviderDescriptors } from "../useProviderDescriptors";

const state = vi.hoisted(() => ({
  source: "descriptors:first",
  fetch: vi.fn(),
}));
vi.mock("../../lib/clientSummaryStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/clientSummaryStore")>()),
  useClientSummarySourceKey: () => state.source,
}));
vi.mock("../../lib/sourceRuntime", () => ({
  getSourceRuntimeRegistry: () => ({
    getOrCreateSourceRuntime: (source: string) => ({
      transport: { fetch: (path: string) => state.fetch(source, path) },
    }),
  }),
}));
vi.mock("../../lib/activityBus", () => ({
  activityBus: { on: () => () => {} },
}));
afterEach(cleanup);

describe("provider descriptors", () => {
  it("makes no unsupported request when capability is absent", async () => {
    state.source = "descriptors:old-server";
    state.fetch.mockClear();
    const { result } = renderHook(() => useProviderDescriptors(false));
    await act(async () => {});
    expect(state.fetch).not.toHaveBeenCalled();
    expect(result.current.providers).toBeUndefined();
  });

  it("shares a source request and never shows another source's identities", async () => {
    state.source = "descriptors:first";
    const rows = [{ name: "claude", displayName: "Claude" }];
    let finish!: (value: { providers: typeof rows }) => void;
    state.fetch.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = renderHook(() => useProviderDescriptors(true));
    const second = renderHook(() => useProviderDescriptors(true));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    expect(state.fetch).toHaveBeenCalledWith(
      "descriptors:first",
      "/providers/descriptors",
    );
    await act(async () => finish({ providers: rows }));
    expect(first.result.current.providers).toEqual(rows);
    expect(second.result.current.providers).toEqual(rows);

    const nextRows = [{ name: "pi", displayName: "Pi" }];
    state.fetch.mockResolvedValueOnce({ providers: nextRows });
    state.source = "descriptors:second";
    first.rerender();
    expect(first.result.current.providers).toBeUndefined();
    await waitFor(() =>
      expect(first.result.current.providers).toEqual(nextRows),
    );
    expect(state.fetch).toHaveBeenLastCalledWith(
      "descriptors:second",
      "/providers/descriptors",
    );
  });
});
