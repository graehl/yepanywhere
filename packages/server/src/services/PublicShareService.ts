import type {
  AppSession,
  PublicSessionShareMetadata,
  PublicSessionShareMode,
  PublicSessionShareResponse,
  PublicSessionShareSessionStatusResponse,
  RevokePublicSessionSharesResponse,
  UrlProjectId,
} from "@yep-anywhere/shared";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { enforceOwnerReadWriteFilePermissions } from "../utils/filePermissions.js";

export const PUBLIC_SHARE_SECRET_BYTES = 64;
export const PUBLIC_SHARE_SECRET_BITS = PUBLIC_SHARE_SECRET_BYTES * 8;

export interface PublicShareRecord {
  version: 1;
  secretHash: string;
  mode: PublicSessionShareMode;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt?: string;
  source: {
    projectId: UrlProjectId;
    sessionId: string;
    provider?: AppSession["provider"];
  };
  frozenSession?: AppSession;
}

interface PublicShareState {
  shares: PublicShareRecord[];
}

export interface PublicShareServiceOptions {
  dataDir: string;
}

export interface CreatePublicShareOptions {
  mode: PublicSessionShareMode;
  source: PublicShareRecord["source"];
  title?: string | null;
  snapshot?: AppSession;
}

const EMPTY_STATE: PublicShareState = { shares: [] };

function hashSecret(secret: string): string {
  return createHash("sha512").update(secret, "utf8").digest("base64url");
}

