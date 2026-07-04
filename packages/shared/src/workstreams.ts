import type { UrlProjectId } from "./projectId.js";

export type WorkstreamId = string & { readonly __brand: "WorkstreamId" };

export type WorkstreamKind = "main" | "worktree";

export type WorkstreamStatus = "active" | "archived" | "landed";

export interface Workstream {
  id: WorkstreamId;
  projectId: UrlProjectId;
  label: string;
  kind: WorkstreamKind;
  path: string;
  branch: string | null;
  baseBranch: string;
  baseCommit: string | null;
  managedByYa: boolean;
  queuePaused: boolean;
  status: WorkstreamStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredWorkstream extends Workstream {
  kind: "worktree";
}

export type WorkstreamsChangedReason =
  | "created"
  | "updated"
  | "deleted"
  | "replaced";

export interface WorkstreamsChangedEvent {
  type: "workstreams-changed";
  projectId: UrlProjectId;
  reason: WorkstreamsChangedReason;
  timestamp: string;
  workstreamId?: WorkstreamId;
}

export interface ProjectWorkstreamsResponse {
  projectId: UrlProjectId;
  workstreams: Workstream[];
}

const WORKSTREAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function mainWorkstreamId(projectId: UrlProjectId): WorkstreamId {
  return `main:${projectId}` as WorkstreamId;
}

export function isWorkstreamId(value: string): value is WorkstreamId {
  return WORKSTREAM_ID_PATTERN.test(value);
}
