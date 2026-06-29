import type {
  AgentActivity,
  PendingInputType,
  ProviderName,
  ProjectQueueChangedEvent,
  ProjectQueueItemSummary,
  ProjectQueueListResponse,
  ProjectQueueResponse,
  UrlProjectId,
} from "@yep-anywhere/shared";
import type { GlobalSessionItem, InboxItem, InboxResponse } from "../api/client";
import type { Project, SessionStatus } from "../types";
import type {
  ProcessStateEvent,
  SessionCreatedEvent,
  SessionMetadataChangedEvent,
  SessionSeenEvent,
  SessionStatusEvent,
  SessionUpdatedEvent,
} from "./activityBus";
import {
  createEmptyInboxTierRecord,
  INBOX_TIERS,
  type InboxTier,
} from "./inboxTiers";

const NO_OBSERVATION = Number.NEGATIVE_INFINITY;

export type SessionCollectionObservationKind =
  | "full-snapshot"
  | "partial-snapshot"
  | "partial-event";

export type SessionCollectionObservationSource =
  | "global-sessions"
  | "inbox"
  | "session-created"
  | "session-updated"
  | "metadata-changed"
  | "process-state"
  | "session-status"
  | "session-seen";

// Each session reducer entry point names whether it is applying a fuller row
// snapshot or a partial observation. The merge rules currently resolve
// conflicts by field-group freshness and allow older observations to backfill
// empty fields; the explicit source/kind keeps that distinction auditable.
interface SessionCollectionObservation {
  observedAt: number;
  kind: SessionCollectionObservationKind;
  source: SessionCollectionObservationSource;
}

export interface SessionCollectionRecord {
  id: string;
  title?: string | null;
  fullTitle?: string | null;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  provider?: ProviderName;
  model?: string;
  projectId?: string;
  projectName?: string;
  ownership?: SessionStatus;
  pendingInputType?: PendingInputType;
  activity?: AgentActivity;
  hasUnread?: boolean;
  customTitle?: string;
  isArchived?: boolean;
  isStarred?: boolean;
  activeStartedAt?: number;
  parentSessionId?: string;
  initialPrompt?: string;
  executor?: string;
  lastAgentText?: string;
  observedAt: number;
  snapshotObservedAt?: number;
  contentObservedAt?: number;
  metadataObservedAt?: number;
  projectObservedAt?: number;
  lifecycleObservedAt?: number;
  unreadObservedAt?: number;
  eventCreatedAt?: number;
}

export interface SessionCollectionQueryDescriptor {
  scope: "global-sessions";
  projectId?: string | null;
  searchQuery?: string;
  limit?: number;
  includeArchived?: boolean;
  starred?: boolean;
}

export interface SessionCollectionQueryState {
  key: string;
  descriptor: SessionCollectionQueryDescriptor;
  ids: string[];
  hasMore: boolean;
  requestStartedAt: number;
  fetchedAt: number;
}

export interface ProjectCollectionRecord extends Project {
  observedAt: number;
  snapshotObservedAt?: number;
}

export interface ProjectCollectionQueryState {
  key: string;
  ids: string[];
  requestStartedAt: number;
  fetchedAt: number;
}

export interface ProjectCollectionState {
  entities: ReadonlyMap<string, ProjectCollectionRecord>;
  queries: ReadonlyMap<string, ProjectCollectionQueryState>;
}

export interface ProjectQueueCollectionRecord {
  projectId: string;
  items: readonly ProjectQueueItemSummary[];
  observedAt: number;
  snapshotObservedAt?: number;
}

export interface ProjectQueueCollectionState {
  byProject: ReadonlyMap<string, ProjectQueueCollectionRecord>;
}

export interface ProjectQueueCountSource {
  id: string;
  projectQueueCount?: number;
  snapshotObservedAt?: number;
}

export interface InboxCollectionState {
  tiers: Record<InboxTier, readonly string[]>;
  requestStartedAt?: number;
  fetchedAt?: number;
}

export interface InboxCounts {
  needsAttention: number;
  active: number;
  total: number;
}

export interface SessionCollectionState {
  entities: ReadonlyMap<string, SessionCollectionRecord>;
  queries: ReadonlyMap<string, SessionCollectionQueryState>;
}

export interface LocalDecorationState {
  draftSessionIds: ReadonlySet<string>;
  draftObservedAt?: number;
}

export interface ClientSummaryState {
  sessions: SessionCollectionState;
  projects: ProjectCollectionState;
  projectQueues: ProjectQueueCollectionState;
  inbox: InboxCollectionState;
  localDecorations: LocalDecorationState;
}

export interface GlobalSessionsCollectionSnapshot {
  query: SessionCollectionQueryDescriptor;
  sessions: readonly GlobalSessionItem[];
  hasMore: boolean;
  mode?: "replace" | "append" | "prepend";
}

export interface ProjectsCollectionSnapshot {
  projects: readonly Project[];
}

export interface ProjectCollectionSnapshot {
  project: Project;
}

export interface ProjectQueueCollectionSnapshot extends ProjectQueueResponse {}

export interface ProjectQueueGlobalCollectionSnapshot
  extends ProjectQueueListResponse {}

export interface InboxCollectionSnapshot extends InboxResponse {}

const ALL_PROJECTS_QUERY_KEY = "all-projects";
const EMPTY_PROJECT_QUEUE_ITEMS: readonly ProjectQueueItemSummary[] = [];
const ACTIVE_INBOX_TIERS: readonly InboxTier[] = [
  "needsAttention",
  "active",
];

