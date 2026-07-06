import type { StagedAttachmentRef, UploadedFile } from "@yep-anywhere/shared";

export type ComposerUploadedAttachment = UploadedFile & { previewUrl?: string };
export type ComposerStagedAttachment = StagedAttachmentRef & {
  previewUrl?: string;
};
export type ComposerAttachment =
  | ComposerUploadedAttachment
  | ComposerStagedAttachment;

export function isComposerStagedAttachment(
  attachment: ComposerAttachment,
): attachment is ComposerStagedAttachment {
  return "batchId" in attachment;
}

export function toPersistedStagedAttachmentRef(
  attachment: ComposerStagedAttachment,
): StagedAttachmentRef {
  return {
    id: attachment.id,
    batchId: attachment.batchId,
    originalName: attachment.originalName,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
    ...(attachment.width !== undefined ? { width: attachment.width } : {}),
    ...(attachment.height !== undefined ? { height: attachment.height } : {}),
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

export function revokeAttachmentPreviewUrls(
  attachmentsToRevoke: readonly ComposerAttachment[],
): void {
  for (const attachment of attachmentsToRevoke) {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}
