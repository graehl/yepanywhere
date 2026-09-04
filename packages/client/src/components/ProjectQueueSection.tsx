import type {
  ProjectQueueDispatchState,
  ProjectQueueItemSummary,
  ProjectQueueMessage,
  ProjectQueueProjectStatus,
  ProjectQueueRecoveredSessionQueueSummary,
  StagedAttachmentRef,
  UploadedFile,
} from "@yep-anywhere/shared";
import {
  type ClipboardEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import {
  getAttachmentUploadLongEdgePx,
  useAttachmentUploadQuality,
} from "../hooks/useAttachmentUploadQuality";
import { useI18n } from "../i18n";
import { makeAttachmentFileNamesUnique } from "../lib/attachmentFileNames";
import { useAttachmentNavigationGuard } from "../lib/attachmentNavigationGuard";
import { deleteDraftAttachmentRef } from "../lib/draftAttachmentStaging";
import {
  type ComposerAttachment,
  isComposerStagedAttachment,
  revokeAttachmentPreviewUrls,
  toPersistedStagedAttachmentRef,
} from "../lib/sessionComposerAttachments";
import { uploadComposerAttachmentFile } from "../lib/sessionComposerSubmission";
import { generateUUID } from "../lib/uuid";
import type { Project } from "../types";
import { AttachmentChip } from "./AttachmentChip";
import styles from "./ProjectQueueSection.module.css";

type Translate = ReturnType<typeof useI18n>["t"];

type ItemStatus = ProjectQueueItemSummary["status"];

const ITEM_STATUS_CLASS: Record<ItemStatus, string | undefined> = {
  queued: "",
  dispatching: styles.itemDispatching,
  failed: styles.itemFailed,
};

const ITEM_STATUS_BADGE_CLASS: Record<ItemStatus, string | undefined> = {
  queued: "",
  dispatching: styles.itemStatusDispatching,
  failed: styles.itemStatusFailed,
};

function cx(...classNames: (string | false | undefined)[]): string {
  return classNames.filter(Boolean).join(" ");
}

interface ProjectQueueSectionProps {
  projects: Project[];
  items: readonly ProjectQueueItemSummary[];
  recoveredSessionQueues?: ProjectQueueRecoveredSessionQueueSummary[];
  loading: boolean;
  error: Error | null;
  mutatingItemId: string | null;
  mutatingRecoveredQueueId: string | null;
  mutatingDispatchState: boolean;
  mutatingPromoteItemId: string | null;
  dispatchState: ProjectQueueDispatchState;
  projectStatusesByProject?: Record<string, ProjectQueueProjectStatus>;
  highlightedItemId?: string | null;
  basePath?: string;
  attachmentEditingEnabled?: boolean;
  onPauseDispatch: () => void;
  onResumeDispatch: () => void;
  onPromoteNow: (
    projectId: string,
    itemId: string,
    options?: { force?: boolean },
  ) => void;
  onDeleteItem: (projectId: string, itemId: string) => void;
  onResumeRecoveredItem: (sessionId: string, queueId: string) => void;
  onDeleteRecoveredItem: (sessionId: string, queueId: string) => void;
  onRetryItem: (projectId: string, itemId: string) => void;
  onMoveItemToTop: (projectId: string, itemId: string) => void;
  onUpdateItem: (
    projectId: string,
    itemId: string,
    message: ProjectQueueMessage,
  ) => Promise<void> | void;
}

interface UploadingAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  percent: number;
}

interface ProjectQueueAttachmentEditorProps {
  item: ProjectQueueItemSummary;
  disabled: boolean;
  onSave: (message: ProjectQueueMessage) => Promise<void> | void;
  onDiscard: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}\u202fb`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}\u202fkb`;
  if (bytes < 1024 * 1024 * 1024)
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}\u202fmb`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10}\u202fgb`;
}

function toPersistedUploadedFile(attachment: ComposerAttachment): UploadedFile {
  if (isComposerStagedAttachment(attachment)) {
    throw new Error("Expected a materialized attachment");
  }
  const { previewUrl: _previewUrl, ...uploadedFile } = attachment;
  return uploadedFile;
}

