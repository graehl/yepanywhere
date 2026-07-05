import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

class FailingWriteStream extends EventEmitter {
  destroy = vi.fn();
  end = vi.fn();
  write = vi.fn((_chunk: Buffer, callback?: (error?: Error | null) => void) => {
    const error = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    queueMicrotask(() => {
      this.emit("error", error);
      callback?.(error);
    });
    return true;
  });
}

describe("AttachmentStagingService stream errors", () => {
  let stagingRoot: string | null = null;

  afterEach(async () => {
    vi.doUnmock("node:fs");
    vi.resetModules();
    if (stagingRoot) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
      stagingRoot = null;
    }
  });

  it("rejects staged upload writes when the file stream emits ENOSPC", async () => {
    stagingRoot = join(tmpdir(), `attachment-staging-stream-${randomUUID()}`);
    const stream = new FailingWriteStream();
    const createWriteStream = vi.fn(() => stream);

    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        createWriteStream,
      };
    });

    const { AttachmentStagingService } = await import(
      "../../src/uploads/AttachmentStagingService.js"
    );
    const service = new AttachmentStagingService({ stagingRoot });
    const started = await service.startDraftUpload({
      originalName: "file.txt",
      size: 5,
      mimeType: "text/plain",
    });

    await expect(
      service.writeChunk(started.uploadId, Buffer.from("hello")),
    ).rejects.toMatchObject({ code: "ENOSPC" });

    expect(createWriteStream).toHaveBeenCalledTimes(1);
    await expect(
      service.cancelUpload(started.uploadId),
    ).resolves.toBeUndefined();
  });
});
