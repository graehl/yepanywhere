/**
 * Session index service interface for provider-agnostic session caching.
 *
 * Each provider may have different file formats and directory structures,
 * but all index services implement this interface to provide consistent caching.
 */

import type { UrlProjectId } from "@yep-anywhere/shared";
import type { ISessionReader } from "../sessions/types.js";
import type { SessionSummary } from "../supervisor/types.js";

export interface SessionIndexListOptions {
  /** Hide sessions whose cached updatedAt is older than this epoch-ms cutoff. */
  activeAfterMs?: number;
}

/**
 * Common interface for session index services across providers.
 *
 * Index services cache session summaries to avoid re-parsing files on every request.
 * They use file mtime/size for cache invalidation.
 */
export interface ISessionIndexService {
  /**
   * Initialize the service (create directories, load state, etc.).
   */
  initialize(): Promise<void>;

  /**
   * Get sessions using the cache, only re-parsing files that have changed.
   * This is the main entry point for listing sessions with caching.
   *
   * @param sessionDir - Directory containing session files
   * @param projectId - The project ID
   * @param reader - Session reader for parsing files on cache miss
   */
  getSessionsWithCache(
    sessionDir: string,
    projectId: UrlProjectId,
    reader: ISessionReader,
    options?: SessionIndexListOptions,
  ): Promise<SessionSummary[]>;

  /**
   * Get one session summary using the cache when possible.
   *
   * This is the preferred server-side primitive for display metadata about a
   * known session id. It avoids the easy-to-miss direct reader path while still
   * falling back to the provider reader on a cache miss or changed file.
   *
   * @param sessionDir - Directory containing session files
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @param reader - Session reader for parsing files on cache miss
   */
  getSessionSummaryWithCache(
    sessionDir: string,
    projectId: UrlProjectId,
    sessionId: string,
    reader: ISessionReader,
  ): Promise<SessionSummary | null>;

  /**
   * Get one session summary only when a fresh cached row already exists.
   *
   * This validates the cached file mtime/size but must not call the provider
   * reader to parse on miss. It is intended for lightweight display paths that
   * can fall back to a head read instead of triggering full summary parsing.
   *
   * @param sessionDir - Directory containing session files
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @param reader - Session reader for provider-specific file path/index scope
   */
  getCachedSessionSummary(
    sessionDir: string,
    projectId: UrlProjectId,
    sessionId: string,
    reader: ISessionReader,
  ): Promise<SessionSummary | null>;

  /**
   * Get just the title for a single session, using cache when possible.
   * More efficient than getSessionsWithCache when you only need one session.
   *
   * @param sessionDir - Directory containing session files
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @param reader - Session reader for parsing files on cache miss
   */
  getSessionTitle(
    sessionDir: string,
    projectId: UrlProjectId,
    sessionId: string,
    reader: ISessionReader,
  ): Promise<string | null>;

  /**
   * Invalidate the cache for a specific session.
   * Call this when you know a session file has been modified.
   *
   * @param sessionDir - Directory containing session files
   * @param sessionId - The session ID to invalidate
   */
  invalidateSession(sessionDir: string, sessionId: string): void;

  /**
   * Clear all cached data for a session directory.
   *
   * @param sessionDir - Directory to clear cache for
   */
  clearCache(sessionDir: string): void;
}