export function createEmptyClientSummaryState(): ClientSummaryState {
  return {
    sessions: {
      entities: new Map(),
      queries: new Map(),
    },
    projects: {
      entities: new Map(),
      queries: new Map(),
    },
    projectQueues: {
      byProject: new Map(),
    },
    inbox: {
      tiers: createEmptyInboxTierRecord(() => []),
    },
    localDecorations: {
      draftSessionIds: new Set(),
    },
  };
}

export function createGlobalSessionsCollectionQueryDescriptor(options: {
  projectId?: string | null;
  searchQuery?: string;
  limit?: number;
  includeArchived?: boolean;
  starred?: boolean;
}): SessionCollectionQueryDescriptor {
  return {
    scope: "global-sessions",
    projectId: options.projectId ?? null,
    searchQuery: options.searchQuery || undefined,
    limit: options.limit,
    includeArchived: options.includeArchived,
    starred: options.starred,
  };
}

export function createGlobalSessionsQueryKey(
  descriptor: SessionCollectionQueryDescriptor,
): string {
  const normalized = {
    scope: descriptor.scope,
    projectId: descriptor.projectId ?? null,
    searchQuery: descriptor.searchQuery?.trim() || null,
    limit: descriptor.limit ?? null,
    includeArchived: descriptor.includeArchived === true,
    starred: descriptor.starred === true,
  };
  return JSON.stringify(normalized);
}

function getRecord(
  state: ClientSummaryState,
  sessionId: string,
): SessionCollectionRecord {
  return (
    state.sessions.entities.get(sessionId) ?? {
      id: sessionId,
      observedAt: NO_OBSERVATION,
    }
  );
}

function putRecord(
  state: ClientSummaryState,
  record: SessionCollectionRecord,
): ClientSummaryState {
  const entities = new Map(state.sessions.entities);
  entities.set(record.id, record);
  return {
    ...state,
    sessions: {
      ...state.sessions,
      entities,
    },
  };
}

function providerCountsEqual(
  a: Project["sessionCountsByProvider"],
  b: Project["sessionCountsByProvider"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const provider = key as ProviderName;
    return a[provider] === b[provider];
  });
}

function projectFieldsEqual(
  record: ProjectCollectionRecord,
  project: Project,
): boolean {
  return (
    record.id === project.id &&
    record.path === project.path &&
    record.name === project.name &&
    record.sessionCount === project.sessionCount &&
    providerCountsEqual(
      record.sessionCountsByProvider,
      project.sessionCountsByProvider,
    ) &&
    record.activeOwnedCount === project.activeOwnedCount &&
    record.activeExternalCount === project.activeExternalCount &&
    record.projectQueueBlockingCount === project.projectQueueBlockingCount &&
    record.lastActivity === project.lastActivity
  );
}

function putProjectRecord(
  state: ClientSummaryState,
  project: Project,
  observedAt: number,
): ClientSummaryState {
  const existing = state.projects.entities.get(project.id);
  if (existing) {
    if (observedAt < (existing.snapshotObservedAt ?? NO_OBSERVATION)) {
      return state;
    }
    if (projectFieldsEqual(existing, project)) {
      if (observedAt === existing.snapshotObservedAt) {
        return state;
      }
      const entities = new Map(state.projects.entities);
      entities.set(project.id, {
        ...existing,
        observedAt: Math.max(existing.observedAt, observedAt),
        snapshotObservedAt: observedAt,
      });
      return {
        ...state,
        projects: {
          ...state.projects,
          entities,
        },
      };
    }
  }

  const entities = new Map(state.projects.entities);
  entities.set(project.id, {
    ...project,
    observedAt: Math.max(existing?.observedAt ?? NO_OBSERVATION, observedAt),
    snapshotObservedAt: observedAt,
  });

  return {
    ...state,
    projects: {
      ...state.projects,
      entities,
    },
  };
}

function putProjectsQuery(
  state: ClientSummaryState,
  projects: readonly Project[],
  requestStartedAt: number,
): ClientSummaryState {
  const existing = state.projects.queries.get(ALL_PROJECTS_QUERY_KEY);
  if (existing && requestStartedAt < existing.requestStartedAt) {
    return state;
  }

  const ids = projects.map((project) => project.id);
  if (
    existing &&
    existing.ids.length === ids.length &&
    existing.ids.every((id, index) => id === ids[index])
  ) {
    if (requestStartedAt === existing.requestStartedAt) {
      return state;
    }
    const queries = new Map(state.projects.queries);
    queries.set(ALL_PROJECTS_QUERY_KEY, {
      ...existing,
      requestStartedAt,
      fetchedAt: Date.now(),
    });
    return {
      ...state,
      projects: {
        ...state.projects,
        queries,
      },
    };
  }

  const queries = new Map(state.projects.queries);
  queries.set(ALL_PROJECTS_QUERY_KEY, {
    key: ALL_PROJECTS_QUERY_KEY,
    ids,
    requestStartedAt,
    fetchedAt: Date.now(),
  });

  return {
    ...state,
    projects: {
      ...state.projects,
      queries,
    },
  };
}

function normalizedJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function projectQueueItemsEqual(
  a: readonly ProjectQueueItemSummary[],
  b: readonly ProjectQueueItemSummary[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    if (!other) return false;
    return (
      item.id === other.id &&
      item.projectId === other.projectId &&
      normalizedJsonEqual(item.target, other.target) &&
      item.messagePreview === other.messagePreview &&
      normalizedJsonEqual(item.message, other.message) &&
      item.createdAt === other.createdAt &&
      item.updatedAt === other.updatedAt &&
      normalizedJsonEqual(item.createdFrom, other.createdFrom) &&
      item.status === other.status &&
      item.attachmentCount === other.attachmentCount &&
      item.lastError === other.lastError &&
      item.lastAttemptAt === other.lastAttemptAt
    );
  });
}

function inboxTierIdsEqual(
  a: Record<InboxTier, readonly string[]>,
  b: Record<InboxTier, readonly string[]>,
): boolean {
  return INBOX_TIERS.every((tier) => {
    const aIds = a[tier];
    const bIds = b[tier];
    return (
      aIds.length === bIds.length &&
      aIds.every((id, index) => id === bIds[index])
    );
  });
}

function stringSetsEqual(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function putProjectQueueSnapshot(
  state: ClientSummaryState,
  snapshot: ProjectQueueCollectionSnapshot,
  observedAt: number,
): ClientSummaryState {
  const existing = state.projectQueues.byProject.get(snapshot.projectId);
  if (existing) {
    if (observedAt < (existing.snapshotObservedAt ?? NO_OBSERVATION)) {
      return state;
    }

    if (projectQueueItemsEqual(existing.items, snapshot.items)) {
      if (observedAt === existing.snapshotObservedAt) {
        return state;
      }
      const byProject = new Map(state.projectQueues.byProject);
      byProject.set(snapshot.projectId, {
        ...existing,
        observedAt: Math.max(existing.observedAt, observedAt),
        snapshotObservedAt: observedAt,
      });
      return {
        ...state,
        projectQueues: {
          ...state.projectQueues,
          byProject,
        },
      };
    }
  }

  const byProject = new Map(state.projectQueues.byProject);
  byProject.set(snapshot.projectId, {
    projectId: snapshot.projectId,
    items: snapshot.items,
    observedAt: Math.max(existing?.observedAt ?? NO_OBSERVATION, observedAt),
    snapshotObservedAt: observedAt,
  });

  return {
    ...state,
    projectQueues: {
      ...state.projectQueues,
      byProject,
    },
  };
}

function putProjectQueueGlobalSnapshot(
  state: ClientSummaryState,
  snapshot: ProjectQueueGlobalCollectionSnapshot,
  observedAt: number,
): ClientSummaryState {
  const bySnapshotProject = new Map<UrlProjectId, ProjectQueueItemSummary[]>();
  for (const item of snapshot.items) {
    const items = bySnapshotProject.get(item.projectId);
    if (items) {
      items.push(item);
    } else {
      bySnapshotProject.set(item.projectId, [item]);
    }
  }

  let next = state;
  for (const [projectId, items] of bySnapshotProject) {
    next = putProjectQueueSnapshot(next, { projectId, items }, observedAt);
  }

  let byProject: Map<string, ProjectQueueCollectionRecord> | null = null;
  for (const [projectId, existing] of next.projectQueues.byProject) {
    if (bySnapshotProject.has(projectId as UrlProjectId)) {
      continue;
    }
    if ((existing.snapshotObservedAt ?? NO_OBSERVATION) > observedAt) {
      continue;
    }
    if (!byProject) {
      byProject = new Map(next.projectQueues.byProject);
    }
    byProject.delete(projectId);
  }

  if (!byProject) {
    return next;
  }

  return {
    ...next,
    projectQueues: {
      ...next.projectQueues,
      byProject,
    },
  };
}

function upsertInboxItemRecord(
  state: ClientSummaryState,
  item: InboxItem,
  tier: InboxTier,
  observation: SessionCollectionObservation,
): ClientSummaryState {
  let record = getRecord(state, item.sessionId);

  record = withContentFields(
    record,
    {
      title: item.sessionTitle,
      updatedAt: item.updatedAt,
    },
    observation,
  );

  record = withProjectFields(
    record,
    {
      projectId: item.projectId,
      projectName: item.projectName,
    },
    observation,
  );

  record = withMetadataFields(
    record,
    {
      customTitle: item.customTitle,
    },
    observation,
  );

  const inferredActivity =
    item.activity ??
    (item.pendingInputType
      ? "waiting-input"
      : tier === "active"
        ? "in-turn"
        : null);
  record = withLifecycleFields(
    record,
    {
      activity: inferredActivity,
      pendingInputType: item.pendingInputType,
    },
    observation,
  );

  record = withUnreadField(record, item.hasUnread, observation);

  return putRecord(state, record);
}

function putInboxSnapshot(
  state: ClientSummaryState,
  snapshot: InboxCollectionSnapshot,
  requestStartedAt: number,
): ClientSummaryState {
  if (
    state.inbox.requestStartedAt !== undefined &&
    requestStartedAt < state.inbox.requestStartedAt
  ) {
    return state;
  }

  const observation = createSessionCollectionObservation(
    requestStartedAt,
    "partial-snapshot",
    "inbox",
  );
  let next = state;
  const tiers = createEmptyInboxTierRecord<string[]>(() => []);
  for (const tier of INBOX_TIERS) {
    for (const item of snapshot[tier]) {
      tiers[tier].push(item.sessionId);
      next = upsertInboxItemRecord(next, item, tier, observation);
    }
  }

  const stableTiers = inboxTierIdsEqual(next.inbox.tiers, tiers)
    ? next.inbox.tiers
    : tiers;

  return {
    ...next,
    inbox: {
      ...next.inbox,
      tiers: stableTiers,
      requestStartedAt,
      fetchedAt: Date.now(),
    },
  };
}

function normalizeActivity(
  activity: AgentActivity | null | undefined,
): AgentActivity | undefined {
  return activity === "in-turn" || activity === "waiting-input"
    ? activity
    : undefined;
}

function isActiveActivity(activity: AgentActivity | undefined): boolean {
  return activity === "in-turn" || activity === "waiting-input";
}

function createSessionCollectionObservation(
  observedAt: number,
  kind: SessionCollectionObservationKind,
  source: SessionCollectionObservationSource,
): SessionCollectionObservation {
  return { observedAt, kind, source };
}

function isFreshObservation(
  observation: SessionCollectionObservation,
  recordObservedAt: number | undefined,
): boolean {
  return observation.observedAt >= (recordObservedAt ?? NO_OBSERVATION);
}

function canApplyObservedField<T>(
  currentValue: T | undefined,
  nextValue: T | undefined,
  isFresh: boolean,
): nextValue is T {
  return nextValue !== undefined && (isFresh || currentValue === undefined);
}

function withContentFields(
  record: SessionCollectionRecord,
  fields: {
    title?: string | null;
    fullTitle?: string | null;
    createdAt?: string;
    updatedAt?: string;
    messageCount?: number;
    provider?: ProviderName;
    model?: string;
    initialPrompt?: string;
    lastAgentText?: string;
  },
  observation: SessionCollectionObservation,
): SessionCollectionRecord {
  if (Object.values(fields).every((value) => value === undefined)) {
    return record;
  }
  const isFresh = isFreshObservation(observation, record.contentObservedAt);

  return {
    ...record,
    ...(canApplyObservedField(record.title, fields.title, isFresh)
      ? { title: fields.title }
      : {}),
    ...(canApplyObservedField(record.fullTitle, fields.fullTitle, isFresh)
      ? { fullTitle: fields.fullTitle }
      : {}),
    ...(canApplyObservedField(record.createdAt, fields.createdAt, isFresh)
      ? { createdAt: fields.createdAt }
      : {}),
    ...(canApplyObservedField(record.updatedAt, fields.updatedAt, isFresh)
      ? { updatedAt: fields.updatedAt }
      : {}),
    ...(canApplyObservedField(
      record.messageCount,
      fields.messageCount,
      isFresh,
    )
      ? { messageCount: fields.messageCount }
      : {}),
    ...(canApplyObservedField(record.provider, fields.provider, isFresh)
      ? { provider: fields.provider }
      : {}),
    ...(canApplyObservedField(record.model, fields.model, isFresh)
      ? { model: fields.model }
      : {}),
    ...(canApplyObservedField(
      record.initialPrompt,
      fields.initialPrompt,
      isFresh,
    )
      ? { initialPrompt: fields.initialPrompt }
      : {}),
    ...(canApplyObservedField(
      record.lastAgentText,
      fields.lastAgentText,
      isFresh,
    )
      ? { lastAgentText: fields.lastAgentText }
      : {}),
    ...(isFresh ? { contentObservedAt: observation.observedAt } : {}),
    observedAt: Math.max(record.observedAt, observation.observedAt),
  };
}

function withMetadataFields(
  record: SessionCollectionRecord,
  fields: {
    customTitle?: string;
    isArchived?: boolean;
    isStarred?: boolean;
    parentSessionId?: string;
    executor?: string;
  },
  observation: SessionCollectionObservation,
): SessionCollectionRecord {
  if (Object.values(fields).every((value) => value === undefined)) {
    return record;
  }
  const isFresh = isFreshObservation(observation, record.metadataObservedAt);

  return {
    ...record,
    ...(canApplyObservedField(record.customTitle, fields.customTitle, isFresh)
      ? { customTitle: fields.customTitle }
      : {}),
    ...(canApplyObservedField(record.isArchived, fields.isArchived, isFresh)
      ? { isArchived: fields.isArchived }
      : {}),
    ...(canApplyObservedField(record.isStarred, fields.isStarred, isFresh)
      ? { isStarred: fields.isStarred }
      : {}),
    ...(canApplyObservedField(
      record.parentSessionId,
      fields.parentSessionId,
      isFresh,
    )
      ? { parentSessionId: fields.parentSessionId }
      : {}),
    ...(canApplyObservedField(record.executor, fields.executor, isFresh)
      ? { executor: fields.executor }
      : {}),
    ...(isFresh ? { metadataObservedAt: observation.observedAt } : {}),
    observedAt: Math.max(record.observedAt, observation.observedAt),
  };
}

function withProjectFields(
  record: SessionCollectionRecord,
  fields: {
    projectId?: string;
    projectName?: string;
  },
  observation: SessionCollectionObservation,
): SessionCollectionRecord {
  if (Object.values(fields).every((value) => value === undefined)) {
    return record;
  }
  const isFresh = isFreshObservation(observation, record.projectObservedAt);

  return {
    ...record,
    ...(canApplyObservedField(record.projectId, fields.projectId, isFresh)
      ? { projectId: fields.projectId }
      : {}),
    ...(canApplyObservedField(record.projectName, fields.projectName, isFresh)
      ? { projectName: fields.projectName }
      : {}),
    ...(isFresh ? { projectObservedAt: observation.observedAt } : {}),
    observedAt: Math.max(record.observedAt, observation.observedAt),
  };
}

function withLifecycleFields(
  record: SessionCollectionRecord,
  fields: {
    ownership?: SessionStatus;
    activity?: AgentActivity | null;
    pendingInputType?: PendingInputType;
  },
  observation: SessionCollectionObservation,
): SessionCollectionRecord {
  if (
    fields.ownership === undefined &&
    fields.activity === undefined &&
    fields.pendingInputType === undefined
  ) {
    return record;
  }

  const isFresh = isFreshObservation(observation, record.lifecycleObservedAt);
  const normalizedActivity = normalizeActivity(fields.activity);
  const wasActive = isActiveActivity(record.activity);
  const nextActivity = isFresh ? normalizedActivity : record.activity;
  const isActive = isActiveActivity(nextActivity);
  const nextPendingInputType = (() => {
    if (isFresh) {
      return nextActivity === "waiting-input"
        ? fields.pendingInputType
        : undefined;
    }
    if (
      nextActivity === "waiting-input" &&
      canApplyObservedField(
        record.pendingInputType,
        fields.pendingInputType,
        isFresh,
      )
    ) {
      return fields.pendingInputType;
    }
    return record.pendingInputType;
  })();

  return {
    ...record,
    ...(canApplyObservedField(record.ownership, fields.ownership, isFresh)
      ? { ownership: fields.ownership }
      : {}),
    activity: nextActivity,
    activeStartedAt: isFresh
      ? isActive
        ? wasActive
          ? record.activeStartedAt
          : observation.observedAt
        : undefined
      : record.activeStartedAt,
    pendingInputType: nextPendingInputType,
    ...(isFresh ? { lifecycleObservedAt: observation.observedAt } : {}),
    observedAt: Math.max(record.observedAt, observation.observedAt),
  };
}

function withUnreadField(
  record: SessionCollectionRecord,
  hasUnread: boolean | undefined,
  observation: SessionCollectionObservation,
): SessionCollectionRecord {
  if (hasUnread === undefined) {
    return record;
  }

  const isFresh = isFreshObservation(observation, record.unreadObservedAt);
  if (!isFresh && record.hasUnread !== undefined) {
    return record;
  }

  return {
    ...record,
    hasUnread,
    ...(isFresh ? { unreadObservedAt: observation.observedAt } : {}),
    observedAt: Math.max(record.observedAt, observation.observedAt),
  };
}

function upsertSnapshotRecord(
  state: ClientSummaryState,
  row: GlobalSessionItem,
  observation: SessionCollectionObservation,
): ClientSummaryState {
  let record = getRecord(state, row.id);

  record = withContentFields(
    record,
    {
      title: row.title,
      fullTitle: row.fullTitle,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row.messageCount,
      provider: row.provider,
      model: row.model,
      initialPrompt: row.initialPrompt,
      lastAgentText: row.lastAgentText,
    },
    observation,
  );

  record = withMetadataFields(
    record,
    {
      customTitle: row.customTitle,
      isArchived: row.isArchived,
      isStarred: row.isStarred,
      parentSessionId: row.parentSessionId,
      executor: row.executor,
    },
    observation,
  );

  record = withProjectFields(
    record,
    {
      projectId: row.projectId,
      projectName: row.projectName,
    },
    observation,
  );

  record = withLifecycleFields(
    record,
    {
      ownership: row.ownership,
      activity: row.activity,
      pendingInputType: row.pendingInputType,
    },
    observation,
  );

  record = withUnreadField(record, row.hasUnread, observation);

  record = {
    ...record,
    snapshotObservedAt: Math.max(
      record.snapshotObservedAt ?? NO_OBSERVATION,
      observation.observedAt,
    ),
    observedAt: Math.max(record.observedAt, observation.observedAt),
  };

  return putRecord(state, record);
}

function upsertQuery(
  state: ClientSummaryState,
  snapshot: GlobalSessionsCollectionSnapshot,
  requestStartedAt: number,
): ClientSummaryState {
  const key = createGlobalSessionsQueryKey(snapshot.query);
  const existing = state.sessions.queries.get(key);
  if (existing && requestStartedAt < existing.requestStartedAt) {
    return state;
  }

  const incomingIds = snapshot.sessions.map((session) => session.id);
  let ids = incomingIds;
  if (snapshot.mode === "append" && existing) {
    ids = [
      ...existing.ids,
      ...incomingIds.filter((id) => !existing.ids.includes(id)),
    ];
  } else if (snapshot.mode === "prepend" && existing) {
    const incomingIdSet = new Set(incomingIds);
    ids = [
      ...incomingIds,
      ...existing.ids.filter((id) => !incomingIdSet.has(id)),
    ];
  }

  const queries = new Map(state.sessions.queries);
  queries.set(key, {
    key,
    descriptor: snapshot.query,
    ids,
    hasMore: snapshot.hasMore,
    requestStartedAt,
    fetchedAt: Date.now(),
  });

  return {
    ...state,
    sessions: {
      ...state.sessions,
      queries,
    },
  };
}

export function applyGlobalSessionsCollectionSnapshot(
  state: ClientSummaryState,
  snapshot: GlobalSessionsCollectionSnapshot,
  requestStartedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    requestStartedAt,
    "full-snapshot",
    "global-sessions",
  );
  let next = state;
  for (const row of snapshot.sessions) {
    next = upsertSnapshotRecord(next, row, observation);
  }
  return upsertQuery(next, snapshot, requestStartedAt);
}

