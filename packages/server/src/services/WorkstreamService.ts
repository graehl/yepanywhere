import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  type StoredWorkstream,
  type UrlProjectId,
  type Workstream,
  type WorkstreamId,
  type WorkstreamsChangedReason,
  isUrlProjectId,
  isWorkstreamId,
  mainWorkstreamId,
} from "@yep-anywhere/shared";
import type { EventBus } from "../watcher/EventBus.js";

const CURRENT_VERSION = 1;
const FILE_NAME = "workstreams.json";
const DEFAULT_BASE_BRANCH = "main";
const IMPLICIT_MAIN_TIMESTAMP = "1970-01-01T00:00:00.000Z";

interface WorkstreamsState {
  version: number;
  workstreams: StoredWorkstream[];
}

export interface WorkstreamServiceOptions {
  dataDir: string;
  eventBus?: EventBus;
  now?: () => Date;
}

export interface ListProjectWorkstreamsOptions {
  projectId: UrlProjectId;
  projectPath: string;
  mainBranch?: string | null;
  baseBranch?: string;
}

export interface CreateWorkstreamInput {
  projectId: UrlProjectId;
  label: string;
  path: string;
  branch?: string | null;
  baseBranch?: string;
  baseCommit?: string | null;
  managedByYa?: boolean;
}

export class WorkstreamValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkstreamValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringOrNull(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new WorkstreamValidationError(`${field} must be a string or null`);
  }
  return value.trim() || null;
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new WorkstreamValidationError(`${field} must be a boolean`);
  }
  return value;
}

function normalizeProjectId(value: unknown): UrlProjectId {
  const projectId = requiredString(value, "projectId");
  if (!isUrlProjectId(projectId)) {
    throw new WorkstreamValidationError("projectId is invalid");
  }
  return projectId;
}

function normalizeWorkstreamId(value: unknown): WorkstreamId {
  const id = requiredString(value, "id");
  if (!isWorkstreamId(id)) {
    throw new WorkstreamValidationError("id is invalid");
  }
  return id;
}

function normalizeStatus(value: unknown): StoredWorkstream["status"] {
  if (value === "active" || value === "archived" || value === "landed") {
    return value;
  }
  throw new WorkstreamValidationError("status is invalid");
}

function normalizeStoredWorkstream(raw: unknown): StoredWorkstream {
  if (!isRecord(raw)) {
    throw new WorkstreamValidationError("workstream must be an object");
  }
  if (raw.kind !== "checkout") {
    throw new WorkstreamValidationError("kind must be checkout");
  }
  const projectId = normalizeProjectId(raw.projectId);
  const id = normalizeWorkstreamId(raw.id);
  if (id === mainWorkstreamId(projectId)) {
    throw new WorkstreamValidationError("main workstream is implicit");
  }
  return {
    id,
    projectId,
    label: requiredString(raw.label, "label"),
    kind: "checkout",
    path: requiredString(raw.path, "path"),
    branch: optionalStringOrNull(raw.branch, "branch"),
    baseBranch: requiredString(raw.baseBranch, "baseBranch"),
    baseCommit: optionalStringOrNull(raw.baseCommit, "baseCommit"),
    managedByYa: normalizeBoolean(raw.managedByYa, "managedByYa"),
    queuePaused: normalizeBoolean(raw.queuePaused, "queuePaused"),
    status: normalizeStatus(raw.status),
    createdAt: requiredString(raw.createdAt, "createdAt"),
    updatedAt: requiredString(raw.updatedAt, "updatedAt"),
  };
}

