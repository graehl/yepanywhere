import type {
  PermissionMode,
  ProviderName,
  ShowThinking,
  ThinkingOption,
} from "./types.js";
import type { StagedAttachmentRef, UploadedFile } from "./upload.js";
import type { UrlProjectId } from "./projectId.js";
import type { UserMessageMetadata } from "./user-message-metadata.js";
import type { SessionQueuedMessageSummary } from "./app-types.js";

export type ProjectQueueItemStatus = "queued" | "dispatching" | "failed";

export type ProjectQueueDispatchPauseReason = "manual" | "restart";

export type ProjectQueueDispatchState =
  | { status: "running" }
  | {
      status: "paused";
      reason: ProjectQueueDispatchPauseReason;
      pausedAt: string;
    };

export type ProjectQueueClientSource =
  | "toolbar"
  | "projects-page"
  | "new-session";

export interface ProjectQueueMessage {
  text: string;
  attachments?: UploadedFile[];
  stagedAttachments?: ProjectQueueStagedAttachments;
  mode?: PermissionMode;
  metadata?: UserMessageMetadata;
}

export interface ProjectQueueStagedAttachments {
  batchId: string;
  refs: StagedAttachmentRef[];
  updatedAt: string;
}

export type ProjectQueueTarget =
  | {
      type: "existing-session";
      sessionId: string;
      provider?: ProviderName;
      mode?: PermissionMode;
      model?: string;
      serviceTier?: string;
      executor?: string;
      thinking?: ThinkingOption;
      showThinking?: ShowThinking;
    }
  | {
      type: "new-session";
      provider?: ProviderName;
      mode?: PermissionMode;
      model?: string;
      serviceTier?: string;
      executor?: string;
      title?: string;
      thinking?: ThinkingOption;
      showThinking?: ShowThinking;
    };

export interface ProjectQueueCreatedFrom {
  sessionId?: string;
  client?: ProjectQueueClientSource;
}

export interface ProjectQueueItem {
  id: string;
  projectId: UrlProjectId;
  projectPath: string;
  target: ProjectQueueTarget;
  message: ProjectQueueMessage;
  createdAt: string;
  updatedAt: string;
  createdFrom?: ProjectQueueCreatedFrom;
  status: ProjectQueueItemStatus;
  lastError?: string;
  lastAttemptAt?: string;
}

export interface ProjectQueueItemSummary {
  id: string;
  projectId: UrlProjectId;
  target: ProjectQueueTarget;
  messagePreview: string;
  message: ProjectQueueMessage;
  createdAt: string;
  updatedAt: string;
  createdFrom?: ProjectQueueCreatedFrom;
  status: ProjectQueueItemStatus;
  attachmentCount: number;
  lastError?: string;
  lastAttemptAt?: string;
}

export interface ProjectQueueRecoveredSessionQueueSummary
  extends SessionQueuedMessageSummary {
  id: string;
  sessionId: string;
  projectId: UrlProjectId;
  kind: "patient";
  status: "paused-after-restart";
  sessionTitle?: string;
}

export interface ProjectQueueResponse {
  projectId: UrlProjectId;
  items: ProjectQueueItemSummary[];
  dispatchState?: ProjectQueueDispatchState;
}

export interface ProjectQueueListResponse {
  items: ProjectQueueItemSummary[];
  dispatchState?: ProjectQueueDispatchState;
  recoveredSessionQueues?: ProjectQueueRecoveredSessionQueueSummary[];
}

export interface CreateProjectQueueItemRequest {
  target: ProjectQueueTarget;
  message: ProjectQueueMessage;
  createdFrom?: ProjectQueueCreatedFrom;
}

export interface UpdateProjectQueueItemRequest {
  target?: ProjectQueueTarget;
  message?: ProjectQueueMessage;
}

export interface ProjectQueueChangedEvent {
  type: "project-queue-changed";
  projectId: UrlProjectId;
  items: ProjectQueueItemSummary[];
  reason:
    | "created"
    | "updated"
    | "deleted"
    | "retry"
    | "paused"
    | "resumed"
    | "dispatching"
    | "released"
    | "promoted"
    | "failed";
  itemId?: string;
  dispatchState?: ProjectQueueDispatchState;
  timestamp: string;
}
