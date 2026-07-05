import type { StoreApi } from "zustand/vanilla";
import { api } from "../api/client";
import {
  clearClientSummarySource,
  getClientSummarySnapshotForSource,
  getClientSummaryStoreForSource,
  getCurrentClientSummarySourceKey,
  reportGlobalSessionsCollectionSnapshot,
  reportInboxCollectionSnapshot,
  reportProjectCollectionSnapshot,
  reportProjectQueueCollectionSnapshot,
  reportProjectQueueGlobalCollectionSnapshot,
  reportProjectsCollectionSnapshot,
  reportProviderRuntimeStatusSnapshot,
  reportSessionCollectionCreated,
  reportSessionCollectionMetadataChanged,
  retainClientSummaryActivitySubscription,
  retainClientSummaryDraftDecorations,
  setCurrentClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "./clientSummaryStore";
import type {
  SessionCreatedEvent,
  SessionMetadataChangedEvent,
} from "./activityBus";
import type {
  ClientSummaryState,
  GlobalSessionsCollectionSnapshot,
  InboxCollectionSnapshot,
  ProjectCollectionSnapshot,
  ProjectQueueCollectionSnapshot,
  ProjectQueueGlobalCollectionSnapshot,
  ProjectsCollectionSnapshot,
  ProviderRuntimeStatusSnapshot,
} from "./clientSummaryState";
import {
  defaultSessionDetailMemoryCache,
  type SessionDetailMemoryCache,
} from "./sessionDetail/sessionDetailStore";

interface GetSessionBaseInput {
  projectId: string;
  sessionId: string;
}

interface GetSessionBounds {
  afterMessageId?: string;
  tailCompactions?: number;
  beforeMessageId?: string;
  tailTurns?: number;
  tailFrom?: string;
}

type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];

type GetSessionBoundedInput = GetSessionBaseInput &
  RequireAtLeastOne<GetSessionBounds> & {
    fullHistory?: never;
    fullHistoryReason?: never;
  };

type GetSessionFullHistoryInput = GetSessionBaseInput & {
  fullHistory: true;
  fullHistoryReason: string;
  afterMessageId?: never;
  tailCompactions?: never;
  beforeMessageId?: never;
  tailTurns?: never;
  tailFrom?: never;
};

export type GetSessionInput =
  | GetSessionBoundedInput
  | GetSessionFullHistoryInput;

export type GetSessionResult = Awaited<ReturnType<typeof api.getSession>>;

export interface GetSessionMetadataInput {
  projectId: string;
  sessionId: string;
}

export type GetSessionMetadataResult = Awaited<
  ReturnType<typeof api.getSessionMetadata>
>;

export interface SourceApiClient {
  getSession(input: GetSessionInput): Promise<GetSessionResult>;
  getSessionMetadata(
    input: GetSessionMetadataInput,
  ): Promise<GetSessionMetadataResult>;
}

export interface SessionDetailRuntime {
  cache: SessionDetailMemoryCache;
}

export interface SourceSummaryRuntime {
  sourceKey: ClientSummarySourceKey;
  getStore(): StoreApi<ClientSummaryState>;
  getSnapshot(): ClientSummaryState;
  clear(): void;
  retainActivitySubscription(): () => void;
  retainDraftDecorations(): () => void;
  reportGlobalSessionsCollectionSnapshot(
    input: GlobalSessionsCollectionSnapshot,
    requestStartedAt?: number,
  ): void;
  reportInboxCollectionSnapshot(
    input: InboxCollectionSnapshot,
    requestStartedAt?: number,
  ): void;
  reportProjectsCollectionSnapshot(
    input: ProjectsCollectionSnapshot,
    requestStartedAt?: number,
  ): void;
  reportProjectCollectionSnapshot(
    input: ProjectCollectionSnapshot,
    requestStartedAt?: number,
  ): void;
  reportProjectQueueCollectionSnapshot(
    input: ProjectQueueCollectionSnapshot,
    requestStartedAt?: number,
  ): void;
  reportProjectQueueGlobalCollectionSnapshot(
    input: ProjectQueueGlobalCollectionSnapshot,
    requestStartedAt?: number,
  ): void;
  reportProviderRuntimeStatusSnapshot(
    input: ProviderRuntimeStatusSnapshot,
    observedAt?: number,
  ): void;
  reportSessionCollectionCreated(
    event: SessionCreatedEvent,
    observedAt?: number,
  ): void;
  reportSessionCollectionMetadataChanged(
    event: SessionMetadataChangedEvent,
    observedAt?: number,
  ): void;
}