export function applyProjectsCollectionSnapshot(
  state: ClientSummaryState,
  snapshot: ProjectsCollectionSnapshot,
  requestStartedAt = Date.now(),
): ClientSummaryState {
  let next = state;
  for (const project of snapshot.projects) {
    next = putProjectRecord(next, project, requestStartedAt);
  }
  return putProjectsQuery(next, snapshot.projects, requestStartedAt);
}

export function applyProjectCollectionSnapshot(
  state: ClientSummaryState,
  snapshot: ProjectCollectionSnapshot,
  requestStartedAt = Date.now(),
): ClientSummaryState {
  return putProjectRecord(state, snapshot.project, requestStartedAt);
}

export function applyProjectQueueCollectionSnapshot(
  state: ClientSummaryState,
  snapshot: ProjectQueueCollectionSnapshot,
  requestStartedAt = Date.now(),
): ClientSummaryState {
  return putProjectQueueSnapshot(state, snapshot, requestStartedAt);
}

export function applyProjectQueueGlobalCollectionSnapshot(
  state: ClientSummaryState,
  snapshot: ProjectQueueGlobalCollectionSnapshot,
  requestStartedAt = Date.now(),
): ClientSummaryState {
  return putProjectQueueGlobalSnapshot(state, snapshot, requestStartedAt);
}

