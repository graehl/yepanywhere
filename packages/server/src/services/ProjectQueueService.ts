import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ALL_PERMISSION_MODES,
  ALL_PROVIDERS,
  type CreateProjectQueueItemRequest,
  type PermissionMode,
  type ProjectQueueChangedEvent,
  type ProjectQueueCreatedFrom,
  type ProjectQueueItem,
  type ProjectQueueItemSummary,
  type ProjectQueueMessage,
  type ProjectQueueResponse,
  type ProjectQueueTarget,
  type ProviderName,
  type ShowThinking,
  type ThinkingOption,
  type UpdateProjectQueueItemRequest,
  type UploadedFile,
  type UrlProjectId,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import type { EventBus } from "../watcher/EventBus.js";

const CURRENT_VERSION = 1;
const MAX_MESSAGE_PREVIEW_LENGTH = 180;

interface ProjectQueueState {
  version: number;
  items: ProjectQueueItem[];
}

export interface ProjectQueueServiceOptions {
  dataDir: string;
  eventBus?: EventBus;
}

export class ProjectQueueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectQueueValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProjectQueueValidationError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalProvider(value: unknown): ProviderName | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !ALL_PROVIDERS.includes(value as ProviderName)
  ) {
    throw new ProjectQueueValidationError("target.provider is invalid");
  }
  return value as ProviderName;
}

function optionalPermissionMode(value: unknown): PermissionMode | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !ALL_PERMISSION_MODES.includes(value as PermissionMode)
  ) {
    throw new ProjectQueueValidationError("mode is invalid");
  }
  return value as PermissionMode;
}

function optionalThinking(value: unknown): ThinkingOption | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectQueueValidationError("target.thinking is invalid");
  }
  return value.trim() as ThinkingOption;
}

function optionalShowThinking(value: unknown): ShowThinking | undefined {
  if (value === undefined) return undefined;
  if (value !== "default" && value !== "on" && value !== "off") {
    throw new ProjectQueueValidationError("target.showThinking is invalid");
  }
  return value;
}

