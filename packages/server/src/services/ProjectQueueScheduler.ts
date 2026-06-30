import {
  type PermissionMode,
  type ProjectQueueItem,
  type ProviderName,
  type UploadedFile,
  type UrlProjectId,
  thinkingOptionToConfig,
} from "@yep-anywhere/shared";
import { getLogger } from "../logging/logger.js";
import type { UserMessage } from "../sdk/types.js";
import type { BusEvent, EventBus } from "../watcher/EventBus.js";
import type { ModelSettings } from "../supervisor/Supervisor.js";
import type { AttachmentStagingService } from "../uploads/AttachmentStagingService.js";
import type { ProjectQueueService } from "./ProjectQueueService.js";
import {
  getProjectWorkIdleStatus,
  type ProjectWorkExternalTracker,
  type ProjectWorkIdleStatus,
  type ProjectWorkProcessSnapshot,
  type ProjectWorkSupervisor,
} from "./projectWorkIdle.js";

const DEFAULT_IDLE_GRACE_MS = 1000;

export interface ProjectQueueProcessSnapshot
  extends ProjectWorkProcessSnapshot {
  id: string;
  sessionId: string;
  projectId: UrlProjectId;
  projectPath: string;
  provider: ProviderName;
  promptSuggestionMode?: ModelSettings["promptSuggestionMode"];
  recapAfterSeconds?: number;
}

export type ProjectQueueDispatchResult =
  | ProjectQueueProcessSnapshot
  | { queued: true; queueId: string; position: number }
  | { error: "queue_full"; maxQueueSize: number };

export interface ProjectQueueSupervisor extends ProjectWorkSupervisor {
  getAllProcesses(): ProjectQueueProcessSnapshot[];
  startSession(
    projectPath: string,
    message: UserMessage,
    permissionMode?: PermissionMode,
    modelSettings?: ModelSettings,
  ): Promise<ProjectQueueDispatchResult>;
  createSession(
    projectPath: string,
    permissionMode?: PermissionMode,
    modelSettings?: ModelSettings,
  ): Promise<ProjectQueueDispatchResult>;
  resumeSession(
    sessionId: string,
    projectPath: string,
    message: UserMessage,
    permissionMode?: PermissionMode,
    modelSettings?: ModelSettings,
  ): Promise<ProjectQueueDispatchResult>;
}

export type ProjectQueueExternalTracker = ProjectWorkExternalTracker;

export type ProjectIdleStatus = ProjectWorkIdleStatus;

export interface ProjectQueueSchedulerOptions {
  projectQueueService: ProjectQueueService;
  supervisor: ProjectQueueSupervisor;
  eventBus: EventBus;
  attachmentStagingService?: AttachmentStagingService;
  externalTracker?: ProjectQueueExternalTracker;
  idleGraceMs?: number;
  getGlobalInstructions?: () => string | undefined;
  onSessionStarted?: (args: {
    item: ProjectQueueItem;
    process: ProjectQueueProcessSnapshot;
  }) => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQueueFullResult(
  result: ProjectQueueDispatchResult,
): result is { error: "queue_full"; maxQueueSize: number } {
  return "error" in result && result.error === "queue_full";
}

function isQueuedResult(
  result: ProjectQueueDispatchResult,
): result is { queued: true; queueId: string; position: number } {
  return "queued" in result && result.queued === true;
}

export class ProjectQueueScheduler {
  private readonly projectQueueService: ProjectQueueService;
  private readonly supervisor: ProjectQueueSupervisor;
  private readonly eventBus: EventBus;
  private readonly externalTracker?: ProjectQueueExternalTracker;
  private readonly idleGraceMs: number;
  private readonly timers = new Map<UrlProjectId, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<UrlProjectId>();
  private readonly unsubscribe: () => void;

  constructor(private readonly options: ProjectQueueSchedulerOptions) {
    this.projectQueueService = options.projectQueueService;
    this.supervisor = options.supervisor;
    this.eventBus = options.eventBus;
    this.externalTracker = options.externalTracker;
    this.idleGraceMs = options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
    this.unsubscribe = this.eventBus.subscribe(this.handleEvent);
    this.scheduleAllDispatchableProjects(0);
  }

