import { describe, expect, it, vi } from "vitest";
import {
  type ComposerAttachment,
  isComposerStagedAttachment,
  revokeAttachmentPreviewUrls,
  toPersistedStagedAttachmentRef,
} from "../sessionComposerAttachments";

describe("session composer attachments", () => {
  it("detects staged attachments and strips preview URLs for persistence", () => {
    const staged = {
      id: "att-1",
      batchId: "batch-1",
      originalName: "photo.png",
      name: "photo.png",
      size: 123,
      mimeType: "image/png",
      width: 640,
      height: 480,
      createdAt: "2026-07-06T10:00:00.000Z",
      updatedAt: "2026-07-06T10:00:01.000Z",
      previewUrl: "blob:preview",
    };

    expect(isComposerStagedAttachment(staged)).toBe(true);
    expect(toPersistedStagedAttachmentRef(staged)).toEqual({
      id: "att-1",
      batchId: "batch-1",
      originalName: "photo.png",
      name: "photo.png",
      size: 123,
      mimeType: "image/png",
      width: 640,
      height: 480,
      createdAt: "2026-07-06T10:00:00.000Z",
      updatedAt: "2026-07-06T10:00:01.000Z",
    });
  });

  it("revokes only attachments with preview URLs", () => {
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const attachments: ComposerAttachment[] = [
      {
        id: "uploaded",
        name: "uploaded.png",
        originalName: "uploaded.png",
        size: 1,
        mimeType: "image/png",
        path: "/uploads/uploaded.png",
        previewUrl: "blob:uploaded",
      },
      {
        id: "staged",
        batchId: "batch",
        originalName: "staged.txt",
        name: "staged.txt",
        size: 2,
        mimeType: "text/plain",
        createdAt: "2026-07-06T10:00:00.000Z",
        updatedAt: "2026-07-06T10:00:00.000Z",
      },
    ];

    try {
      revokeAttachmentPreviewUrls(attachments);

      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:uploaded");
    } finally {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    }
  });
});
