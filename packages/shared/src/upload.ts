/**
 * File upload protocol types shared between client and server.
 * Uses WebSocket streaming with binary chunks.
 */

/** Metadata about an uploaded file */
export interface UploadedFile {
  /** Unique identifier (UUID) */
  id: string;
  /** Original filename from client */
  originalName: string;
  /** Sanitized filename on disk (UUID prefix + sanitized original) */
  name: string;
  /** Absolute path on server */
  path: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Image width in pixels, if known */
  width?: number;
  /** Image height in pixels, if known */
  height?: number;
}

/** Server-staged attachment metadata safe to persist in browser drafts/queues. */
export interface StagedAttachmentRef {
  /** Unique staged attachment identifier */
  id: string;
  /** Draft or staging batch identifier */
  batchId: string;
  /** Original filename from client */
  originalName: string;
  /** Sanitized filename on disk (UUID prefix + sanitized original) */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Image width in pixels, if known */
  width?: number;
  /** Image height in pixels, if known */
  height?: number;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/** Client -> Server: Start upload */
export interface UploadStartMessage {
  type: "start";
  /** Draft staging batch id. Only used by draft-staged upload endpoints. */
  batchId?: string;
  /** Original filename */
  name: string;
  /** Expected total size in bytes */
  size: number;
  /** MIME type (e.g., "image/png", "application/pdf") */
  mimeType: string;
  /** Image width in pixels, if known */
  width?: number;
  /** Image height in pixels, if known */
  height?: number;
}

/** Client -> Server: End upload */
export interface UploadEndMessage {
  type: "end";
}

/** Client -> Server: Cancel upload */
export interface UploadCancelMessage {
  type: "cancel";
}

/** Server -> Client: Progress update */
export interface UploadProgressMessage {
  type: "progress";
  bytesReceived: number;
}

/** Server -> Client: Session-scoped upload complete */
export interface UploadFileCompleteMessage {
  type: "complete";
  file: UploadedFile;
}

/** Server -> Client: Draft-staged upload complete */
export interface UploadStagedCompleteMessage {
  type: "complete";
  stagedRef: StagedAttachmentRef;
  batchId: string;
}

export type UploadCompleteMessage =
  | UploadFileCompleteMessage
  | UploadStagedCompleteMessage;

/** Server -> Client: Error occurred */
export interface UploadErrorMessage {
  type: "error";
  message: string;
  code?: string;
}

/** All client-to-server message types */
export type UploadClientMessage =
  | UploadStartMessage
  | UploadEndMessage
  | UploadCancelMessage;

/** All server-to-client message types */
export type UploadServerMessage =
  | UploadProgressMessage
  | UploadCompleteMessage
  | UploadErrorMessage;
