/**
 * RecentsService manages the list of recently visited sessions.
 * Stores a bounded list of session visits, oldest entries are pruned.
 *
 * State is persisted to a JSON file for durability across server restarts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createCoalescingSaver } from "../lib/coalescingSaver.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";

export interface RecentEntry {
  /** Session ID */
  sessionId: string;
  /** Project ID (base64url encoded path) */
  projectId: string;
  /** ISO timestamp of visit */
  visitedAt: string;
}

export interface RecentsState {
  /** List of recent visits, most recent first */
  visits: RecentEntry[];
  /** Schema version for future migrations */
  version: number;
}

const CURRENT_VERSION = 1;
const MAX_ENTRIES = 100;
/** Remaps remembered for visits that arrive late; one per new session. */
const MAX_REMAPPED_IDS = 200;

export interface RecentsServiceOptions {
  /** Directory to store recents state (defaults to ~/.yep-anywhere) */
  dataDir?: string;
  /** Maximum number of entries to keep (defaults to 100) */
  maxEntries?: number;
  /** Notify readers after a coalesced durable change, without polling. */
  onChanged?: () => void;
}

export class RecentsService {
  private state: RecentsState;
  private dataDir: string;
  private filePath: string;
  private maxEntries: number;
  private onChanged: (() => void) | undefined;
  private save = createCoalescingSaver(() => this.doSave()).save;
  /** Provisional id to real id, oldest first. */
  private remappedIds = new Map<string, string>();

  constructor(options: RecentsServiceOptions = {}) {
    this.dataDir =
      options.dataDir ??
      path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? ".",
        ".yep-anywhere",
      );
    this.filePath = path.join(this.dataDir, "recents.json");
    this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
    this.onChanged = options.onChanged;
    this.state = { visits: [], version: CURRENT_VERSION };
  }

  /**
   * Initialize the service by loading state from disk.
   * Creates the data directory and file if they don't exist.
   */
  async initialize(): Promise<void> {
    console.log(`[RecentsService] Initializing from: ${this.filePath}`);
    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // Try to load existing state
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as RecentsState;
      console.log(
        `[RecentsService] Loaded ${parsed.visits.length} recent entries from disk`,
      );

      // Validate and migrate if needed
      if (parsed.version === CURRENT_VERSION) {
        this.state = parsed;
      } else {
        // Future: handle migrations here
        this.state = {
          visits: parsed.visits ?? [],
          version: CURRENT_VERSION,
        };
        await this.save();
      }
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          "[RecentsService] Failed to load state, starting fresh:",
          error,
        );
      }
      this.state = { visits: [], version: CURRENT_VERSION };
    }
  }

  /**
   * Record a session visit.
   * Moves existing entry to front or adds new entry, then prunes oldest.
   */
  async recordVisit(visitedId: string, projectId: string): Promise<void> {
    // A visit to a provisional id can arrive after the remap that retired it.
    const sessionId = this.remappedIds.get(visitedId) ?? visitedId;
    // Remove existing entry if present
    const filtered = this.state.visits.filter((e) => e.sessionId !== sessionId);

    // Add to front with current timestamp
    const entry: RecentEntry = {
      sessionId,
      projectId,
      visitedAt: new Date().toISOString(),
    };

    // Prune to max entries
    this.state.visits = [entry, ...filtered].slice(0, this.maxEntries);

    await this.save();
  }

  /**
   * Get all recent entries, most recent first.
   */
  getRecents(): RecentEntry[] {
    return [...this.state.visits];
  }

  /**
   * Get recent entries with limit.
   */
  getRecentsWithLimit(limit: number): RecentEntry[] {
    return this.state.visits.slice(0, limit);
  }

  /**
   * Replace a provisional session id with the real one the provider reported.
   * The provisional id never names a transcript, so an entry left under it
   * could never be resolved, and every listing would pay for searching all
   * providers for it.
   */
  async remapSession(
    oldSessionId: string,
    newSessionId: string,
  ): Promise<void> {
    this.remappedIds.set(oldSessionId, newSessionId);
    if (this.remappedIds.size > MAX_REMAPPED_IDS) {
      const oldest = this.remappedIds.keys().next().value;
      if (oldest !== undefined) this.remappedIds.delete(oldest);
    }
    const index = this.state.visits.findIndex(
      (e) => e.sessionId === oldSessionId,
    );
    if (index === -1) return;
    const hasNew = this.state.visits.some((e) => e.sessionId === newSessionId);
    this.state.visits = hasNew
      ? this.state.visits.filter((_, i) => i !== index)
      : this.state.visits.map((e, i) =>
          i === index ? { ...e, sessionId: newSessionId } : e,
        );
    await this.save();
  }

  /**
   * Drop entries a listing could not resolve to any session, leaving visits
   * newer than `minAgeMs` whose transcripts may not be written yet.
   */
  async pruneUnresolved(sessionIds: readonly string[], minAgeMs: number) {
    const unresolved = new Set(sessionIds);
    const cutoff = Date.now() - minAgeMs;
    const before = this.state.visits.length;
    this.state.visits = this.state.visits.filter(
      (e) => !unresolved.has(e.sessionId) || Date.parse(e.visitedAt) > cutoff,
    );
    if (this.state.visits.length !== before) {
      await this.save();
    }
  }

  /**
   * Remove a specific session from recents.
   * Useful when a session is deleted.
   */
  async removeSession(sessionId: string): Promise<void> {
    const before = this.state.visits.length;
    this.state.visits = this.state.visits.filter(
      (e) => e.sessionId !== sessionId,
    );

    if (this.state.visits.length !== before) {
      await this.save();
    }
  }

  /**
   * Remove all sessions for a project.
   * Useful when a project is removed.
   */
  async removeProject(projectId: string): Promise<void> {
    const before = this.state.visits.length;
    this.state.visits = this.state.visits.filter(
      (e) => e.projectId !== projectId,
    );

    if (this.state.visits.length !== before) {
      await this.save();
    }
  }

  /**
   * Clear all recents.
   */
  async clear(): Promise<void> {
    if (this.state.visits.length > 0) {
      this.state.visits = [];
      await this.save();
    }
  }

  private async doSave(): Promise<void> {
    try {
      const content = JSON.stringify(this.state, null, 2);
      await writeFileAtomically(this.filePath, content);
      this.onChanged?.();
    } catch (error) {
      console.error("[RecentsService] Failed to save state:", error);
      throw error;
    }
  }

  /**
   * Get the file path for testing purposes.
   */
  getFilePath(): string {
    return this.filePath;
  }
}