  dispose(): void {
    this.unsubscribe();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.inFlight.clear();
  }

  async getProjectIdleStatus(
    projectId: UrlProjectId,
  ): Promise<ProjectIdleStatus> {
    // Project Queue ordering and UI semantics are documented in
    // topics/project-queue.md. In particular, per-session queues must drain
    // before a project-level queue item can promote.
    return getProjectWorkIdleStatus(projectId, {
      supervisor: this.supervisor,
      externalTracker: this.externalTracker,
    });
  }

  private readonly handleEvent = (event: BusEvent): void => {
    switch (event.type) {
      case "project-queue-changed":
        if (
          event.reason === "created" ||
          event.reason === "updated" ||
          event.reason === "deleted" ||
          event.reason === "retry" ||
          event.reason === "resumed" ||
          event.reason === "released"
        ) {
          this.scheduleProjectIfDispatchable(event.projectId);
        } else if (!this.projectQueueService.hasDispatchableItem(event.projectId)) {
          this.clearProjectTimer(event.projectId);
        }
        break;
      case "process-state-changed":
      case "session-status-changed":
      case "session-updated":
      case "queue-request-added":
        this.scheduleProjectIfDispatchable(event.projectId);
        break;
      case "session-created":
        this.scheduleProjectIfDispatchable(event.session.projectId);
        break;
      case "worker-activity-changed":
      case "queue-position-changed":
      case "queue-request-removed":
        this.scheduleAllDispatchableProjects();
        break;
    }
  };

  private scheduleAllDispatchableProjects(delayMs = this.idleGraceMs): void {
    for (const projectId of this.projectQueueService.getProjectIdsWithDispatchableItems()) {
      this.scheduleProject(projectId, delayMs);
    }
  }

  private scheduleProjectIfDispatchable(
    projectId: UrlProjectId,
    delayMs = this.idleGraceMs,
  ): void {
    if (!this.projectQueueService.hasDispatchableItem(projectId)) {
      this.clearProjectTimer(projectId);
      return;
    }
    this.scheduleProject(projectId, delayMs);
  }

  private scheduleProject(projectId: UrlProjectId, delayMs: number): void {
    if (this.inFlight.has(projectId)) return;
    this.clearProjectTimer(projectId);
    const timer = setTimeout(() => {
      this.timers.delete(projectId);
      void this.runProject(projectId);
    }, delayMs);
    timer.unref?.();
    this.timers.set(projectId, timer);
  }

  private clearProjectTimer(projectId: UrlProjectId): void {
    const timer = this.timers.get(projectId);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(projectId);
  }

  private async runProject(projectId: UrlProjectId): Promise<void> {
    if (this.inFlight.has(projectId)) return;
    if (!this.projectQueueService.hasDispatchableItem(projectId)) return;

    this.inFlight.add(projectId);
    let item: ProjectQueueItem | null = null;

    try {
      const idle = await this.getProjectIdleStatus(projectId);
      if (!idle.idle) return;

      item = await this.projectQueueService.claimNextDispatchableItem(projectId);
      if (!item) return;

      const stillIdle = await this.getProjectIdleStatus(projectId);
      if (!stillIdle.idle) {
        await this.projectQueueService.releaseDispatchingItem(
          projectId,
          item.id,
        );
        return;
      }

      await this.dispatchItem(item);
      await this.projectQueueService.completeDispatch(projectId, item.id);
    } catch (error) {
      const message = errorMessage(error);
      getLogger().warn(
        { event: "project_queue_dispatch_failed", projectId, error: message },
        "Project queue dispatch failed",
      );
      if (item) {
        await this.projectQueueService.failDispatch(projectId, item.id, message);
      }
    } finally {
      this.inFlight.delete(projectId);
    }
  }

