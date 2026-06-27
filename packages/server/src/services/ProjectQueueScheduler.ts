import {
  type PermissionMode,
  type ProjectQueueItem,
  type ProviderName,
  type UrlProjectId,
  thinkingOptionToConfig,
} from "@yep-anywhere/shared";
import { getLogger } from "../logging/logger.js";
import type { UserMessage } from "../sdk/types.js";
import type { BusEvent, EventBus } from "../watcher/EventBus.js";
import type { ModelSettings } from "../supervisor/Supervisor.js";
import type { ProjectQueueService } from "./ProjectQueueService.js";

const DEFAULT_IDLE_GRACE_MS = 1000;

export interface ProjectQueueProcessSnapshot {
  id: string;
  sessionId: string;
  projectId: UrlProjectId;
  projectPath: string;
  state: { type: string };
  queueDepth: number;
  provider: ProviderName;
  promptSuggestionMode?: ModelSettings["promptSuggestionMode"];
  recapAfterSeconds?: number;
  isRetainingProviderWork(): boolean;
  getPendingInputRequest(): unknown;
  getDeferredQueueSummary(): readonly unknown[];
  getLivenessSnapshot(): { derivedStatus: string };
}

export type ProjectQueueDispatchResult =
  | ProjectQueueProcessSnapshot
  | { queued: true; queueId: string; position: number }
  | { error: "queue_full"; maxQueueSize: number };

export interface ProjectQueueSupervisor {
  getAllProcesses(): ProjectQueueProcessSnapshot[];
  getQueueInfo(): { projectId: UrlProjectId }[];
  startSession(
    projectPath: string,
    message: UserMessage,
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

export interface ProjectQueueExternalTracker {
  getExternalSessions(): string[];
  getExternalSessionInfoWithUrlId(
    sessionId: string,
  ): Promise<{ projectId: UrlProjectId; lastActivity: Date } | null>;
}

export interface ProjectIdleStatus {
  idle: boolean;
  blockers: string[];
}

export interface ProjectQueueSchedulerOptions {
  projectQueueService: ProjectQueueService;
  supervisor: ProjectQueueSupervisor;
  eventBus: EventBus;
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
    const blockers: string[] = [];

    for (const process of this.supervisor.getAllProcesses()) {
      if (process.projectId !== projectId) continue;
      const stateType = process.state.type;
      if (stateType === "in-turn" || stateType === "waiting-input") {
        blockers.push(`${process.sessionId}:${stateType}`);
      }
      if (process.isRetainingProviderWork()) {
        blockers.push(`${process.sessionId}:provider-retained`);
      }
      if (process.queueDepth > 0) {
        blockers.push(`${process.sessionId}:direct-queue`);
      }
      if (process.getDeferredQueueSummary().length > 0) {
        blockers.push(`${process.sessionId}:deferred-queue`);
      }
      if (process.getPendingInputRequest()) {
        blockers.push(`${process.sessionId}:pending-input`);
      }
      const liveness = process.getLivenessSnapshot();
      if (liveness.derivedStatus !== "verified-idle") {
        blockers.push(`${process.sessionId}:liveness-${liveness.derivedStatus}`);
      }
    }

    for (const request of this.supervisor.getQueueInfo()) {
      if (request.projectId === projectId) {
        blockers.push("worker-queue");
      }
    }

    if (this.externalTracker) {
      for (const sessionId of this.externalTracker.getExternalSessions()) {
        const info =
          await this.externalTracker.getExternalSessionInfoWithUrlId(sessionId);
        if (info?.projectId === projectId) {
          blockers.push(`${sessionId}:external`);
        }
      }
    }

    return { idle: blockers.length === 0, blockers };
  }

  private readonly handleEvent = (event: BusEvent): void => {
    switch (event.type) {
      case "project-queue-changed":
        if (
          event.reason === "created" ||
          event.reason === "updated" ||
          event.reason === "deleted" ||
          event.reason === "retry" ||
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
    const userMessage = this.toUserMessage(item);
    const permissionMode = item.message.mode ?? item.target.mode;
    const modelSettings = this.toModelSettings(item);
    const result =
      item.target.type === "existing-session"
        ? await this.supervisor.resumeSession(
            item.target.sessionId,
            item.projectPath,
            userMessage,
            permissionMode,
            modelSettings,
          )
        : await this.supervisor.startSession(
            item.projectPath,
            userMessage,
            permissionMode,
            modelSettings,
          );

    if (isQueueFullResult(result)) {
      throw new Error(`Worker queue is full (${result.maxQueueSize})`);
    }

    if (!isQueuedResult(result)) {
      await this.options.onSessionStarted?.({ item, process: result });
    }
  }

  private toUserMessage(item: ProjectQueueItem): UserMessage {
    return {
      text: item.message.text,
      ...(item.message.attachments
        ? { attachments: item.message.attachments }
        : {}),
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
