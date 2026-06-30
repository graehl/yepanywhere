import type {
  ProjectQueueDispatchState,
  ProjectQueueItemSummary,
  ProjectQueueMessage,
  ProjectQueueRecoveredSessionQueueSummary,
} from "@yep-anywhere/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import type { Project } from "../types";

type Translate = ReturnType<typeof useI18n>["t"];

interface ProjectQueueSectionProps {
  projects: Project[];
  items: ProjectQueueItemSummary[];
  recoveredSessionQueues?: ProjectQueueRecoveredSessionQueueSummary[];
  loading: boolean;
  error: Error | null;
  mutatingItemId: string | null;
  mutatingDispatchState: boolean;
  dispatchState: ProjectQueueDispatchState;
  highlightedItemId?: string | null;
  basePath?: string;
  onPauseDispatch: () => void;
  onResumeDispatch: () => void;
  onDeleteItem: (projectId: string, itemId: string) => void;
  onRetryItem: (projectId: string, itemId: string) => void;
  onUpdateItem: (
    projectId: string,
    itemId: string,
    message: ProjectQueueMessage,
  ) => Promise<void> | void;
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

export function ProjectQueueSection({
  projects,
  items,
  recoveredSessionQueues = [],
  loading,
  error,
  mutatingItemId,
  mutatingDispatchState,
  dispatchState,
  highlightedItemId,
  basePath = "",
  onPauseDispatch,
  onResumeDispatch,
  onDeleteItem,
  onRetryItem,
  onUpdateItem,
}: ProjectQueueSectionProps) {
  const { t } = useI18n();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const highlightedItemRef = useRef<HTMLLIElement | null>(null);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const recoveredGroups = groupRecoveredSessionQueues(recoveredSessionQueues);
  const recoveredCount = recoveredSessionQueues.length;
  const hasProjectQueueItems = items.length > 0;
  const hasContent = hasProjectQueueItems || recoveredCount > 0;
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
    if (!highlightedItemId) return;
    highlightedItemRef.current?.scrollIntoView?.({
      block: "center",
      behavior: "smooth",
    });
  }, [highlightedItemId, items]);

  if (!hasContent && !error) return null;

  return (
    <section className="project-queue-section" aria-labelledby="project-queue-title">
      <div className="project-queue-section__header">
        <div>
          <h2 id="project-queue-title">{t("projectQueueTitle")}</h2>
          <p>{description}</p>
        </div>
        <div className="project-queue-section__header-actions">
          {hasProjectQueueItems && (
            <span className="project-queue-section__count">
              {loading
                ? t("projectQueueRefreshing")
                : t("projectQueueCount", { count: items.length })}
            </span>
          )}
          {hasProjectQueueItems && (
            <button
              type="button"
              className="project-queue-section__dispatch-button"
              onClick={pausedState ? onResumeDispatch : onPauseDispatch}
              disabled={mutatingDispatchState}
            >
              {pausedState ? t("projectQueueResume") : t("projectQueuePause")}
            </button>
          )}
        </div>
      </div>

      {pausedState && hasProjectQueueItems && (
        <div className="project-queue-section__notice">
          {pausedState.reason === "restart"
            ? t("projectQueuePausedAfterRestartNotice")
            : t("projectQueuePausedNotice")}
        </div>
      )}

      {error && (
        <div className="project-queue-section__error">
          {t("projectQueueLoadError", { message: error.message })}
        </div>
      )}

      {recoveredGroups.length > 0 && (
        <div className="project-queue-recovered">
          <div className="project-queue-recovered__header">
            <h3>{t("projectQueueRecoveredTitle")}</h3>
            <span className="project-queue-recovered__count">
              {t("projectQueueRecoveredCount", { count: recoveredCount })}
            </span>
          </div>
          <ul className="project-queue-recovered__groups">
            {recoveredGroups.map((group) => {
              const project = projectById.get(group.projectId);
              const firstItem = group.items[0];
              const label = firstItem
                ? sessionLabel(firstItem, t)
                : t("projectQueueTargetSession", {
                    sessionId: group.sessionId.slice(0, 8),
                  });
              return (
                <li className="project-queue-recovered__group" key={group.key}>
                  <div className="project-queue-recovered__group-header">
                    <span className="project-queue-recovered__project">
                      {project?.name ?? t("projectQueueUnknownProject")}
                    </span>
                    <Link
                      className="project-queue-recovered__session"
                      to={`${basePath}/projects/${group.projectId}/sessions/${group.sessionId}`}
                    >
                      {label}
                    </Link>
                    <span className="project-queue-recovered__status">
                      {t("sessionRecoveredQueuedPaused")}
                    </span>
                  </div>
                  <ul className="project-queue-recovered__messages">
                    {group.items.map((item) => (
                      <li
                        className="project-queue-recovered__message"
                        key={item.id}
                      >
                        <span className="project-queue-recovered__preview">
                          {item.content || t("projectQueueAttachmentOnly")}
                        </span>
                        <span className="project-queue-recovered__age">
                          {formatRelativeTime(
                            item.queuedAt ?? item.timestamp,
                            t,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasProjectQueueItems && (
        <ul className="project-queue-list">
          {items.map((item) => {
            const project = projectById.get(item.projectId);
            const isMutating = mutatingItemId === item.id;
            const isDispatching = item.status === "dispatching";
            const isEditing = editingItemId === item.id;
            const isHighlighted = highlightedItemId === item.id;
            const canEdit = item.status === "queued" || item.status === "failed";
            const canSaveEdit =
              !isMutating &&
              (editText.trim().length > 0 ||
                (item.message.attachments?.length ?? 0) > 0);
            const handleEditSubmit = async (
              event: FormEvent<HTMLFormElement>,
            ) => {
              event.preventDefault();
              if (!canSaveEdit) return;
              await onUpdateItem(item.projectId, item.id, {
                ...item.message,
                text: editText,
              });
              setEditingItemId(null);
              setEditText("");
            };
            return (
              <li
                key={item.id}
                ref={isHighlighted ? highlightedItemRef : undefined}
                className={`project-queue-item project-queue-item--${item.status}${
                  isHighlighted ? " project-queue-item--highlighted" : ""
                }`}
                data-project-queue-item-id={item.id}
              >
                <div className="project-queue-item__main">
                  <div className="project-queue-item__meta">
                    <span className="project-queue-item__project">
                      {project?.name ?? t("projectQueueUnknownProject")}
                    </span>
                    <span className="project-queue-item__target">
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
                    <span className="project-queue-item__age">
                      {formatRelativeTime(item.createdAt, t)}
                    </span>
                  </div>
                  {isEditing ? (
                    <form
                      className="project-queue-item__edit"
                      onSubmit={handleEditSubmit}
                    >
                      <textarea
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        aria-label={t("projectQueueEditMessageLabel")}
                        disabled={isMutating}
                        rows={3}
                      />
                      <div className="project-queue-item__edit-actions">
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
                    <div className="project-queue-item__preview">
                      {item.messagePreview || t("projectQueueAttachmentOnly")}
                    </div>
                  )}
                  {item.lastError && (
                    <div className="project-queue-item__error">
                      {item.lastError}
                    </div>
                  )}
                </div>

                <div className="project-queue-item__side">
                  <span
                    className={`project-queue-item__status project-queue-item__status--${item.status}`}
                  >
                    {statusLabel(item.status, t)}
                  </span>
                  <div className="project-queue-item__actions">
                    {item.status === "failed" && !isEditing && (
                      <button
                        type="button"
                        onClick={() => onRetryItem(item.projectId, item.id)}
                        disabled={isMutating}
                      >
                        {t("projectQueueRetry")}
                      </button>
                    )}
                    {canEdit && !isEditing && (
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
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.projectId, item.id)}
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
      )}
    </section>
  );
}