export function applyProjectQueueCollectionChanged(
  state: ClientSummaryState,
  event: ProjectQueueChangedEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  return putProjectQueueSnapshot(
    state,
    { projectId: event.projectId, items: event.items },
    observedAt,
  );
}

export function applyInboxCollectionSnapshot(
  state: ClientSummaryState,
  snapshot: InboxCollectionSnapshot,
  requestStartedAt = Date.now(),
): ClientSummaryState {
  return putInboxSnapshot(state, snapshot, requestStartedAt);
}

export function applyDraftSessionIdsSnapshot(
  state: ClientSummaryState,
  draftSessionIds: ReadonlySet<string>,
  observedAt = Date.now(),
): ClientSummaryState {
  if (stringSetsEqual(state.localDecorations.draftSessionIds, draftSessionIds)) {
    return state;
  }

  return {
    ...state,
    localDecorations: {
      ...state.localDecorations,
      draftSessionIds: new Set(draftSessionIds),
      draftObservedAt: observedAt,
    },
  };
}

export function applySessionCollectionCreated(
  state: ClientSummaryState,
  event: SessionCreatedEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    observedAt,
    "partial-event",
    "session-created",
  );
  const session = event.session;
  let record = getRecord(state, session.id);

  record = withContentFields(
    record,
    {
      title: session.title,
      fullTitle: session.fullTitle,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      provider: session.provider,
      model: session.model,
      initialPrompt: session.initialPrompt,
      lastAgentText: session.lastAgentText,
    },
    observation,
  );

  record = withMetadataFields(
    record,
    {
      customTitle: session.customTitle,
      isArchived: session.isArchived,
      isStarred: session.isStarred,
      parentSessionId: session.parentSessionId,
    },
    observation,
  );

  record = withProjectFields(
    record,
    {
      projectId: session.projectId,
      projectName: session.projectName ?? record.projectName,
    },
    observation,
  );

  record = withLifecycleFields(
    record,
    {
      ownership: session.ownership,
      activity: session.activity,
      pendingInputType: session.pendingInputType,
    },
    observation,
  );

  record = withUnreadField(record, session.hasUnread, observation);

  return putRecord(state, {
    ...record,
    eventCreatedAt: observedAt,
    observedAt: Math.max(record.observedAt, observedAt),
  });
}