function isValidSecret(secret: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    return false;
  }
  try {
    return Buffer.from(secret, "base64url").length >= PUBLIC_SHARE_SECRET_BYTES;
  } catch {
    return false;
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function sanitizeSessionForPublicShare(session: AppSession): AppSession {
  const {
    pendingInputType: _pendingInputType,
    activity: _activity,
    lastSeenAt: _lastSeenAt,
    hasUnread: _hasUnread,
    heartbeatTurnsEnabled: _heartbeatTurnsEnabled,
    heartbeatTurnsAfterMinutes: _heartbeatTurnsAfterMinutes,
    heartbeatTurnText: _heartbeatTurnText,
    ...rest
  } = session as AppSession & {
    heartbeatTurnsEnabled?: boolean;
    heartbeatTurnsAfterMinutes?: number;
    heartbeatTurnText?: string;
  };

  return {
    ...rest,
    ownership: { owner: "none" },
    messages: session.messages,
  };
}

function toPublicResponse(record: PublicShareRecord): PublicSessionShareResponse {
  if (!record.frozenSession) {
    throw new Error("Frozen share is missing its captured session");
  }

  const share: PublicSessionShareMetadata = {
    mode: record.mode,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    capturedAt: record.capturedAt,
    source: record.source,
  };

  return {
    share,
    session: record.frozenSession,
  };
}

function matchesSession(
  record: PublicShareRecord,
  projectId: UrlProjectId,
  sessionId: string,
): boolean {
  return (
    record.source.projectId === projectId && record.source.sessionId === sessionId
  );
}

function summarizeRecords(
  records: PublicShareRecord[],
): PublicSessionShareSessionStatusResponse {
  let frozenCount = 0;
  let liveCount = 0;
  for (const record of records) {
    if (record.mode === "frozen") {
      frozenCount += 1;
    } else {
      liveCount += 1;
    }
  }
  return {
    activeCount: frozenCount + liveCount,
    frozenCount,
    liveCount,
  };
}

export class PublicShareService {
  private state: PublicShareState = EMPTY_STATE;
  private readonly filePath: string;

  constructor(options: PublicShareServiceOptions) {
    this.filePath = path.join(options.dataDir, "public-shares.json");
  }

  async initialize(): Promise<void> {
    try {
      await enforceOwnerReadWriteFilePermissions(
        this.filePath,
        "[public-shares]",
      );
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (this.validateState(parsed)) {
        this.state = parsed;
        console.log(
          `[public-shares] Loaded ${this.state.shares.length} share(s)`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      console.warn("[public-shares] Failed to load state:", error);
    }
  }

  async createShare(options: CreatePublicShareOptions): Promise<{
    secret: string;
    secretBits: number;
    record: PublicShareRecord;
  }> {
    if (options.mode === "frozen" && !options.snapshot) {
      throw new Error("Frozen shares require a session snapshot");
    }

    const secret = randomBytes(PUBLIC_SHARE_SECRET_BYTES).toString("base64url");
    const secretHash = hashSecret(secret);
    const now = new Date().toISOString();
    const record: PublicShareRecord = {
      version: 1,
      secretHash,
      mode: options.mode,
      title: options.title ?? null,
      createdAt: now,
      updatedAt: now,
      ...(options.mode === "frozen" ? { capturedAt: now } : {}),
      source: options.source,
      ...(options.snapshot
        ? { frozenSession: sanitizeSessionForPublicShare(options.snapshot) }
        : {}),
    };

    this.state = {
      shares: [...this.state.shares, record],
    };
    await this.save();

    return {
      secret,
      secretBits: PUBLIC_SHARE_SECRET_BITS,
      record,
    };
  }

  getFrozenShareBySecret(secret: string): PublicSessionShareResponse | null {
    const record = this.getRecordBySecret(secret);
    if (!record || record.mode !== "frozen") {
      return null;
    }
    return toPublicResponse(record);
  }

  getRecordBySecret(secret: string): PublicShareRecord | null {
    if (!isValidSecret(secret)) {
      return null;
    }
    const secretHash = hashSecret(secret);
    for (const record of this.state.shares) {
      if (timingSafeStringEqual(record.secretHash, secretHash)) {
        return record;
      }
    }
    return null;
  }

  getSessionShareStatus(
    projectId: UrlProjectId,
    sessionId: string,
  ): PublicSessionShareSessionStatusResponse {
    return summarizeRecords(
      this.state.shares.filter((record) =>
        matchesSession(record, projectId, sessionId),
      ),
    );
  }

  async revokeSessionShares(
    projectId: UrlProjectId,
    sessionId: string,
  ): Promise<RevokePublicSessionSharesResponse> {
    const remaining = this.state.shares.filter(
      (record) => !matchesSession(record, projectId, sessionId),
    );
    const revokedCount = this.state.shares.length - remaining.length;
    if (revokedCount > 0) {
      this.state = { shares: remaining };
      await this.save();
    }
    return {
      revokedCount,
      ...this.getSessionShareStatus(projectId, sessionId),
    };
  }

  buildLiveResponse(
    record: PublicShareRecord,
    session: AppSession,
  ): PublicSessionShareResponse {
    const sanitizedSession = sanitizeSessionForPublicShare(session);
    return {
      share: {
        mode: record.mode,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: sanitizedSession.updatedAt,
        capturedAt: record.capturedAt,
        source: {
          ...record.source,
          provider: sanitizedSession.provider,
        },
      },
      session: sanitizedSession,
    };
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), {
      mode: 0o600,
    });
    await enforceOwnerReadWriteFilePermissions(
      this.filePath,
      "[public-shares]",
    );
  }

  private validateState(value: unknown): value is PublicShareState {
    if (!value || typeof value !== "object") {
      return false;
    }
    const shares = (value as { shares?: unknown }).shares;
    if (!Array.isArray(shares)) {
      return false;
    }
    return shares.every((share) => {
      if (!share || typeof share !== "object") return false;
      const record = share as Partial<PublicShareRecord>;
      return (
        record.version === 1 &&
        typeof record.secretHash === "string" &&
        (record.mode === "frozen" || record.mode === "live") &&
        typeof record.createdAt === "string" &&
        typeof record.updatedAt === "string" &&
        !!record.source &&
        typeof record.source.projectId === "string" &&
        typeof record.source.sessionId === "string" &&
        (record.mode === "live" || !!record.frozenSession)
      );
    });
  }
}