function ProjectQueueAttachmentEditor({
  item,
  disabled,
  onSave,
  onDiscard,
}: ProjectQueueAttachmentEditorProps) {
  const { t } = useI18n();
  const sourceTransport = useCurrentSourceRuntime().transport;
  const [attachmentQuality] = useAttachmentUploadQuality();
  const [text, setText] = useState(item.message.text);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() => [
    ...(item.message.attachments ?? []),
    ...(item.message.stagedAttachments?.refs ?? []),
  ]);
  const [uploading, setUploading] = useState<UploadingAttachment[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const attachmentsRef = useRef(attachments);
  const batchIdRef = useRef(item.message.stagedAttachments?.batchId ?? null);
  const addedStagedRefIds = useRef(new Set<string>());
  const removedUploadIds = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const savedRef = useRef(false);
  const sourceTransportRef = useRef(sourceTransport);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    sourceTransportRef.current = sourceTransport;
  }, [sourceTransport]);

  const deleteNewDraftRef = useCallback(
    (ref: StagedAttachmentRef) => {
      void deleteDraftAttachmentRef(sourceTransport, ref.batchId, ref.id).catch(
        (error) => {
          if (mountedRef.current) {
            setEditError(
              t("projectQueueInlineEditFailed", {
                message: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        },
      );
    },
    [sourceTransport, t],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!savedRef.current) {
        for (const attachment of attachmentsRef.current) {
          if (
            isComposerStagedAttachment(attachment) &&
            addedStagedRefIds.current.has(attachment.id)
          ) {
            void deleteDraftAttachmentRef(
              sourceTransportRef.current,
              attachment.batchId,
              attachment.id,
            ).catch(() => undefined);
          }
        }
      }
      revokeAttachmentPreviewUrls(attachmentsRef.current);
    };
  }, []);

  const hasUnsavedAttachments =
    uploading.length > 0 ||
    attachments.some((attachment) =>
      addedStagedRefIds.current.has(attachment.id),
    );
  useAttachmentNavigationGuard(hasUnsavedAttachments);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const uniqueFiles = makeAttachmentFileNamesUnique(files, [
        ...attachmentsRef.current.map((attachment) => attachment.originalName),
        ...uploading.map((attachment) => attachment.originalName),
      ]);
      if (uniqueFiles.length === 0) return;

      const batchId = batchIdRef.current ?? generateUUID();
      batchIdRef.current = batchId;
      setEditError(null);

      for (const file of uniqueFiles) {
        const tempId = `project-queue-upload-${generateUUID()}`;
        setUploading((current) => [
          ...current,
          {
            id: tempId,
            originalName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            percent: 0,
          },
        ]);

        void uploadComposerAttachmentFile({
          file,
          sourceTransport,
          projectId: item.projectId,
          sessionId: item.id,
          maxLongEdgePx: getAttachmentUploadLongEdgePx(attachmentQuality),
          stagedBatchId: batchId,
          onProgress: (bytesUploaded, uploadFile) => {
            const percent =
              uploadFile.size > 0
                ? Math.round((bytesUploaded / uploadFile.size) * 100)
                : 100;
            setUploading((current) =>
              current.map((attachment) =>
                attachment.id === tempId
                  ? { ...attachment, percent }
                  : attachment,
              ),
            );
          },
        })
          .then((uploaded) => {
            if (!isComposerStagedAttachment(uploaded)) {
              throw new Error("Project Queue uploads must remain staged");
            }
            const stagedAttachment = {
              ...uploaded,
              originalName: file.name,
            };
            const wasRemoved =
              removedUploadIds.current.delete(tempId) || !mountedRef.current;
            if (wasRemoved) {
              deleteNewDraftRef(stagedAttachment);
              revokeAttachmentPreviewUrls([stagedAttachment]);
              return;
            }
            addedStagedRefIds.current.add(stagedAttachment.id);
            setAttachments((current) => [...current, stagedAttachment]);
          })
          .catch((error) => {
            const wasRemoved = removedUploadIds.current.delete(tempId);
            if (!wasRemoved && mountedRef.current) {
              setEditError(
                t("projectQueueInlineEditFailed", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
              );
            }
          })
          .finally(() => {
            if (mountedRef.current) {
              setUploading((current) =>
                current.filter((attachment) => attachment.id !== tempId),
              );
            }
          });
      }
    },
    [attachmentQuality, deleteNewDraftRef, item, sourceTransport, t, uploading],
  );

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    const removed = attachmentsRef.current.find(
      (attachment) => attachment.id === attachmentId,
    );
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
    if (
      removed &&
      isComposerStagedAttachment(removed) &&
      addedStagedRefIds.current.delete(removed.id)
    ) {
      deleteNewDraftRef(removed);
    }
    if (removed) revokeAttachmentPreviewUrls([removed]);
  };

  const handleRemoveUpload = (uploadId: string) => {
    removedUploadIds.current.add(uploadId);
    setUploading((current) =>
      current.filter((attachment) => attachment.id !== uploadId),
    );
  };

  const canSave =
    !disabled &&
    uploading.length === 0 &&
    (text.trim().length > 0 || attachments.length > 0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    const uploadedFiles = attachments
      .filter((attachment) => !isComposerStagedAttachment(attachment))
      .map(toPersistedUploadedFile);
    const stagedRefs = attachments
      .filter(isComposerStagedAttachment)
      .map(toPersistedStagedAttachmentRef);
    const stagedBatchId = stagedRefs[0]?.batchId;
    if (stagedRefs.some((ref) => ref.batchId !== stagedBatchId)) {
      setEditError(
        t("projectQueueInlineEditFailed", {
          message: t("projectQueueAttachmentBatchMismatch"),
        }),
      );
      return;
    }

    setEditError(null);
    try {
      await onSave({
        ...item.message,
        text,
        attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        stagedAttachments:
          stagedRefs.length > 0 && stagedBatchId
            ? {
                batchId: stagedBatchId,
                refs: stagedRefs,
                updatedAt: new Date().toISOString(),
              }
            : undefined,
      });
      savedRef.current = true;
      onDiscard();
    } catch (error) {
      setEditError(
        t("projectQueueInlineEditFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <form className={styles.itemEdit} onSubmit={handleSubmit}>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={handlePaste}
        aria-label={t("projectQueueEditMessageLabel")}
        disabled={disabled}
        rows={3}
      />
      {(attachments.length > 0 || uploading.length > 0) && (
        <div className={styles.itemEditAttachments}>
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachmentId={attachment.id}
              originalName={attachment.originalName}
              path={
                isComposerStagedAttachment(attachment)
                  ? undefined
                  : attachment.path
              }
              mimeType={attachment.mimeType}
              sizeLabel={formatSize(attachment.size)}
              imageWidth={attachment.width}
              imageHeight={attachment.height}
              previewUrl={attachment.previewUrl}
              projectId={item.projectId}
              onRemove={
                disabled
                  ? undefined
                  : () => handleRemoveAttachment(attachment.id)
              }
            />
          ))}
          {uploading.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              originalName={attachment.originalName}
              mimeType={attachment.mimeType}
              sizeLabel={`${attachment.percent}%`}
              onRemove={() => handleRemoveUpload(attachment.id)}
            />
          ))}
        </div>
      )}
      {editError && <div className={styles.itemError}>{editError}</div>}
      <div className={styles.itemEditActions}>
        <button
          type="submit"
          disabled={!canSave}
          className="project-queue-item__save"
        >
          {t("projectQueueSave")}
        </button>
        <button type="button" disabled={disabled} onClick={onDiscard}>
          {t("projectQueueDiscard")}
        </button>
      </div>
    </form>
  );
}