export function applySessionCollectionUpdated(
  state: ClientSummaryState,
  event: SessionUpdatedEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    observedAt,
    "partial-event",
    "session-updated",
  );
  const record = withContentFields(
    getRecord(state, event.sessionId),
    {
      title: event.title,
      updatedAt: event.updatedAt,
      messageCount: event.messageCount,
      model: event.model,
      lastAgentText: event.lastAgentText,
    },
    observation,
  );
  return putRecord(state, record);
}

export function applySessionCollectionMetadataChanged(
  state: ClientSummaryState,
  event: SessionMetadataChangedEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    observedAt,
    "partial-event",
    "metadata-changed",
  );
  const record = withMetadataFields(
    getRecord(state, event.sessionId),
    {
      customTitle: event.title,
      isArchived: event.archived,
      isStarred: event.starred,
      parentSessionId: event.parentSessionId ?? undefined,
    },
    observation,
  );
  const withProject = withProjectFields(
    record,
    { projectId: event.projectId },
    observation,
  );
  return putRecord(state, withProject);
}

export function applySessionCollectionStatusChanged(
  state: ClientSummaryState,
  event: SessionStatusEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    observedAt,
    "partial-event",
    "session-status",
  );
  let record = getRecord(state, event.sessionId);
  record = withProjectFields(
    record,
    { projectId: event.projectId },
    observation,
  );
  record = withLifecycleFields(
    record,
    {
      ownership: event.ownership,
      activity: event.ownership.owner === "none" ? "idle" : record.activity,
      pendingInputType: record.pendingInputType,
    },
    observation,
  );
  return putRecord(state, record);
}

export function applySessionCollectionProcessStateChanged(
  state: ClientSummaryState,
  event: ProcessStateEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    observedAt,
    "partial-event",
    "process-state",
  );
  let record = getRecord(state, event.sessionId);
  record = withProjectFields(
    record,
    { projectId: event.projectId },
    observation,
  );
  record = withLifecycleFields(
    record,
    {
      activity: event.activity,
      pendingInputType: event.pendingInputType,
    },
    observation,
  );
  return putRecord(state, record);
}