function normalizeUploadedFile(value: unknown, index: number): UploadedFile {
  if (!isRecord(value)) {
    throw new ProjectQueueValidationError(
      `message.attachments[${index}] must be an object`,
    );
  }

  const id = optionalString(value.id, `message.attachments[${index}].id`);
  const originalName = optionalString(
    value.originalName,
    `message.attachments[${index}].originalName`,
  );
  const name = optionalString(value.name, `message.attachments[${index}].name`);
  const filePath = optionalString(
    value.path,
    `message.attachments[${index}].path`,
  );
  const mimeType = optionalString(
    value.mimeType,
    `message.attachments[${index}].mimeType`,
  );
  if (!id || !originalName || !name || !filePath || !mimeType) {
    throw new ProjectQueueValidationError(
      `message.attachments[${index}] is missing required fields`,
    );
  }
  if (typeof value.size !== "number" || !Number.isFinite(value.size)) {
    throw new ProjectQueueValidationError(
      `message.attachments[${index}].size must be a number`,
    );
  }

  const width =
    typeof value.width === "number" && Number.isFinite(value.width)
      ? value.width
      : undefined;
  const height =
    typeof value.height === "number" && Number.isFinite(value.height)
      ? value.height
      : undefined;

  return {
    id,
    originalName,
    name,
    path: filePath,
    size: value.size,
    mimeType,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function normalizeMessage(raw: unknown): ProjectQueueMessage {
  if (!isRecord(raw)) {
    throw new ProjectQueueValidationError("message must be an object");
  }
  if (typeof raw.text !== "string") {
    throw new ProjectQueueValidationError("message.text is required");
  }
  const text = raw.text;
  const mode = optionalPermissionMode(raw.mode);
  const attachments =
    raw.attachments === undefined
      ? undefined
      : Array.isArray(raw.attachments)
        ? raw.attachments.map(normalizeUploadedFile)
        : (() => {
            throw new ProjectQueueValidationError(
              "message.attachments must be an array",
            );
          })();
  if (!text.trim() && !attachments?.length) {
    throw new ProjectQueueValidationError(
      "message.text or message.attachments is required",
    );
  }

  return {
    text,
    ...(attachments?.length ? { attachments } : {}),
    ...(mode ? { mode } : {}),
    ...(isRecord(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
}

function normalizeTarget(raw: unknown): ProjectQueueTarget {
  if (!isRecord(raw)) {
    throw new ProjectQueueValidationError("target must be an object");
  }

  const common = {
    provider: optionalProvider(raw.provider),
    mode: optionalPermissionMode(raw.mode),
    model: optionalString(raw.model, "target.model"),
    serviceTier: optionalString(raw.serviceTier, "target.serviceTier"),
    executor: optionalString(raw.executor, "target.executor"),
    thinking: optionalThinking(raw.thinking),
    showThinking: optionalShowThinking(raw.showThinking),
  };

  if (raw.type === "existing-session") {
    const sessionId = optionalString(raw.sessionId, "target.sessionId");
    if (!sessionId) {
      throw new ProjectQueueValidationError("target.sessionId is required");
    }
    return {
      type: "existing-session",
      sessionId,
      ...common,
    };
  }

  if (raw.type === "new-session") {
    return {
      type: "new-session",
      title: optionalString(raw.title, "target.title"),
      ...common,
    };
  }

  throw new ProjectQueueValidationError("target.type is invalid");
}

function normalizeCreatedFrom(raw: unknown): ProjectQueueCreatedFrom | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ProjectQueueValidationError("createdFrom must be an object");
  }
  const sessionId = optionalString(raw.sessionId, "createdFrom.sessionId");
  const client = optionalString(raw.client, "createdFrom.client");
  if (
    client !== undefined &&
    client !== "toolbar" &&
    client !== "projects-page" &&
    client !== "new-session"
  ) {
    throw new ProjectQueueValidationError("createdFrom.client is invalid");
  }
  if (!sessionId && !client) return undefined;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(client ? { client } : {}),
  };
}

function normalizeProjectQueueItem(raw: unknown): ProjectQueueItem | null {
  if (!isRecord(raw)) return null;
  try {
    const id = optionalString(raw.id, "id") ?? randomUUID();
    const projectId = optionalString(raw.projectId, "projectId");
    const projectPath = optionalString(raw.projectPath, "projectPath");
    if (!projectId || !isUrlProjectId(projectId) || !projectPath) {
      return null;
    }

    const createdAt =
      optionalString(raw.createdAt, "createdAt") ?? new Date().toISOString();
    const updatedAt =
      optionalString(raw.updatedAt, "updatedAt") ?? createdAt;
    const rawStatus = optionalString(raw.status, "status");
    const status =
      rawStatus === "failed"
        ? "failed"
        : // A restart means no dispatch is in progress anymore.
          "queued";

    return {
      id,
      projectId,
      projectPath,
      target: normalizeTarget(raw.target),
      message: normalizeMessage(raw.message),
      createdAt,
      updatedAt,
      createdFrom: normalizeCreatedFrom(raw.createdFrom),
      status,
      lastError: optionalString(raw.lastError, "lastError"),
      lastAttemptAt: optionalString(raw.lastAttemptAt, "lastAttemptAt"),
    };
  } catch {
    return null;
  }
}

function summarizeItem(item: ProjectQueueItem): ProjectQueueItemSummary {
  const attachmentCount = item.message.attachments?.length ?? 0;
  const previewText = item.message.text.trim();
  return {
    id: item.id,
    projectId: item.projectId,
    target: item.target,
    messagePreview:
      previewText.length > MAX_MESSAGE_PREVIEW_LENGTH
        ? `${previewText.slice(0, MAX_MESSAGE_PREVIEW_LENGTH - 3)}...`
        : previewText,
    message: item.message,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdFrom: item.createdFrom,
    status: item.status,
    attachmentCount,
    lastError: item.lastError,
    lastAttemptAt: item.lastAttemptAt,
  };
}

export class ProjectQueueService {
  private dataDir: string;
  private filePath: string;
  private state: ProjectQueueState = { version: CURRENT_VERSION, items: [] };
  private initialized = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private options: ProjectQueueServiceOptions) {
    this.dataDir = options.dataDir;
    this.filePath = path.join(this.dataDir, "project-queues.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<ProjectQueueState>;
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const items = rawItems
        .map(normalizeProjectQueueItem)
        .filter((item): item is ProjectQueueItem => item !== null);
      this.state = {
        version: CURRENT_VERSION,
        items,
      };
      const needsSave =
        parsed.version !== CURRENT_VERSION ||
        items.length !== rawItems.length ||
        rawItems.some(
          (item) =>
            isRecord(item) &&
            item.status !== undefined &&
            item.status !== "queued" &&
            item.status !== "failed",
        );
      if (needsSave) {
        await this.save();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          "[ProjectQueueService] Failed to load project queues, starting fresh:",
          error,
        );
      }
      this.state = { version: CURRENT_VERSION, items: [] };
    }
    this.initialized = true;
  }

  listProject(projectId: UrlProjectId): ProjectQueueResponse {
    this.ensureInitialized();
    return {
      projectId,
      items: this.state.items
        .filter((item) => item.projectId === projectId)
        .map(summarizeItem),
    };
  }

  listAll(): ProjectQueueItemSummary[] {
    this.ensureInitialized();
    return this.state.items.map(summarizeItem);
  }

  async createItem(params: {
    projectId: UrlProjectId;
    projectPath: string;
    request: CreateProjectQueueItemRequest;
  }): Promise<ProjectQueueItemSummary> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const now = new Date().toISOString();
      const item: ProjectQueueItem = {
        id: randomUUID(),
        projectId: params.projectId,
        projectPath: params.projectPath,
        target: normalizeTarget(params.request.target),
        message: normalizeMessage(params.request.message),
        createdAt: now,
        updatedAt: now,
        createdFrom: normalizeCreatedFrom(params.request.createdFrom),
        status: "queued",
      };
      this.state.items.push(item);
      await this.save();
      this.emitChange(params.projectId, "created", item.id);
      return summarizeItem(item);
    });
  }

  async updateItem(
    projectId: UrlProjectId,
    itemId: string,
    request: UpdateProjectQueueItemRequest,
  ): Promise<ProjectQueueItemSummary | null> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const index = this.findProjectItemIndex(projectId, itemId);
      if (index === -1) return null;
      const existing = this.state.items[index]!;
      if (existing.status === "dispatching") {
        throw new ProjectQueueValidationError(
          "Cannot update an item while it is dispatching",
        );
      }
      const updated: ProjectQueueItem = {
        ...existing,
        ...(request.target !== undefined
          ? { target: normalizeTarget(request.target) }
          : {}),
        ...(request.message !== undefined
          ? { message: normalizeMessage(request.message) }
          : {}),
        status: existing.status === "failed" ? "queued" : existing.status,
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      };
      this.state.items[index] = updated;
      await this.save();
      this.emitChange(projectId, "updated", itemId);
      return summarizeItem(updated);
    });
  }

  async deleteItem(projectId: UrlProjectId, itemId: string): Promise<boolean> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const index = this.findProjectItemIndex(projectId, itemId);
      if (index === -1) return false;
      this.state.items.splice(index, 1);
      await this.save();
      this.emitChange(projectId, "deleted", itemId);
      return true;
    });
  }

  async retryItem(
    projectId: UrlProjectId,
    itemId: string,
  ): Promise<ProjectQueueItemSummary | null> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const index = this.findProjectItemIndex(projectId, itemId);
      if (index === -1) return null;
      const existing = this.state.items[index]!;
      const updated: ProjectQueueItem = {
        ...existing,
        status: "queued",
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      };
      this.state.items[index] = updated;
      await this.save();
      this.emitChange(projectId, "retry", itemId);
      return summarizeItem(updated);
    });
  }

  getFilePath(): string {
    return this.filePath;
  }

  private findProjectItemIndex(
    projectId: UrlProjectId,
    itemId: string,
  ): number {
    return this.state.items.findIndex(
      (item) => item.projectId === projectId && item.id === itemId,
    );
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "ProjectQueueService not initialized. Call initialize() first.",
      );
    }
  }

  private async withMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(fn, fn);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async save(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
    await fs.rename(tmpPath, this.filePath);
  }

  private emitChange(
    projectId: UrlProjectId,
    reason: ProjectQueueChangedEvent["reason"],
    itemId?: string,
  ): void {
    const event: ProjectQueueChangedEvent = {
      type: "project-queue-changed",
      projectId,
      items: this.listProject(projectId).items,
      reason,
      ...(itemId ? { itemId } : {}),
      timestamp: new Date().toISOString(),
    };
    this.options.eventBus?.emit(event);
  }
}
