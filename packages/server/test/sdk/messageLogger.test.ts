import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

class FailingWriteStream extends EventEmitter {
  destroy = vi.fn();
  end = vi.fn();
  write = vi.fn(() => {
    queueMicrotask(() => {
      this.emit(
        "error",
        Object.assign(new Error("disk full"), { code: "ENOSPC" }),
      );
    });
    return true;
  });
}

async function mockFileStream(stream: FailingWriteStream) {
  const createWriteStream = vi.fn(() => stream);
  const mkdirSync = vi.fn();

  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
      ...actual,
      createWriteStream,
      mkdirSync,
    };
  });

  return { createWriteStream, mkdirSync };
}

describe("diagnostic message loggers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("disables raw SDK logging after an async stream error", async () => {
    vi.stubEnv("LOG_SDK_MESSAGES", "true");
    const stream = new FailingWriteStream();
    const { createWriteStream } = await mockFileStream(stream);
    const logger = await import("../../src/sdk/messageLogger.js");

    logger.initMessageLogger();
    expect(createWriteStream).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    logger.logSDKMessage(
      "session-a",
      { type: "result" },
      { provider: "claude" },
    );

    expect(stream.destroy).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1);
  });

  it("disables Codex correlation debug logging after an async stream error", async () => {
    vi.stubEnv("CODEX_CORRELATION_DEBUG", "true");
    const stream = new FailingWriteStream();
    const { createWriteStream } = await mockFileStream(stream);
    const logger = await import("../../src/codex/correlationDebugLogger.js");

    logger.initCodexCorrelationDebugLogger();
    expect(createWriteStream).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    logger.logCodexCorrelationDebug({
      sessionId: "session-a",
      channel: "sdk",
      authority: "transient",
    });

    expect(stream.destroy).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1);
  });
});