export function applySessionCollectionSeen(
  state: ClientSummaryState,
  event: SessionSeenEvent,
  observedAt = Date.now(),
): ClientSummaryState {
  const observation = createSessionCollectionObservation(
    observedAt,
    "partial-event",
    "session-seen",
  );
  const record = withUnreadField(
    getRecord(state, event.sessionId),
    false,
    observation,
  );
  return putRecord(state, record);
}

export function selectSessionCollectionRecord(
  state: ClientSummaryState,
  sessionId: string | null | undefined,
): SessionCollectionRecord | undefined {
  return sessionId ? state.sessions.entities.get(sessionId) : undefined;
}

export function selectSessionCollectionQueryState(
  state: ClientSummaryState,
  query: SessionCollectionQueryDescriptor,
): SessionCollectionQueryState | undefined {
  return state.sessions.queries.get(createGlobalSessionsQueryKey(query));
}

export function selectProjectCollectionRecord(
  state: ClientSummaryState,
  projectId: string | null | undefined,
): ProjectCollectionRecord | undefined {
  return projectId ? state.projects.entities.get(projectId) : undefined;
}

export function selectProjectCollectionRecords(
  state: ClientSummaryState,
): ProjectCollectionRecord[] {
  const queryState = state.projects.queries.get(ALL_PROJECTS_QUERY_KEY);
  if (!queryState) {
    return [];
  }

  return queryState.ids.flatMap((id) => {
    const record = state.projects.entities.get(id);
    return record ? [record] : [];
  });
}

export function selectProjectQueueItems(
  state: ClientSummaryState,
  projectId: string | null | undefined,
): readonly ProjectQueueItemSummary[] {
  return projectId
    ? (state.projectQueues.byProject.get(projectId)?.items ??
        EMPTY_PROJECT_QUEUE_ITEMS)
    : EMPTY_PROJECT_QUEUE_ITEMS;
}

export function selectProjectQueueItemsByProject(
  state: ClientSummaryState,
  projectIds: readonly string[],
): Record<string, readonly ProjectQueueItemSummary[]> {
  const result: Record<string, readonly ProjectQueueItemSummary[]> = {};
  for (const projectId of projectIds) {
    const record = state.projectQueues.byProject.get(projectId);
    if (record) {
      result[projectId] = record.items;
    }
  }
  return result;
}

function countVisibleProjectQueueItems(
  items: readonly ProjectQueueItemSummary[],
): number {
  return items.filter(
    (item) => item.status === "queued" || item.status === "failed",
  ).length;
}

export function selectProjectQueueSidebarCount(
  state: ClientSummaryState,
  projects: readonly ProjectQueueCountSource[],
): number {
  const projectIds = new Set<string>();
  let total = 0;

  for (const project of projects) {
    projectIds.add(project.id);
    const queueRecord = state.projectQueues.byProject.get(project.id);
    const projectObservedAt =
      project.snapshotObservedAt ?? Number.NEGATIVE_INFINITY;

    if (queueRecord && queueRecord.observedAt >= projectObservedAt) {
      total += countVisibleProjectQueueItems(queueRecord.items);
    } else {
      total += project.projectQueueCount ?? 0;
    }
  }

  for (const [projectId, queueRecord] of state.projectQueues.byProject) {
    if (!projectIds.has(projectId)) {
      total += countVisibleProjectQueueItems(queueRecord.items);
    }
  }

  return total;
}

export function selectProjectQueuedSessionIds(
  state: ClientSummaryState,
  projectIds: readonly string[],
): ReadonlySet<string> {
  const sessionIds = new Set<string>();
  for (const projectId of projectIds) {
    const items = selectProjectQueueItems(state, projectId);
    for (const item of items) {
      if (item.target.type === "existing-session") {
        sessionIds.add(item.target.sessionId);
      }
    }
  }
  return sessionIds;
}

export function selectDraftSessionIds(
  state: ClientSummaryState,
): ReadonlySet<string> {
  return state.localDecorations.draftSessionIds;
}

function sessionRecordToInboxItem(
  record: SessionCollectionRecord,
): InboxItem | null {
  if (!record.projectId || !record.updatedAt) {
    return null;
  }
  return {
    sessionId: record.id,
    projectId: record.projectId,
    projectName: record.projectName ?? "",
    sessionTitle: record.title ?? null,
    updatedAt: record.updatedAt,
    customTitle: record.customTitle,
    pendingInputType: record.pendingInputType,
    activity: record.activity,
    hasUnread: record.hasUnread,
  };
}

export function selectInboxTierItems(
  state: ClientSummaryState,
  tier: InboxTier,
): InboxItem[] {
  return state.inbox.tiers[tier].flatMap((sessionId) => {
    const record = state.sessions.entities.get(sessionId);
    if (!record) {
      return [];
    }
    const item = sessionRecordToInboxItem(record);
    return item ? [item] : [];
  });
}

export function selectInboxResponse(state: ClientSummaryState): InboxResponse {
  return {
    needsAttention: selectInboxTierItems(state, "needsAttention"),
    active: selectInboxTierItems(state, "active"),
    recentActivity: selectInboxTierItems(state, "recentActivity"),
    unread8h: selectInboxTierItems(state, "unread8h"),
    unread24h: selectInboxTierItems(state, "unread24h"),
  };
}

