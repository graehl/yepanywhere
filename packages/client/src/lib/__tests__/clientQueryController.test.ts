import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClientQueryKey,
  ensureClientQuery,
  getClientQueryState,
  invalidateClientQueries,
  invalidateClientQuery,
  resetClientQueryControllerForTests,
  retainClientQuery,
} from "../clientQueryController";
import {
  asClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "../clientSummaryStore";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SOURCE_A = asClientSummarySourceKey("host:a");
const SOURCE_B = asClientSummarySourceKey("host:b");

describe("clientQueryController", () => {
  beforeEach(() => {
    resetClientQueryControllerForTests();
    vi.useRealTimers();
  });

  it("serializes object keys stably", () => {
    expect(createClientQueryKey({ b: 2, a: 1 })).toBe(
      createClientQueryKey({ a: 1, b: 2 }),
    );
  });

  it("shares an in-flight request when coverage is compatible", async () => {
    const request = deferred<string>();
    const fetcher = vi.fn(() => request.promise);
    const applySnapshot = vi.fn();

    const first = ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 100 },
      fetcher,
      applySnapshot,
    });
    const second = ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
      applySnapshot,
    });

    expect(second).toBe(first);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    request.resolve("loaded");
    await Promise.all([first, second]);

    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(getClientQueryState(SOURCE_A, "global")).toMatchObject({
      coverage: { minRows: 100 },
      inFlight: false,
      stale: false,
    });
  });

  it("uses fresh compatible coverage without another fetch", async () => {
    const fetcher = vi.fn(async () => "loaded");
    const applySnapshot = vi.fn();

    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 100 },
      fetcher,
      applySnapshot,
    });
    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
      applySnapshot,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledTimes(1);
  });

  it("forces a new request even when compatible coverage is fresh", async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const applySnapshot = vi.fn();

    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 100 },
      fetcher,
      applySnapshot,
    });
    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      force: true,
      fetcher,
      applySnapshot,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(applySnapshot).toHaveBeenCalledTimes(2);
  });

  it("fetches again when cached coverage is insufficient", async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("small")
      .mockResolvedValueOnce("large");
    const applySnapshot = vi.fn();

    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 15 },
      fetcher,
      applySnapshot,
    });
    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
      applySnapshot,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(getClientQueryState(SOURCE_A, "global")?.coverage).toEqual({
      minRows: 50,
    });
  });

  it("isolates otherwise-identical queries by source", async () => {
    const fetcher = vi.fn(async () => "loaded");
    const appliedSources: ClientSummarySourceKey[] = [];

    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
      applySnapshot: (_result, context) => {
        appliedSources.push(context.sourceKey);
      },
    });
    await ensureClientQuery({
      sourceKey: SOURCE_B,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
      applySnapshot: (_result, context) => {
        appliedSources.push(context.sourceKey);
      },
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(appliedSources).toEqual([SOURCE_A, SOURCE_B]);
  });

  it("reports late responses with the source captured at request start", async () => {
    const firstRequest = deferred<string>();
    const secondRequest = deferred<string>();
    const fetcherA = vi.fn(() => firstRequest.promise);
    const fetcherB = vi.fn(() => secondRequest.promise);
    const applied: Array<{ sourceKey: ClientSummarySourceKey; result: string }> =
      [];

    const first = ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher: fetcherA,
      applySnapshot: (result, context) => {
        applied.push({ sourceKey: context.sourceKey, result });
      },
    });
    const second = ensureClientQuery({
      sourceKey: SOURCE_B,
      key: "global",
      coverage: { minRows: 50 },
      fetcher: fetcherB,
      applySnapshot: (result, context) => {
        applied.push({ sourceKey: context.sourceKey, result });
      },
    });

    secondRequest.resolve("second");
    await second;
    firstRequest.resolve("first");
    await first;

    expect(applied).toEqual([
      { sourceKey: SOURCE_B, result: "second" },
      { sourceKey: SOURCE_A, result: "first" },
    ]);
  });

  it("tracks retain counts and marks retained queries stale", async () => {
    const release = retainClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
    });
    expect(getClientQueryState(SOURCE_A, "global")?.retainedCount).toBe(1);

    const fetcher = vi.fn(async () => "loaded");
    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
    });

    invalidateClientQuery(SOURCE_A, "global");
    expect(getClientQueryState(SOURCE_A, "global")?.stale).toBe(true);

    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    release();
    expect(getClientQueryState(SOURCE_A, "global")?.retainedCount).toBe(0);
  });

  it("keeps a query stale when an older request settles after invalidation", async () => {
    const firstRequest = deferred<string>();
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce("fresh");

    const first = ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
    });
    await Promise.resolve();

    invalidateClientQuery(SOURCE_A, "global");
    firstRequest.resolve("old");
    await first;

    expect(getClientQueryState(SOURCE_A, "global")?.stale).toBe(true);

    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(getClientQueryState(SOURCE_A, "global")?.stale).toBe(false);
  });

  it("invalidates matching queries with a predicate", async () => {
    const fetcher = vi.fn(async () => "loaded");
    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "global",
      coverage: { minRows: 50 },
      fetcher,
    });
    await ensureClientQuery({
      sourceKey: SOURCE_A,
      key: "settings",
      fetcher,
    });

    invalidateClientQueries(
      (state) => state.sourceKey === SOURCE_A && state.key === "global",
    );

    expect(getClientQueryState(SOURCE_A, "global")?.stale).toBe(true);
    expect(getClientQueryState(SOURCE_A, "settings")?.stale).toBe(false);
  });
});
