import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  asClientSummarySourceKey,
  resetClientSummaryStoreForTests,
  setCurrentClientSummarySourceKey,
} from "../../clientSummaryStore";
import {
  getSourceRuntimeRegistry,
  resetSourceRuntimeRegistryForTests,
} from "../../sourceRuntime";
import { FakeSourceTransport } from "../../transport";
import { ClientLogCollector } from "../ClientLogCollector";

// Mock fetchJSON to avoid real network calls
vi.mock("../../../api/client", () => ({
  fetchJSON: vi.fn(() => Promise.resolve({ received: 0 })),
}));

import { fetchJSON } from "../../../api/client";

describe("ClientLogCollector", () => {
  let collector: ClientLogCollector;
  let transport: FakeSourceTransport;
  let origLog: typeof console.log;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;
  let testLog: typeof console.log;
  let testWarn: typeof console.warn;
  let testError: typeof console.error;

  beforeEach(() => {
    origLog = console.log;
    origWarn = console.warn;
    origError = console.error;
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    testLog = console.log;
    testWarn = console.warn;
    testError = console.error;
    resetClientSummaryStoreForTests();
    resetSourceRuntimeRegistryForTests();
    const sourceKey = asClientSummarySourceKey("test:client-log");
    setCurrentClientSummarySourceKey(sourceKey);
    transport = new FakeSourceTransport({
      kind: "secure",
      initialSnapshot: {
        kind: "secure",
        state: "disconnected",
        channels: [],
      },
    });
    getSourceRuntimeRegistry().registerSourceTransport(sourceKey, {
      kind: "custom",
      createTransport: () => transport,
    });
    vi.clearAllMocks();
    collector = new ClientLogCollector();
  });

  afterEach(() => {
    collector.stop();
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    resetSourceRuntimeRegistryForTests();
    resetClientSummaryStoreForTests();
  });

  it("captures console messages and flushes with deviceId", async () => {
    await collector.start();

    console.log("[ConnectionManager] connected → reconnecting");
    console.warn("warn message");
    console.error("error message");

    await new Promise((r) => setTimeout(r, 10));

    vi.mocked(fetchJSON).mockResolvedValueOnce({ received: 4 });
    await collector.flush();

    expect(fetchJSON).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      vi.mocked(fetchJSON).mock.calls[0]?.[1]?.body as string,
    );
    // Should have ClientInfo entry + 3 console entries
    expect(body.entries.length).toBeGreaterThanOrEqual(4);
    expect(
      body.entries.some((e: { prefix: string }) => e.prefix === "[ClientInfo]"),
    ).toBe(true);
    expect(
      body.entries.some(
        (e: { prefix: string }) => e.prefix === "[ConnectionManager]",
      ),
    ).toBe(true);
  });

  it("samples transcript-store memory in telemetry entries", async () => {
    await collector.start();
    await new Promise((r) => setTimeout(r, 10));

    vi.mocked(fetchJSON).mockResolvedValueOnce({ received: 2 });
    await collector.flush();

    const body = JSON.parse(
      vi.mocked(fetchJSON).mock.calls[0]?.[1]?.body as string,
    );
    const telemetry = body.entries.find(
      (e: { prefix: string }) => e.prefix === "[ClientTelemetry]",
    );
    expect(telemetry).toBeDefined();
    const payload = JSON.parse(
      (telemetry.message as string).replace("[ClientTelemetry] ", ""),
    );
    expect(payload.dom).toMatchObject({
      nodes: expect.any(Number),
      messageRows: expect.any(Number),
    });
    expect(payload.transcriptMemory).toMatchObject({
      totalBytes: expect.any(Number),
      liveRetainedBytes: expect.any(Number),
      liveRetainedEntryCount: expect.any(Number),
      warmCacheBytes: expect.any(Number),
      warmCacheEntryCount: expect.any(Number),
    });
  });

  it("restores console on stop", async () => {
    await collector.start();
    expect(console.log).not.toBe(testLog);

    collector.stop();
    expect(console.log).toBe(testLog);
    expect(console.warn).toBe(testWarn);
    expect(console.error).toBe(testError);
  });

  it("flushes when the current transport becomes ready", async () => {
    await collector.start();

    console.log("test entry");
    await new Promise((r) => setTimeout(r, 10));

    vi.mocked(fetchJSON).mockResolvedValueOnce({ received: 1 });

    transport.setState("ready");

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchJSON).toHaveBeenCalledTimes(1);
  });
});