export interface YaSourceRuntime {
  sourceKey: ClientSummarySourceKey;
  api: SourceApiClient;
  summary: SourceSummaryRuntime;
  sessionDetails: SessionDetailRuntime;
}

export interface SourceRuntimeRegistry {
  getOrCreateSourceRuntime(sourceKey: ClientSummarySourceKey): YaSourceRuntime;
  getCurrentSourceRuntime(): YaSourceRuntime;
  setCurrentSourceKey(sourceKey: ClientSummarySourceKey): void;
  disposeSource(sourceKey: ClientSummarySourceKey): void;
}

export interface SourceRuntimeRegistryOptions {
  apiClient?: SourceApiClient;
  sessionDetails?: SessionDetailRuntime;
  createSummaryRuntime?: (
    sourceKey: ClientSummarySourceKey,
  ) => SourceSummaryRuntime;
  getCurrentSourceKey?: () => ClientSummarySourceKey;
  setCurrentSourceKey?: (sourceKey: ClientSummarySourceKey) => void;
}

const currentSourceApiClient: SourceApiClient = {
  getSession: (input) => {
    const { projectId, sessionId } = input;
    if (input.fullHistory === true) {
      if (!input.fullHistoryReason.trim()) {
        throw new Error("Full-history session request requires a reason.");
      }
      return api.getSession(projectId, sessionId, undefined, {
        fullHistory: true,
        fullHistoryReason: input.fullHistoryReason,
      });
    }

    const { afterMessageId, tailCompactions, beforeMessageId, tailTurns } =
      input;
    const { tailFrom } = input;
    let options:
      | {
          tailCompactions?: number;
          beforeMessageId?: string;
          tailTurns?: number;
          tailFrom?: string;
          fullHistory?: boolean;
          fullHistoryReason?: string;
        }
      | undefined;
    const hasAfterMessageId = Boolean(afterMessageId);
    const hasBounds =
      hasAfterMessageId ||
      tailCompactions !== undefined ||
      beforeMessageId !== undefined ||
      tailTurns !== undefined ||
      tailFrom !== undefined;
    if (!hasBounds) {
      throw new Error(
        "Session detail request requires bounds or explicit fullHistory.",
      );
    }
    if (
      tailCompactions !== undefined ||
      beforeMessageId !== undefined ||
      tailTurns !== undefined ||
      tailFrom !== undefined
    ) {
      options = {
        tailCompactions,
        beforeMessageId,
        tailTurns,
        tailFrom,
      };
    }
    if (!options) {
      return api.getSession(projectId, sessionId, afterMessageId);
    }
    return api.getSession(projectId, sessionId, afterMessageId, options);
  },
  getSessionMetadata: ({ projectId, sessionId }) =>
    api.getSessionMetadata(projectId, sessionId),
};

const currentSessionDetailRuntime: SessionDetailRuntime = {
  cache: defaultSessionDetailMemoryCache,
};