  private async dispatchItem(item: ProjectQueueItem): Promise<void> {
    const permissionMode = item.message.mode ?? item.target.mode;
    const modelSettings = this.toModelSettings(item);
    const result =
      item.target.type === "existing-session"
        ? await this.dispatchExistingSessionItem(
            item,
            permissionMode,
            modelSettings,
          )
        : await this.dispatchNewSessionItem(item, permissionMode, modelSettings);

    if (isQueueFullResult(result)) {
      throw new Error(`Worker queue is full (${result.maxQueueSize})`);
    }

    if (!isQueuedResult(result)) {
      await this.options.onSessionStarted?.({ item, process: result });
    }
  }

  private async dispatchExistingSessionItem(
    item: ProjectQueueItem,
    permissionMode: PermissionMode | undefined,
    modelSettings: ModelSettings,
  ): Promise<ProjectQueueDispatchResult> {
    if (item.target.type !== "existing-session") {
      throw new Error("Project queue item target changed during dispatch");
    }
    const stagedAttachments = await this.materializeStagedAttachments(
      item,
      item.target.sessionId,
    );
    return this.supervisor.resumeSession(
      item.target.sessionId,
      item.projectPath,
      this.toUserMessage(item, stagedAttachments),
      permissionMode,
      modelSettings,
    );
  }

  private async dispatchNewSessionItem(
    item: ProjectQueueItem,
    permissionMode: PermissionMode | undefined,
    modelSettings: ModelSettings,
  ): Promise<ProjectQueueDispatchResult> {
    if (!item.message.stagedAttachments) {
      return this.supervisor.startSession(
        item.projectPath,
        this.toUserMessage(item),
        permissionMode,
        modelSettings,
      );
    }

    const created = await this.supervisor.createSession(
      item.projectPath,
      permissionMode,
      modelSettings,
    );
    if (isQueueFullResult(created)) {
      return created;
    }
    if (isQueuedResult(created)) {
      throw new Error(
        "Worker queue deferred a create-only session before staged attachments could be materialized",
      );
    }

    const stagedAttachments = await this.materializeStagedAttachments(
      item,
      created.sessionId,
    );
    return this.supervisor.resumeSession(
      created.sessionId,
      item.projectPath,
      this.toUserMessage(item, stagedAttachments),
      permissionMode,
      modelSettings,
    );
  }

  private async materializeStagedAttachments(
    item: ProjectQueueItem,
    sessionId: string,
  ): Promise<UploadedFile[]> {
    const stagedAttachments = item.message.stagedAttachments;
    if (!stagedAttachments) {
      return [];
    }
    if (!this.options.attachmentStagingService) {
      throw new Error("Attachment staging service is unavailable");
    }
    return this.options.attachmentStagingService.materializeQueueAttachmentsForSession(
      {
        queueItemId: item.id,
        refs: stagedAttachments.refs,
        projectPath: item.projectPath,
        sessionId,
      },
    );
  }

  private toUserMessage(
    item: ProjectQueueItem,
    stagedAttachments: readonly UploadedFile[] = [],
  ): UserMessage {
    const attachments =
      item.message.attachments || stagedAttachments.length > 0
        ? [...(item.message.attachments ?? []), ...stagedAttachments]
        : undefined;
    return {
      text: item.message.text,
      ...(attachments ? { attachments } : {}),
      ...(item.message.mode ? { mode: item.message.mode } : {}),
      ...(item.message.metadata ? { metadata: item.message.metadata } : {}),
    };
  }

  private toModelSettings(item: ProjectQueueItem): ModelSettings {
    const target = item.target;
    const thinkingConfig = target.thinking
      ? thinkingOptionToConfig(target.thinking, target.showThinking)
      : { thinking: undefined, effort: undefined };
    const globalInstructions = this.options.getGlobalInstructions?.();
    return {
      ...(target.model && target.model !== "default"
        ? { model: target.model }
        : {}),
      ...(target.serviceTier ? { serviceTier: target.serviceTier } : {}),
      ...(thinkingConfig.thinking ? { thinking: thinkingConfig.thinking } : {}),
      ...(thinkingConfig.effort ? { effort: thinkingConfig.effort } : {}),
      ...(target.provider ? { providerName: target.provider } : {}),
      ...(target.executor ? { executor: target.executor } : {}),
      ...(globalInstructions ? { globalInstructions } : {}),
    };
  }
}
