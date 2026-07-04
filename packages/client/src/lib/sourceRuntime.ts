import { api } from "../api/client";
import type { ClientSummarySourceKey } from "./clientSummaryStore";
import {
  defaultSessionDetailStore,
  type SessionDetailStore,
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
  cache: SessionDetailStore;
}

export interface YaSourceRuntime {
  sourceKey: ClientSummarySourceKey;
  api: SourceApiClient;
  sessionDetails: SessionDetailRuntime;
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