function normalizeStoredWorkstreams(rawWorkstreams: unknown[]): {
  workstreams: StoredWorkstream[];
  droppedCount: number;
} {
  const workstreams: StoredWorkstream[] = [];
  const seenIds = new Set<WorkstreamId>();
  let droppedCount = 0;
  for (const raw of rawWorkstreams) {
    try {
      const workstream = normalizeStoredWorkstream(raw);
      if (seenIds.has(workstream.id)) {
        droppedCount += 1;
        continue;
      }
      seenIds.add(workstream.id);
      workstreams.push(workstream);
    } catch {
      droppedCount += 1;
    }
  }
  return { workstreams, droppedCount };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function workstreamsEqual(a: StoredWorkstream[], b: unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function synthesizeMainWorkstream(
  options: ListProjectWorkstreamsOptions,
): Workstream {
  const branch =
    options.mainBranch?.trim() ||
    options.baseBranch?.trim() ||
    DEFAULT_BASE_BRANCH;
  return {
    id: mainWorkstreamId(options.projectId),
    projectId: options.projectId,
    label: "main",
    kind: "main",
    path: options.projectPath,
    branch,
    baseBranch: options.baseBranch?.trim() || branch,
    baseCommit: null,
    managedByYa: false,
    queuePaused: false,
    status: "active",
    createdAt: IMPLICIT_MAIN_TIMESTAMP,
    updatedAt: IMPLICIT_MAIN_TIMESTAMP,
  };
}

export class WorkstreamService {
  private readonly dataDir: string;
  private readonly filePath: string;
  private readonly eventBus: EventBus | undefined;
  private readonly now: () => Date;
  private state: WorkstreamsState = {
    version: CURRENT_VERSION,
    workstreams: [],
  };
  private initialized = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: WorkstreamServiceOptions) {
    this.dataDir = options.dataDir;
    this.filePath = path.join(this.dataDir, FILE_NAME);
    this.eventBus = options.eventBus;
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<WorkstreamsState>;
      const rawWorkstreams = Array.isArray(parsed.workstreams)
        ? parsed.workstreams
        : [];
      const { workstreams, droppedCount } =
        normalizeStoredWorkstreams(rawWorkstreams);
      this.state = { version: CURRENT_VERSION, workstreams };
      const needsSave =
        parsed.version !== CURRENT_VERSION ||
        !Array.isArray(parsed.workstreams) ||
        droppedCount > 0 ||
        !workstreamsEqual(workstreams, rawWorkstreams);
      if (needsSave) {
        await this.save();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          "[WorkstreamService] Failed to load workstreams, starting fresh:",
          error,
        );
      }
      this.state = { version: CURRENT_VERSION, workstreams: [] };
    }
    this.initialized = true;
  }

  listProject(options: ListProjectWorkstreamsOptions): Workstream[] {
    this.ensureInitialized();
    return [
      synthesizeMainWorkstream(options),
      ...this.state.workstreams
        .filter((workstream) => workstream.projectId === options.projectId)
        .map((workstream) => cloneJson(workstream)),
    ];
  }

  listStoredProject(projectId: UrlProjectId): StoredWorkstream[] {
    this.ensureInitialized();
    return this.state.workstreams
      .filter((workstream) => workstream.projectId === projectId)
      .map((workstream) => cloneJson(workstream));
  }

  listStored(): StoredWorkstream[] {
    this.ensureInitialized();
    return this.state.workstreams.map((workstream) => cloneJson(workstream));
  }

  getWorkstream(
    projectId: UrlProjectId,
    workstreamId: WorkstreamId,
    projectPath?: string,
  ): Workstream | null {
    this.ensureInitialized();
    if (workstreamId === mainWorkstreamId(projectId)) {
      if (!projectPath) return null;
      return synthesizeMainWorkstream({ projectId, projectPath });
    }
    const found = this.state.workstreams.find(
      (workstream) =>
        workstream.projectId === projectId && workstream.id === workstreamId,
    );
    return found ? cloneJson(found) : null;
  }

  async createWorkstream(
    input: CreateWorkstreamInput,
  ): Promise<StoredWorkstream> {
    const now = this.now().toISOString();
    const branch = input.branch?.trim() || null;
    const workstream: StoredWorkstream = {
      id: randomUUID() as WorkstreamId,
      projectId: input.projectId,
      label: input.label,
      kind: "checkout",
      path: input.path,
      branch,
      baseBranch: input.baseBranch?.trim() || DEFAULT_BASE_BRANCH,
      baseCommit: input.baseCommit?.trim() || null,
      managedByYa: input.managedByYa ?? false,
      queuePaused: false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    return this.upsertWorkstream(workstream);
  }

  async upsertWorkstream(
    workstream: StoredWorkstream,
  ): Promise<StoredWorkstream> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const normalized = normalizeStoredWorkstream(workstream);
      const index = this.state.workstreams.findIndex(
        (candidate) => candidate.id === normalized.id,
      );
      const reason: WorkstreamsChangedReason =
        index === -1 ? "created" : "updated";
      if (index === -1) {
        this.state.workstreams.push(normalized);
      } else {
        const existing = this.state.workstreams[index]!;
        if (existing.projectId !== normalized.projectId) {
          throw new WorkstreamValidationError(
            "workstream projectId cannot change",
          );
        }
        this.state.workstreams[index] = normalized;
      }
      await this.save();
      this.emitChange(normalized.projectId, reason, normalized.id);
      return cloneJson(normalized);
    });
  }

  async replaceAll(
    workstreams: StoredWorkstream[],
  ): Promise<StoredWorkstream[]> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const { workstreams: normalized, droppedCount } =
        normalizeStoredWorkstreams(workstreams);
      if (droppedCount > 0) {
        throw new WorkstreamValidationError("workstreams contain duplicates");
      }
      this.state.workstreams = normalized;
      await this.save();
      this.emitAllProjectChanges("replaced");
      return this.listStored();
    });
  }

  async deleteWorkstream(id: WorkstreamId): Promise<boolean> {
    return this.withMutation(async () => {
      this.ensureInitialized();
      const index = this.state.workstreams.findIndex(
        (workstream) => workstream.id === id,
      );
      if (index === -1) return false;
      const [deleted] = this.state.workstreams.splice(index, 1);
      await this.save();
      this.emitChange(deleted!.projectId, "deleted", id);
      return true;
    });
  }

  getFilePath(): string {
    return this.filePath;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "WorkstreamService not initialized. Call initialize() first.",
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
    await fs.mkdir(this.dataDir, { recursive: true });
    if (this.state.workstreams.length === 0) {
      await fs.rm(this.filePath, { force: true });
      return;
    }
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
    await fs.rename(tmpPath, this.filePath);
  }

  private emitChange(
    projectId: UrlProjectId,
    reason: WorkstreamsChangedReason,
    workstreamId?: WorkstreamId,
  ): void {
    this.eventBus?.emit({
      type: "workstreams-changed",
      projectId,
      reason,
      ...(workstreamId ? { workstreamId } : {}),
      timestamp: this.now().toISOString(),
    });
  }

  private emitAllProjectChanges(reason: WorkstreamsChangedReason): void {
    for (const projectId of [
      ...new Set(this.state.workstreams.map((workstream) => workstream.projectId)),
    ]) {
      this.emitChange(projectId, reason);
    }
  }
}
