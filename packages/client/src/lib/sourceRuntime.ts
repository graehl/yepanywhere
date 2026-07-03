import { api } from "../api/client";
import type { ClientSummarySourceKey } from "./clientSummaryStore";
import {
  defaultSessionDetailStore,
  type SessionDetailStore,
} from "./sessionDetail/sessionDetailStore";

export interface GetSessionInput {
  projectId: string;
  sessionId: string;
  afterMessageId?: string;
  tailCompactions?: number;
  beforeMessageId?: string;
  tailTurns?: number;
  tailFrom?: string;
}

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

export type SessionDetailMemoryCache = SessionDetailStore;

export interface SessionDetailRuntime {
  cache: SessionDetailMemoryCache;
}

export interface YaSourceRuntime {
  sourceKey: ClientSummarySourceKey;
  api: SourceApiClient;
  sessionDetails: SessionDetailRuntime;
}

const currentSourceApiClient: SourceApiClient = {
  getSession: ({
    projectId,
    sessionId,
    afterMessageId,
    tailCompactions,
    beforeMessageId,
    tailTurns,
    tailFrom,
  }) => {
    let options:
      | {
          tailCompactions?: number;
          beforeMessageId?: string;
          tailTurns?: number;
          tailFrom?: string;
        }
      | undefined;
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
  cache: defaultSessionDetailStore,
};

const currentSourceRuntimes = new Map<ClientSummarySourceKey, YaSourceRuntime>();

export function getOrCreateCurrentSourceRuntime(
  sourceKey: ClientSummarySourceKey,
): YaSourceRuntime {
  let runtime = currentSourceRuntimes.get(sourceKey);
  if (!runtime) {
    runtime = {
      sourceKey,
      api: currentSourceApiClient,
      sessionDetails: currentSessionDetailRuntime,
    };
    currentSourceRuntimes.set(sourceKey, runtime);
  }
  return runtime;
}