export function selectInboxCounts(state: ClientSummaryState): InboxCounts {
  return {
    needsAttention: state.inbox.tiers.needsAttention.length,
    active: state.inbox.tiers.active.length,
    total: INBOX_TIERS.reduce(
      (total, tier) => total + state.inbox.tiers[tier].length,
      0,
    ),
  };
}

function incrementInboxProjectCount(
  countsByProject: Map<string, InboxCounts>,
  projectId: string,
  tier: InboxTier,
): void {
  const current =
    countsByProject.get(projectId) ??
    ({
      needsAttention: 0,
      active: 0,
      total: 0,
    } satisfies InboxCounts);

  countsByProject.set(projectId, {
    needsAttention:
      current.needsAttention + (tier === "needsAttention" ? 1 : 0),
    active: current.active + (tier === "active" ? 1 : 0),
    total: current.total + 1,
  });
}

export function selectInboxCountsByProject(
  state: ClientSummaryState,
): ReadonlyMap<string, InboxCounts> {
  const countsByProject = new Map<string, InboxCounts>();
  for (const tier of INBOX_TIERS) {
    for (const sessionId of state.inbox.tiers[tier]) {
      const projectId = state.sessions.entities.get(sessionId)?.projectId;
      if (projectId) {
        incrementInboxProjectCount(countsByProject, projectId, tier);
      }
    }
  }
  return countsByProject;
}

export function selectActiveProjectSessionIds(
  state: ClientSummaryState,
  projectId: string | null | undefined,
): string[] {
  if (!projectId) {
    return [];
  }

  const sessionIds: string[] = [];
  for (const tier of ACTIVE_INBOX_TIERS) {
    for (const sessionId of state.inbox.tiers[tier]) {
      const record = state.sessions.entities.get(sessionId);
      if (record?.projectId === projectId) {
        sessionIds.push(sessionId);
      }
    }
  }
  return sessionIds;
}

export function selectActiveAgentCount(state: ClientSummaryState): number {
  return state.inbox.tiers.active.length;
}

export function selectHasActiveAgents(state: ClientSummaryState): boolean {
  return selectActiveAgentCount(state) > 0;
}

function updatedAtMs(record: SessionCollectionRecord): number {
  return record.updatedAt ? Date.parse(record.updatedAt) || 0 : 0;
}

function byUpdatedAtDesc(
  a: SessionCollectionRecord,
  b: SessionCollectionRecord,
): number {
  return updatedAtMs(b) - updatedAtMs(a);
}

function activeStartedAtMs(record: SessionCollectionRecord): number {
  return record.activeStartedAt ?? record.eventCreatedAt ?? record.observedAt;
}

function byActiveStartedAtAsc(
  a: SessionCollectionRecord,
  b: SessionCollectionRecord,
): number {
  return activeStartedAtMs(a) - activeStartedAtMs(b);
}

function orderActiveFirst(records: SessionCollectionRecord[]) {
  const active = records
    .filter((record) => isActiveActivity(record.activity))
    .sort(byActiveStartedAtAsc);
  const idle = records
    .filter((record) => !isActiveActivity(record.activity))
    .sort(byUpdatedAtDesc);

  return [...active, ...idle];
}

export function selectStarredSessionRecords(
  state: ClientSummaryState,
): SessionCollectionRecord[] {
  return selectStarredSessionRecordsFromRecords(
    Array.from(state.sessions.entities.values()),
  );
}

export function selectStarredSessionRecordsFromRecords(
  records: readonly SessionCollectionRecord[],
): SessionCollectionRecord[] {
  return orderActiveFirst(
    records.filter(
      (record) => record.isStarred === true && record.isArchived !== true,
    ),
  );
}

export function selectRecentSessionRecords(
  state: ClientSummaryState,
  now = Date.now(),
): SessionCollectionRecord[] {
  return selectRecentSessionRecordsFromRecords(
    Array.from(state.sessions.entities.values()),
    now,
  );
}

export function selectRecentSessionRecordsFromRecords(
  records: readonly SessionCollectionRecord[],
  now = Date.now(),
): SessionCollectionRecord[] {
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const filtered = records.filter(
    (record) =>
      record.isStarred !== true &&
      record.isArchived !== true &&
      updatedAtMs(record) >= oneDayAgo,
  );

  return orderActiveFirst(filtered);
}

export function selectOlderSessionRecords(
  state: ClientSummaryState,
  now = Date.now(),
): SessionCollectionRecord[] {
  return selectOlderSessionRecordsFromRecords(
    Array.from(state.sessions.entities.values()),
    now,
  );
}

export function selectOlderSessionRecordsFromRecords(
  records: readonly SessionCollectionRecord[],
  now = Date.now(),
): SessionCollectionRecord[] {
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  return [...records]
    .filter(
      (record) =>
        record.isStarred !== true &&
        record.isArchived !== true &&
        updatedAtMs(record) < oneDayAgo,
    )
    .sort(byUpdatedAtDesc);
}

export function selectSessionCollectionQueryRecords(
  state: ClientSummaryState,
  query: SessionCollectionQueryDescriptor,
): SessionCollectionRecord[] {
  const key = createGlobalSessionsQueryKey(query);
  const queryState = state.sessions.queries.get(key);
  if (!queryState) {
    return [];
  }

  return queryState.ids.flatMap((id) => {
    const record = state.sessions.entities.get(id);
    return record ? [record] : [];
  });
}

export function toProjectId(projectId: string | UrlProjectId): UrlProjectId {
  return projectId as UrlProjectId;
}