function createCurrentSourceSummaryRuntime(
  sourceKey: ClientSummarySourceKey,
): SourceSummaryRuntime {
  return {
    sourceKey,
    getStore: () => getClientSummaryStoreForSource(sourceKey),
    getSnapshot: () => getClientSummarySnapshotForSource(sourceKey),
    clear: () => clearClientSummarySource(sourceKey),
    retainActivitySubscription: () =>
      retainClientSummaryActivitySubscription(sourceKey),
    retainDraftDecorations: () =>
      retainClientSummaryDraftDecorations(sourceKey),
    reportGlobalSessionsCollectionSnapshot: (input, requestStartedAt) => {
      reportGlobalSessionsCollectionSnapshot(
        sourceKey,
        input,
        requestStartedAt,
      );
    },
    reportInboxCollectionSnapshot: (input, requestStartedAt) => {
      reportInboxCollectionSnapshot(sourceKey, input, requestStartedAt);
    },
    reportProjectsCollectionSnapshot: (input, requestStartedAt) => {
      reportProjectsCollectionSnapshot(sourceKey, input, requestStartedAt);
    },
    reportProjectCollectionSnapshot: (input, requestStartedAt) => {
      reportProjectCollectionSnapshot(sourceKey, input, requestStartedAt);
    },
    reportProjectQueueCollectionSnapshot: (input, requestStartedAt) => {
      reportProjectQueueCollectionSnapshot(
        sourceKey,
        input,
        requestStartedAt,
      );
    },
    reportProjectQueueGlobalCollectionSnapshot: (input, requestStartedAt) => {
      reportProjectQueueGlobalCollectionSnapshot(
        sourceKey,
        input,
        requestStartedAt,
      );
    },
    reportProviderRuntimeStatusSnapshot: (input, observedAt) => {
      reportProviderRuntimeStatusSnapshot(sourceKey, input, observedAt);
    },
    reportSessionCollectionCreated: (event, observedAt) => {
      reportSessionCollectionCreated(sourceKey, event, observedAt);
    },
    reportSessionCollectionMetadataChanged: (event, observedAt) => {
      reportSessionCollectionMetadataChanged(sourceKey, event, observedAt);
    },
  };
}

class DefaultSourceRuntimeRegistry implements SourceRuntimeRegistry {
  private readonly runtimes = new Map<ClientSummarySourceKey, YaSourceRuntime>();
  private readonly apiClient: SourceApiClient;
  private readonly sessionDetails: SessionDetailRuntime;
  private readonly createSummaryRuntime: (
    sourceKey: ClientSummarySourceKey,
  ) => SourceSummaryRuntime;
  private readonly readCurrentSourceKey: () => ClientSummarySourceKey;
  private readonly writeCurrentSourceKey: (
    sourceKey: ClientSummarySourceKey,
  ) => void;

  constructor(options: SourceRuntimeRegistryOptions = {}) {
    this.apiClient = options.apiClient ?? currentSourceApiClient;
    this.sessionDetails = options.sessionDetails ?? currentSessionDetailRuntime;
    this.createSummaryRuntime =
      options.createSummaryRuntime ?? createCurrentSourceSummaryRuntime;
    this.readCurrentSourceKey =
      options.getCurrentSourceKey ?? getCurrentClientSummarySourceKey;
    this.writeCurrentSourceKey =
      options.setCurrentSourceKey ?? setCurrentClientSummarySourceKey;
  }

  getOrCreateSourceRuntime(
    sourceKey: ClientSummarySourceKey,
  ): YaSourceRuntime {
    let runtime = this.runtimes.get(sourceKey);
    if (!runtime) {
      runtime = {
        sourceKey,
        api: this.apiClient,
        summary: this.createSummaryRuntime(sourceKey),
        sessionDetails: this.sessionDetails,
      };
      this.runtimes.set(sourceKey, runtime);
    }
    return runtime;
  }

  getCurrentSourceRuntime(): YaSourceRuntime {
    return this.getOrCreateSourceRuntime(this.readCurrentSourceKey());
  }

  setCurrentSourceKey(sourceKey: ClientSummarySourceKey): void {
    this.writeCurrentSourceKey(sourceKey);
  }

  disposeSource(sourceKey: ClientSummarySourceKey): void {
    this.runtimes.delete(sourceKey);
  }
}

export function createSourceRuntimeRegistry(
  options: SourceRuntimeRegistryOptions = {},
): SourceRuntimeRegistry {
  return new DefaultSourceRuntimeRegistry(options);
}

const defaultSourceRuntimeRegistry = createSourceRuntimeRegistry();

export function getSourceRuntimeRegistry(): SourceRuntimeRegistry {
  return defaultSourceRuntimeRegistry;
}

export function getOrCreateCurrentSourceRuntime(
  sourceKey: ClientSummarySourceKey,
): YaSourceRuntime {
  return defaultSourceRuntimeRegistry.getOrCreateSourceRuntime(sourceKey);
}
