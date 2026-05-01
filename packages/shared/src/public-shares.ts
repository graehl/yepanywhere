import type { AppSession } from "./app-types.js";
import type { UrlProjectId } from "./projectId.js";
import type { ProviderName } from "./types.js";

export type PublicSessionShareMode = "frozen" | "live";

export interface CreatePublicSessionShareRequest {
  projectId: UrlProjectId;
  sessionId: string;
  mode: PublicSessionShareMode;
  title?: string;
}

export interface CreatePublicSessionShareResponse {
  url: string;
  mode: PublicSessionShareMode;
  createdAt: string;
  secretBits: number;
}

export interface PublicSessionShareSessionStatusResponse {
  activeCount: number;
  frozenCount: number;
  liveCount: number;
}

export interface RevokePublicSessionSharesResponse
  extends PublicSessionShareSessionStatusResponse {
  revokedCount: number;
}

export interface PublicSessionShareMetadata {
  mode: PublicSessionShareMode;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt?: string;
  source: {
    projectId: UrlProjectId;
    sessionId: string;
    projectName?: string;
    provider?: ProviderName;
  };
}

export interface PublicSessionShareResponse {
  share: PublicSessionShareMetadata;
  session: AppSession;
}
