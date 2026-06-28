import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttachmentStagingService } from "../../src/uploads/index.js";

async function completeDraftUpload(
  service: AttachmentStagingService,
  content: Buffer,
  options: {
    batchId?: string;
    originalName?: string;
    mimeType?: string;
    declaredSize?: number;
  } = {},
) {
  const started = await service.startDraftUpload({
    batchId: options.batchId,
    originalName: options.originalName ?? "screenshot.png",
    size: options.declaredSize ?? content.length,
    mimeType: options.mimeType ?? "image/png",
  });
  if (content.length > 0) {
    await service.writeChunk(started.uploadId, content);
  }
  const ref = await service.completeUpload(started.uploadId);
  return { ...started, ref };
}

describe("AttachmentStagingService", () => {
  let stagingRoot: string;

  beforeEach(async () => {
    stagingRoot = join(tmpdir(), `attachment-staging-${randomUUID()}`);
  });

  afterEach(async () => {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("completes draft uploads as path-free staged refs", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("image bytes"),
    );

    expect(ref.batchId).toBe(batchId);
    expect(ref.originalName).toBe("screenshot.png");
    expect(ref.name).toContain("screenshot.png");
    expect(ref.size).toBe("image bytes".length);
    expect("path" in ref).toBe(false);

    const stored = service.getRecord(ref.id);
    expect(stored?.path).toContain(stagingRoot);
    expect(await readFile(stored?.path ?? "", "utf-8")).toBe("image bytes");
  });

  it("rejects unsafe draft batch ids", async () => {
    const service = new AttachmentStagingService({ stagingRoot });

    await expect(
      service.startDraftUpload({
        batchId: "../escape",
        originalName: "file.txt",
        size: 1,
        mimeType: "text/plain",
      }),
    ).rejects.toThrow("Invalid staging batch id");
  });

  it("enforces max upload size before writing", async () => {
    const service = new AttachmentStagingService({
      stagingRoot,
      maxUploadSizeBytes: 4,
    });

    await expect(
      service.startDraftUpload({
        originalName: "file.txt",
        size: 5,
        mimeType: "text/plain",
      }),
    ).rejects.toThrow("File size exceeds maximum allowed size");
  });

  it("fails exact-size mismatches and removes partial files", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const started = await service.startDraftUpload({
      originalName: "file.txt",
      size: 100,
      mimeType: "text/plain",
    });
    await service.writeChunk(started.uploadId, Buffer.from("short"));

    await expect(service.completeUpload(started.uploadId)).rejects.toThrow(
      "Upload size mismatch",
    );
    expect(service.getRecord(started.uploadId)).toBeNull();
    await expect(stat(stagingRoot)).resolves.toBeTruthy();
    const refs = await service.listDraftAttachments(started.batchId);
    expect(refs).toEqual([]);
  });

  it("cancels uploads and deletes partial files", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const started = await service.startDraftUpload({
      originalName: "file.txt",
      size: 5,
      mimeType: "text/plain",
    });
    await service.writeChunk(started.uploadId, Buffer.from("hello"));

    await service.cancelUpload(started.uploadId);

    expect(service.getRecord(started.uploadId)).toBeNull();
    await expect(service.completeUpload(started.uploadId)).rejects.toThrow(
      "Staged upload not found",
    );
  });

  it("loads completed staged records after service restart", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("persisted"),
    );

    const reloaded = new AttachmentStagingService({ stagingRoot });
    const refs = await reloaded.listDraftAttachments(batchId);

    expect(refs).toEqual([ref]);
  });

  it("validates refs against ownership and on-disk files", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("valid"),
    );

    await expect(service.validateDraftRefs(batchId, [ref])).resolves.toEqual([
      ref,
    ]);
    await expect(
      service.validateDraftRefs("other-batch", [ref]),
    ).rejects.toThrow("Staged attachment not found");

    const record = service.getRecord(ref.id);
    await rm(record?.path ?? "", { force: true });
    await expect(service.validateDraftRefs(batchId, [ref])).rejects.toThrow(
      "Staged attachment is missing or invalid",
    );
  });

  it("deletes individual staged attachments", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("delete me"),
    );
    const record = service.getRecord(ref.id);

    await expect(service.deleteAttachment(ref.id)).resolves.toBe(true);

    await expect(stat(record?.path ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(service.listDraftAttachments(batchId)).resolves.toEqual([]);
  });

  it("transfers draft attachments to queue ownership", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("queue me"),
    );

    const queueRefs = await service.transferDraftAttachmentsToQueue({
      batchId,
      queueItemId: "queue-item-a",
      refs: [ref],
    });

    expect(queueRefs).toEqual([{ ...ref, updatedAt: queueRefs[0]?.updatedAt }]);
    await expect(service.listDraftAttachments(batchId)).resolves.toEqual([]);
    await expect(service.listQueueAttachments("queue-item-a")).resolves.toEqual(
      queueRefs,
    );
    const record = service.getRecord(ref.id);
    expect(record?.owner).toEqual({
      type: "project-queue",
      queueItemId: "queue-item-a",
    });
    expect(record?.path).toContain(join("queue", "queue-item-a"));
  });

  it("deletes queue-owned attachments by queue item", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("queued"),
    );
    await service.transferDraftAttachmentsToQueue({
      batchId,
      queueItemId: "queue-item-a",
      refs: [ref],
    });

    await expect(
      service.deleteQueueAttachments("queue-item-a"),
    ).resolves.toBe(1);
    await expect(service.listQueueAttachments("queue-item-a")).resolves.toEqual(
      [],
    );
  });

  it("cleans stale draft-owned records but keeps queue-owned records", async () => {
    let now = Date.parse("2026-06-28T00:00:00.000Z");
    const service = new AttachmentStagingService({
      stagingRoot,
      draftTtlMs: 1000,
      now: () => now,
    });
    const stale = await completeDraftUpload(service, Buffer.from("stale"));
    const queued = await completeDraftUpload(service, Buffer.from("queued"));
    await service.transferDraftAttachmentsToQueue({
      batchId: queued.batchId,
      queueItemId: "queue-item-a",
      refs: [queued.ref],
    });

    now += 1001;
    const reloaded = new AttachmentStagingService({
      stagingRoot,
      draftTtlMs: 1000,
      now: () => now,
    });

    await expect(reloaded.listDraftAttachments(stale.batchId)).resolves.toEqual(
      [],
    );
    await expect(reloaded.listQueueAttachments("queue-item-a")).resolves.toEqual(
      [expect.objectContaining({ id: queued.ref.id })],
    );
  });

  it("removes missing index records on startup", async () => {
    const service = new AttachmentStagingService({ stagingRoot });
    const { batchId, ref } = await completeDraftUpload(
      service,
      Buffer.from("gone"),
    );
    const record = service.getRecord(ref.id);
    await rm(record?.path ?? "", { force: true });

    const reloaded = new AttachmentStagingService({ stagingRoot });

    await expect(reloaded.listDraftAttachments(batchId)).resolves.toEqual([]);
  });

  it("removes partial files on startup", async () => {
    const partialDir = join(stagingRoot, "drafts", "batch-a");
    await mkdir(partialDir, { recursive: true });
    const partialPath = join(partialDir, "file.txt.partial");
    await writeFile(partialPath, "partial");

    const service = new AttachmentStagingService({ stagingRoot });
    await service.initialize();

    await expect(stat(partialPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