function formatRelativeTime(timestamp: string, t: Translate): string {
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Math.max(0, Date.now() - then);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t("projectQueueAgeJustNow");
  if (diffMins < 60) return t("projectQueueAgeMinutes", { count: diffMins });
  if (diffHours < 24) return t("projectQueueAgeHours", { count: diffHours });
  if (diffDays < 7) return t("projectQueueAgeDays", { count: diffDays });
  return new Date(timestamp).toLocaleDateString();
}

function targetLabel(item: ProjectQueueItemSummary, t: Translate): string {
  const targetTitle = item.targetTitle?.trim();
  if (targetTitle) return targetTitle;
  return item.target.type === "new-session"
    ? t("projectQueueTargetNewSession")
    : t("projectQueueTargetSession", {
        sessionId: item.target.sessionId.slice(0, 8),
      });
}

function statusLabel(
  status: ProjectQueueItemSummary["status"],
  t: Translate,
): string {
  switch (status) {
    case "dispatching":
      return t("projectQueueStatusDispatching");
    case "failed":
      return t("projectQueueStatusFailed");
    case "queued":
      return t("projectQueueStatusQueued");
  }
}

function formatDurationSeconds(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return t("projectQueueReadinessSeconds", { seconds });
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function formatProjectQueueBlocker(blocker: string, t: Translate): string {
  if (blocker === "worker-queue") return t("projectQueueBlockerWorkerQueue");
  if (blocker === "project-queue:first-failed") {
    return t("projectQueueBlockerFirstFailed");
  }
  if (blocker.startsWith("recovered-session-queue:")) {
    const count = blocker.split(":")[1] ?? "?";
    return t("projectQueueBlockerRecoveredSessionQueue", { count });
  }

  const [sessionId, reason] = blocker.split(":");
  const session = shortSessionId(sessionId ?? "");
  switch (reason) {
    case "in-turn":
      return t("projectQueueBlockerInTurn", { session });
    case "waiting-input":
      return t("projectQueueBlockerWaitingInput", { session });
    case "provider-retained":
      return t("projectQueueBlockerProviderRetained", { session });
    case "direct-queue":
      return t("projectQueueBlockerDirectQueue", { session });
    case "deferred-queue":
      return t("projectQueueBlockerDeferredQueue", { session });
    case "pending-input":
      return t("projectQueueBlockerPendingInput", { session });
    case "user-starting":
      return t("projectQueueBlockerUserStarting", { session });
    case "external":
      return t("projectQueueBlockerExternal", { session });
    default:
      if (reason?.startsWith("liveness-")) {
        return t("projectQueueBlockerLiveness", {
          session,
          status: reason.slice("liveness-".length),
        });
      }
      return t("projectQueueBlockerUnknown", { blocker });
  }
}

function summarizeBlockers(blockers: readonly string[], t: Translate): string {
  const formatted = blockers
    .slice(0, 3)
    .map((blocker) => formatProjectQueueBlocker(blocker, t));
  if (blockers.length > formatted.length) {
    formatted.push(
      t("projectQueueBlockerMore", {
        count: blockers.length - formatted.length,
      }),
    );
  }
  return formatted.join("; ");
}

function readinessLabel(
  status: ProjectQueueProjectStatus | undefined,
  nowMs: number,
  t: Translate,
): string | null {
  if (!status) return null;
  switch (status.state) {
    case "paused":
      return t("projectQueueReadinessPaused");
    case "blocked":
      return t("projectQueueReadinessBlocked", {
        blockers: summarizeBlockers(status.blockers, t),
      });
    case "waiting-quiet": {
      const eligibleAt = status.quietEligibleAt
        ? new Date(status.quietEligibleAt).getTime()
        : Number.NaN;
      const waitMs = Number.isFinite(eligibleAt)
        ? Math.max(0, eligibleAt - nowMs)
        : status.quietWindowMs;
      return t("projectQueueReadinessWaitingQuiet", {
        duration: formatDurationSeconds(waitMs, t),
      });
    }
    case "ready":
      return t("projectQueueReadinessReady");
    case "dispatching":
      return t("projectQueueReadinessDispatching");
    case "empty":
      return t("projectQueueReadinessEmpty");
  }
}

function maxResumeQuietWindowMs(
  items: readonly ProjectQueueItemSummary[],
  projectStatusesByProject: Record<string, ProjectQueueProjectStatus>,
): number | null {
  let maxQuietWindowMs: number | null = null;
  const projectIds = new Set(items.map((item) => item.projectId));
  for (const projectId of projectIds) {
    const quietWindowMs = projectStatusesByProject[projectId]?.quietWindowMs;
    if (
      typeof quietWindowMs !== "number" ||
      !Number.isFinite(quietWindowMs) ||
      quietWindowMs <= 0
    ) {
      continue;
    }
    maxQuietWindowMs =
      maxQuietWindowMs === null
        ? quietWindowMs
        : Math.max(maxQuietWindowMs, quietWindowMs);
  }
  return maxQuietWindowMs;
}

function pausedNotice(
  pausedState: Extract<ProjectQueueDispatchState, { status: "paused" }>,
  items: readonly ProjectQueueItemSummary[],
  projectStatusesByProject: Record<string, ProjectQueueProjectStatus>,
  t: Translate,
): string {
  const quietWindowMs = maxResumeQuietWindowMs(items, projectStatusesByProject);
  if (quietWindowMs !== null) {
    return pausedState.reason === "restart"
      ? t("projectQueuePausedAfterRestartNoticeWithDelay", {
          duration: formatDurationSeconds(quietWindowMs, t),
        })
      : t("projectQueuePausedNoticeWithDelay", {
          duration: formatDurationSeconds(quietWindowMs, t),
        });
  }

  return pausedState.reason === "restart"
    ? t("projectQueuePausedAfterRestartNotice")
    : t("projectQueuePausedNotice");
}

function sessionLabel(
  item: ProjectQueueRecoveredSessionQueueSummary,
  t: Translate,
): string {
  return (
    item.sessionTitle?.trim() ||
    t("projectQueueTargetSession", {
      sessionId: item.sessionId.slice(0, 8),
    })
  );
}

interface RecoveredSessionQueueGroup {
  key: string;
  projectId: string;
  sessionId: string;
  sessionTitle?: string;
  items: ProjectQueueRecoveredSessionQueueSummary[];
}

interface ProjectQueueDisplayGroup {
  projectId: string;
  projectName: string;
  items: ProjectQueueItemSummary[];
}

function groupRecoveredSessionQueues(
  items: readonly ProjectQueueRecoveredSessionQueueSummary[],
): RecoveredSessionQueueGroup[] {
  const groups = new Map<string, RecoveredSessionQueueGroup>();
  for (const item of items) {
    const key = `${item.projectId}:${item.sessionId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        projectId: item.projectId,
        sessionId: item.sessionId,
        ...(item.sessionTitle ? { sessionTitle: item.sessionTitle } : {}),
        items: [item],
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => {
        const queued = (left.queuedAt ?? left.timestamp).localeCompare(
          right.queuedAt ?? right.timestamp,
        );
        return queued !== 0 ? queued : left.id.localeCompare(right.id);
      }),
    }))
    .sort((left, right) => {
      const project = left.projectId.localeCompare(right.projectId);
      if (project !== 0) return project;
      const leftQueued =
        left.items[0]?.queuedAt ?? left.items[0]?.timestamp ?? "";
      const rightQueued =
        right.items[0]?.queuedAt ?? right.items[0]?.timestamp ?? "";
      const queued = leftQueued.localeCompare(rightQueued);
      return queued !== 0
        ? queued
        : left.sessionId.localeCompare(right.sessionId);
    });
}

function compareDisplayNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function groupProjectQueueItems(
  items: readonly ProjectQueueItemSummary[],
  projectById: Map<string, Project>,
  t: Translate,
): ProjectQueueDisplayGroup[] {
  const groups = new Map<string, ProjectQueueDisplayGroup>();
  for (const item of items) {
    const existing = groups.get(item.projectId);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(item.projectId, {
      projectId: item.projectId,
      projectName:
        projectById.get(item.projectId)?.name ??
        t("projectQueueUnknownProject"),
      items: [item],
    });
  }

  return [...groups.values()].sort((left, right) => {
    const name = compareDisplayNames(left.projectName, right.projectName);
    return name !== 0 ? name : left.projectId.localeCompare(right.projectId);
  });
}

function isFirstMovableProjectQueueItem(
  item: ProjectQueueItemSummary,
  items: readonly ProjectQueueItemSummary[],
): boolean {
  const firstMovable = items.find(
    (candidate) =>
      candidate.projectId === item.projectId &&
      candidate.status !== "dispatching",
  );
  return firstMovable?.id === item.id;
}

export function ProjectQueueSection({
  projects,
  items,
  recoveredSessionQueues = [],
  loading,
  error,
  mutatingItemId,
  mutatingRecoveredQueueId,
  mutatingDispatchState,
  mutatingPromoteItemId,
  dispatchState,
  projectStatusesByProject = {},
  highlightedItemId,
  basePath = "",
  attachmentEditingEnabled = false,
  onPauseDispatch,
  onResumeDispatch,
  onPromoteNow,
  onDeleteItem,
  onResumeRecoveredItem,
  onDeleteRecoveredItem,
  onRetryItem,
  onMoveItemToTop,
  onUpdateItem,
}: ProjectQueueSectionProps) {
  const { t } = useI18n();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const highlightedItemRef = useRef<HTMLLIElement | null>(null);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const itemGroups = groupProjectQueueItems(items, projectById, t);
  const recoveredGroups = groupRecoveredSessionQueues(recoveredSessionQueues);
  const recoveredCount = recoveredSessionQueues.length;
  const hasProjectQueueItems = items.length > 0;
  const hasContent = hasProjectQueueItems || recoveredCount > 0;
  const highlightedItemIndex = highlightedItemId
    ? items.findIndex((item) => item.id === highlightedItemId)
    : -1;
  const pausedState =
    dispatchState.status === "paused" ? dispatchState : undefined;
  const description = pausedState
    ? pausedState.reason === "restart"
      ? t("projectQueuePausedAfterRestartDescription")
      : t("projectQueuePausedDescription")
    : t("projectQueueDescription");

  useEffect(() => {
    if (!editingItemId) return;
    if (items.some((item) => item.id === editingItemId)) return;
    setEditingItemId(null);
    setEditText("");
  }, [editingItemId, items]);

  useEffect(() => {
    if (!highlightedItemId || highlightedItemIndex < 0) return;
    highlightedItemRef.current?.scrollIntoView?.({
      block: "center",
      behavior: "smooth",
    });
  }, [highlightedItemId, highlightedItemIndex]);

  useEffect(() => {
    if (!hasProjectQueueItems) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasProjectQueueItems]);

  if (!hasContent && !error) return null;

  return (
    <section className={styles.section} aria-labelledby="project-queue-title">
      <div className={styles.header}>
        <div>
          <h2 id="project-queue-title">{t("projectQueueTitle")}</h2>
          <p>{description}</p>
        </div>
        <div className={styles.headerActions}>
          {hasProjectQueueItems && (
            <span className={styles.count}>
              {loading
                ? t("projectQueueRefreshing")
                : t("projectQueueCount", { count: items.length })}
            </span>
          )}
          {hasProjectQueueItems && (
            <button
              type="button"
              className={styles.dispatchButton}
              onClick={pausedState ? onResumeDispatch : onPauseDispatch}
              disabled={mutatingDispatchState}
            >
              {pausedState ? t("projectQueueResume") : t("projectQueuePause")}
            </button>
          )}
        </div>
      </div>

      {pausedState && hasProjectQueueItems && (
        <div className={styles.notice}>
          {pausedNotice(pausedState, items, projectStatusesByProject, t)}
        </div>
      )}

      {error && (
        <div className={styles.sectionError}>
          {t("projectQueueLoadError", { message: error.message })}
        </div>
      )}

      {recoveredGroups.length > 0 && (
        <div className={styles.recovered}>
          <div className={styles.recoveredHeader}>
            <h3>{t("projectQueueRecoveredTitle")}</h3>
            <span className={styles.recoveredCount}>
              {t("projectQueueRecoveredCount", { count: recoveredCount })}
            </span>
          </div>
          <ul className={styles.recoveredGroups}>
            {recoveredGroups.map((group) => {
              const project = projectById.get(group.projectId);
              const firstItem = group.items[0];
              const label = firstItem
                ? sessionLabel(firstItem, t)
                : t("projectQueueTargetSession", {
                    sessionId: group.sessionId.slice(0, 8),
                  });
              return (
                <li className={styles.recoveredGroup} key={group.key}>
                  <div className={styles.recoveredGroupHeader}>
                    <span className={styles.recoveredProject}>
                      {project?.name ?? t("projectQueueUnknownProject")}
                    </span>
                    <Link
                      className={styles.recoveredSession}
                      to={`${basePath}/projects/${group.projectId}/sessions/${group.sessionId}`}
                    >
                      {label}
                    </Link>
                    <span className={styles.recoveredStatus}>
                      {t("sessionRecoveredQueuedPaused")}
                    </span>
                  </div>
                  <ul className={styles.recoveredMessages}>
                    {group.items.map((item) => {
                      const isMutatingRecovered =
                        mutatingRecoveredQueueId === item.id;
                      const recoveredMutationPending =
                        mutatingRecoveredQueueId !== null;
                      return (
                        <li
                          className={styles.recoveredMessage}
                          key={item.id}
                          data-recovered-queue-id={item.id}
                          aria-busy={isMutatingRecovered || undefined}
                        >
                          <div className={styles.recoveredMessageContent}>
                            <span className={styles.recoveredPreview}>
                              {item.content || t("projectQueueAttachmentOnly")}
                            </span>
                            <span className={styles.recoveredAge}>
                              {formatRelativeTime(
                                item.queuedAt ?? item.timestamp,
                                t,
                              )}
                            </span>
                          </div>
                          <div className={styles.recoveredMessageActions}>
                            <button
                              type="button"
                              onClick={() =>
                                onResumeRecoveredItem(item.sessionId, item.id)
                              }
                              disabled={recoveredMutationPending}
                              aria-label={t("sessionRecoveredQueuedResume")}
                              title={t("sessionRecoveredQueuedResume")}
                            >
                              {t("projectQueueResume")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onDeleteRecoveredItem(item.sessionId, item.id)
                              }
                              disabled={recoveredMutationPending}
                              aria-label={t("sessionRecoveredQueuedDelete")}
                              title={t("sessionRecoveredQueuedDelete")}
                            >
                              {t("projectQueueDelete")}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasProjectQueueItems && (
        <ul className={styles.groups}>
          {itemGroups.map((group) => (
            <li className={styles.group} key={group.projectId}>
              <h3 className={styles.groupTitle}>{group.projectName}</h3>
              <ul className={styles.list}>
                {group.items.map((item) => {
                  const isMutating = mutatingItemId === item.id;
                  const isPromoting = mutatingPromoteItemId === item.id;
                  const isDispatching = item.status === "dispatching";
                  const isEditing = editingItemId === item.id;
                  const isHighlighted = highlightedItemId === item.id;
                  const canEdit =
                    item.status === "queued" || item.status === "failed";
                  const projectStatus =
                    projectStatusesByProject[item.projectId];
                  const readiness = readinessLabel(projectStatus, nowMs, t);
                  const blockerSummary = projectStatus
                    ? summarizeBlockers(projectStatus.blockers, t)
                    : "";
                  const forceStart =
                    item.status === "queued" &&
                    (projectStatus?.state === "blocked" ||
                      (pausedState !== undefined &&
                        projectStatus !== undefined &&
                        projectStatus.blockers.length > 0));
                  const canPromote =
                    item.status === "queued" &&
                    projectStatus?.state !== "dispatching";
                  const canMoveToTop =
                    canEdit && !isFirstMovableProjectQueueItem(item, items);
                  const canSaveEdit =
                    !isMutating &&
                    (editText.trim().length > 0 ||
                      (item.message.attachments?.length ?? 0) > 0 ||
                      (item.message.stagedAttachments?.refs.length ?? 0) > 0);
                  const handleEditSubmit = async (
                    event: FormEvent<HTMLFormElement>,
                  ) => {
                    event.preventDefault();
                    if (!canSaveEdit) return;
                    try {
                      await onUpdateItem(item.projectId, item.id, {
                        ...item.message,
                        text: editText,
                      });
                      setEditingItemId(null);
                      setEditText("");
                    } catch {
                      // The queue hook exposes the mutation error in this section.
                    }
                  };
                  return (
                    <li
                      key={item.id}
                      ref={isHighlighted ? highlightedItemRef : undefined}
                      className={cx(
                        styles.item,
                        ITEM_STATUS_CLASS[item.status],
                        isHighlighted && styles.itemHighlighted,
                      )}
                      data-project-queue-item-id={item.id}
                    >
                      <div className={styles.itemMain}>
                        <div className={styles.itemMeta}>
                          <span className={styles.itemTarget}>
                            {item.target.type === "existing-session" ? (
                              <Link
                                to={`${basePath}/projects/${item.projectId}/sessions/${item.target.sessionId}`}
                              >
                                {targetLabel(item, t)}
                              </Link>
                            ) : (
                              targetLabel(item, t)
                            )}
                          </span>
                          <span className={styles.itemAge}>
                            {formatRelativeTime(item.createdAt, t)}
                          </span>
                        </div>
                        {isEditing && attachmentEditingEnabled ? (
                          <ProjectQueueAttachmentEditor
                            item={item}
                            disabled={isMutating}
                            onSave={(message) =>
                              onUpdateItem(item.projectId, item.id, message)
                            }
                            onDiscard={() => {
                              setEditingItemId(null);
                              setEditText("");
                            }}
                          />
                        ) : isEditing ? (
                          <form
                            className={styles.itemEdit}
                            onSubmit={handleEditSubmit}
                          >
                            <textarea
                              value={editText}
                              onChange={(event) =>
                                setEditText(event.target.value)
                              }
                              aria-label={t("projectQueueEditMessageLabel")}
                              disabled={isMutating}
                              rows={3}
                            />
                            <div className={styles.itemEditActions}>
                              <button
                                type="submit"
                                disabled={!canSaveEdit}
                                className="project-queue-item__save"
                              >
                                {t("projectQueueSave")}
                              </button>
                              <button
                                type="button"
                                disabled={isMutating}
                                onClick={() => {
                                  setEditingItemId(null);
                                  setEditText("");
                                }}
                              >
                                {t("projectQueueDiscard")}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className={styles.itemPreview}>
                            {item.messagePreview ||
                              t("projectQueueAttachmentOnly")}
                          </div>
                        )}
                        {item.lastError && (
                          <div className={styles.itemError}>
                            {item.lastError}
                          </div>
                        )}
                        {readiness && (
                          <div className={styles.itemReadiness}>
                            {readiness}
                          </div>
                        )}
                      </div>

                      <div className={styles.itemSide}>
                        <span
                          className={cx(
                            styles.itemStatus,
                            ITEM_STATUS_BADGE_CLASS[item.status],
                          )}
                        >
                          {statusLabel(item.status, t)}
                        </span>
                        <div className={styles.itemActions}>
                          {pausedState && !isEditing && (
                            <button
                              type="button"
                              onClick={onResumeDispatch}
                              disabled={mutatingDispatchState}
                            >
                              {t("projectQueueResume")}
                            </button>
                          )}
                          {canPromote && !isEditing && (
                            <button
                              type="button"
                              className={
                                forceStart ? styles.forceStart : undefined
                              }
                              onClick={() =>
                                onPromoteNow(item.projectId, item.id, {
                                  force: forceStart,
                                })
                              }
                              disabled={isMutating || isPromoting}
                              title={
                                forceStart
                                  ? t("projectQueueForceStartTitle", {
                                      blockers: blockerSummary,
                                    })
                                  : t("projectQueueStartNowTitle")
                              }
                            >
                              {isPromoting
                                ? t("projectQueuePromoting")
                                : forceStart
                                  ? t("projectQueueForceStart")
                                  : t("projectQueueStartNow")}
                            </button>
                          )}
                          {item.status === "failed" && !isEditing && (
                            <button
                              type="button"
                              onClick={() =>
                                onRetryItem(item.projectId, item.id)
                              }
                              disabled={isMutating}
                            >
                              {t("projectQueueRetry")}
                            </button>
                          )}
                          {canEdit && editingItemId === null && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingItemId(item.id);
                                setEditText(item.message.text);
                              }}
                              disabled={isMutating}
                            >
                              {t("projectQueueEdit")}
                            </button>
                          )}
                          {canMoveToTop && !isEditing && (
                            <button
                              type="button"
                              onClick={() =>
                                onMoveItemToTop(item.projectId, item.id)
                              }
                              disabled={isMutating}
                            >
                              {t("projectQueueMoveToTop")}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onDeleteItem(item.projectId, item.id)
                            }
                            disabled={isMutating || isDispatching}
                          >
                            {t("projectQueueDelete")}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
