import { api } from "../api/client";
import {
  getCurrentClientSummarySourceKey,
  setCurrentClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "./clientSummaryStore";
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

export interface YaSourceRuntime {
  sourceKey: ClientSummarySourceKey;
  api: SourceApiClient;
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

class DefaultSourceRuntimeRegistry implements SourceRuntimeRegistry {
  private readonly runtimes = new Map<ClientSummarySourceKey, YaSourceRuntime>();
  private readonly apiClient: SourceApiClient;
  private readonly sessionDetails: SessionDetailRuntime;
  private readonly readCurrentSourceKey: () => ClientSummarySourceKey;
  private readonly writeCurrentSourceKey: (
    sourceKey: ClientSummarySourceKey,
  ) => void;

  constructor(options: SourceRuntimeRegistryOptions = {}) {
    this.apiClient = options.apiClient ?? currentSourceApiClient;
    this.sessionDetails = options.sessionDetails ?? currentSessionDetailRuntime;
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
