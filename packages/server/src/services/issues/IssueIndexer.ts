import { setImmediate as yieldTurn } from "node:timers/promises";
import type { SessionCatalogRow } from "../../sessions/catalog-types.js";
import type {
  IssueReadOptions,
  IssueTextBatch,
} from "../../sessions/issue-text-reader.js";
import type { Message } from "../../supervisor/types.js";
import { issueMessageText } from "../../sessions/normalization.js";
import type { IssueStore, IssueSource } from "./IssueStore.js";

import type { IssueSettings } from "@yep-anywhere/shared";
export type { IssueSettings } from "@yep-anywhere/shared";
export const DEFAULT_ISSUE_SETTINGS: IssueSettings = {
  enabled: false,
  scope: "viewed",
  recentDays: 7,
};
/** Identifies one published catalog generation, so a sweep can skip a repeat. */
export interface CatalogMark {
  catalogEpoch: string;
  catalogGeneration: number;
}

export interface IssueIndexerDeps {
  settings: () => IssueSettings;
  candidates: () => AsyncIterable<Readonly<SessionCatalogRow>>;
  read: (
    row: SessionCatalogRow,
    options: IssueReadOptions,
  ) => Promise<IssueTextBatch | null>;
  viewed?: (sessionId: string) => boolean;
  projectForSession?: (sessionId: string) => string | undefined;
  /** Called after captures land, so freshly seen references can be asked about. */
  confirm?: () => void;
}

/** One fair worker and durable queue, independent of client count or corpus size. */
export class IssueIndexer {
  private controller = new AbortController();
  private work?: Promise<void>;
  private enumeration?: Promise<void>;
  private refreshPending = false;
  /** Catalog mark the last completed sweep covered. */
  private sweptMark?: string;
  /** What a sweep queued behind the running one should cover. */
  private pendingCatalog?: CatalogMark;
  private pendingForced = false;
  private closed = false;
  private viewTasks = new Set<Promise<void>>();
  private viewBytes = 0;
  constructor(
    readonly store: IssueStore,
    private readonly deps: IssueIndexerDeps,
  ) {
    store.run(
      "UPDATE issue_index_jobs SET state='queued' WHERE state='indexing'",
    );
  }
  settings(): IssueSettings {
    return this.deps.settings();
  }
  configure(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.lastError = null;
    this.store.reconcileJira();
    // Settings decide what a sweep admits, so a change invalidates the mark.
    this.sweptMark = undefined;
    this.store.run(
      "UPDATE issue_index_jobs SET state='queued' WHERE state='indexing'",
    );
    if (!this.settings().enabled || this.closed) return;
    this.refresh();
  }
  /**
   * Sweep the catalog. Pass the publication's catalog mark to make it a no-op
   * when nothing has changed since the last completed sweep: the catalog
   * republishes every few seconds on an active server, and re-walking an
   * identical corpus to reach the same conclusions is the cost this avoids.
   * Callers with their own reason to sweep — a settings change, a remap — pass
   * nothing and always run.
   */
  refresh(catalog?: CatalogMark): void {
    if (this.closed || !this.settings().enabled) return;
    const mark = catalog
      ? `${catalog.catalogEpoch}:${catalog.catalogGeneration}`
      : undefined;
    if (mark !== undefined && mark === this.sweptMark) return;
    if (this.enumeration) {
      this.refreshPending = true;
      // A caller with its own reason to sweep stays forced; a marked caller
      // only supplies the mark the rerun should claim.
      if (catalog) this.pendingCatalog = catalog;
      else this.pendingForced = true;
      return;
    }
    this.refreshPending = false;
    const running = mark;
    const signal = this.controller.signal;
    this.enumeration = (async () => {
      const cutoff = Date.now() - this.settings().recentDays * 86400_000;
      // Every catalog publication re-enumerates the whole corpus, so an
      // unconditional ownership write here is one write transaction per known
      // session per publication — thousands of file locks a minute on an idle
      // server, none of which can change a row. Only a session that already
      // has a row can move, and a row created later during this sweep carries
      // its own project, so one read up front replaces all of them.
      const owned = this.store.ownedSessions();
      let count = 0;
      for await (const row of this.deps.candidates()) {
        if (signal.aborted) return;
        // Current project ownership updates independently of scan eligibility.
        if (owned.has(row.sessionId))
          this.store.updateProject(
            row.sessionId,
            this.deps.projectForSession?.(row.sessionId) ?? row.projectId,
          );
        if (
          (this.settings().scope === "recent" &&
            Date.parse(row.updatedAt) >= cutoff) ||
          this.deps.viewed?.(row.sessionId)
        ) {
          this.enqueue(row, this.deps.viewed?.(row.sessionId) ? 1 : 0);
        }
        if (++count % 100 === 0) await yieldTurn();
      }
    })()
      .then(() => {
        // Only a sweep that ran to completion may retire its mark.
        if (!signal.aborted && running !== undefined) this.sweptMark = running;
      })
      .catch(() => {
        if (!signal.aborted) this.lastError = "Catalog unavailable";
      })
      .finally(() => {
        this.enumeration = undefined;
        const pending = this.pendingForced ? undefined : this.pendingCatalog;
        this.pendingCatalog = undefined;
        this.pendingForced = false;
        if (
          (signal !== this.controller.signal || this.refreshPending) &&
          this.settings().enabled
        )
          this.refresh(pending);
        this.kick();
      });
  }
  private lastError: string | null = null;
  private enqueue(row: Readonly<SessionCatalogRow>, priority: number): void {
    this.store.run(
      `INSERT INTO issue_index_jobs(session_id,project_id,source_version,cursor,state,updated_at,source_json,priority)
      VALUES (?,?,?,NULL,'queued',?,?,?) ON CONFLICT(session_id) DO UPDATE SET
      state=CASE WHEN issue_index_jobs.source_version!=excluded.source_version OR issue_index_jobs.state='paused' THEN 'queued' ELSE issue_index_jobs.state END,
      project_id=excluded.project_id,source_json=excluded.source_json,source_version=excluded.source_version,priority=excluded.priority`,
      row.sessionId,
      this.deps.projectForSession?.(row.sessionId) ?? row.projectId,
      row.sourceVersion,
      Date.now(),
      JSON.stringify(row),
      priority,
    );
  }
  /** Only already-authorized persisted windows enter here; public shares never call it. */
  observe(source: IssueSource, messages: readonly Message[]): void {
    if (this.closed || !this.settings().enabled) return;
    const signal = this.controller.signal;
    if (this.viewTasks.size >= 16) {
      // Do not allocate another pending task merely to report saturation.
      try {
        this.store.run(
          `INSERT INTO issue_index_jobs(session_id,project_id,source_version,state,error,updated_at,source_json,priority) VALUES (?,?,'','partial','Viewed window queue full',?,'null',1)
           ON CONFLICT(session_id) DO UPDATE SET state=CASE WHEN issue_index_jobs.state='viewed' THEN 'partial' ELSE issue_index_jobs.state END`,
          source.sessionId,
          source.projectId,
          Date.now(),
        );
      } catch {
        this.lastError = "Evidence could not be saved";
      }
      return;
    }
    // Bound retained references even when many tabs return large detail windows.
    const selected: import("./extract.js").IssueText[] = [];
    let bytes = 0;
    let partial = false;
    let records = 0;
    for (const message of messages) {
      if (++records > 16_000) {
        partial = true;
        break;
      }
      const text = issueMessageText(message);
      if (!text) continue;
      const size = text.text.length * 2 + 512;
      if (bytes + size + this.viewBytes > 8 * 1024 * 1024) {
        partial = true;
        continue;
      }
      selected.push(text);
      bytes += size;
    }
    this.viewBytes += bytes;
    const task = (async () => {
      await yieldTurn();
      for (const text of selected) {
        if (signal.aborted) return;
        if (text) {
          // Overlap catches references crossing chunk boundaries. Retain source offsets.
          for (let offset = 0; offset < text.text.length; offset += 32 * 1024) {
            if (signal.aborted) return;
            this.store.capture(
              source,
              {
                ...text,
                text: text.text.slice(
                  Math.max(0, offset - 4096),
                  offset + 32 * 1024 + 4096,
                ),
              },
              Math.max(0, offset - 4096),
              offset,
              offset + 32 * 1024,
            );
            await yieldTurn();
          }
        }
      }
      if (!signal.aborted)
        this.store.run(
          `INSERT INTO issue_index_jobs(session_id,project_id,source_version,state,error,updated_at,source_json,priority) VALUES (?,?,'',?,?,?,'null',1)
        ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id,state=CASE WHEN excluded.state='partial' AND issue_index_jobs.state='viewed' THEN 'partial' ELSE issue_index_jobs.state END,error=COALESCE(excluded.error,issue_index_jobs.error)`,
          source.sessionId,
          source.projectId,
          partial ? "partial" : "viewed",
          partial ? "Viewed window exceeded acquisition budget" : null,
          Date.now(),
        );
    })()
      .catch(() => {
        if (!signal.aborted) this.lastError = "Evidence could not be saved";
      })
      .finally(() => {
        this.viewBytes -= bytes;
        this.viewTasks.delete(task);
        this.deps.confirm?.();
        this.kick();
      });
    this.viewTasks.add(task);
  }
  /** Continue durable resolution after a synchronous operator correction. */
  resumePendingWork(): void {
    this.kick();
  }
  private kick(): void {
    if (this.closed || this.work || !this.settings().enabled) return;
    const signal = this.controller.signal;
    this.work = this.drain()
      .catch(() => {
        this.lastError = "Index storage unavailable";
      })
      .finally(() => {
        this.work = undefined;
        if (signal !== this.controller.signal) this.kick();
      });
  }
  private async drain(): Promise<void> {
    const signal = this.controller.signal;
    while (!signal.aborted && !this.closed) {
      const resolved = this.store.processResolutions();
      const jobs = this.store.rows(
        "SELECT * FROM issue_index_jobs WHERE state='queued' ORDER BY priority DESC,updated_at,session_id LIMIT 16",
      );
      if (!jobs.length) {
        if (resolved) {
          await yieldTurn();
          continue;
        }
        return;
      }
      let processed = false;
      for (const job of jobs) {
        if (signal.aborted) return;
        const row: SessionCatalogRow | null = JSON.parse(
          String(job.source_json),
        );
        if (!row) {
          this.store.run(
            "UPDATE issue_index_jobs SET state='viewed' WHERE session_id=?",
            job.session_id!,
          );
          continue;
        }
        const recent =
          this.settings().scope === "recent" &&
          Date.parse(row.updatedAt) >=
            Date.now() - this.settings().recentDays * 86400_000;
        if (!recent && !this.deps.viewed?.(row.sessionId)) {
          this.store.run(
            "UPDATE issue_index_jobs SET state='paused' WHERE session_id=?",
            row.sessionId,
          );
          processed = true;
          continue;
        }
        processed = true;
        this.store.run(
          "UPDATE issue_index_jobs SET state='indexing' WHERE session_id=?",
          row.sessionId,
        );
        try {
          const batch = await this.deps.read(row, {
            cursor: typeof job.cursor === "string" ? job.cursor : undefined,
            signal,
          });
          if (signal.aborted) return;
          if (!batch) {
            this.store.run(
              "UPDATE issue_index_jobs SET state='unsupported',error='Background acquisition unavailable' WHERE session_id=?",
              row.sessionId,
            );
            continue;
          }
          for (const message of batch.messages) {
            if (signal.aborted) return;
            for (
              let offset = 0;
              offset < message.text.length;
              offset += 32 * 1024
            ) {
              this.store.capture(
                {
                  sessionId: row.sessionId,
                  projectId:
                    this.deps.projectForSession?.(row.sessionId) ??
                    row.projectId,
                  sourceVersion: String(job.source_version),
                },
                {
                  ...message,
                  text: message.text.slice(
                    Math.max(0, offset - 4096),
                    offset + 32 * 1024 + 4096,
                  ),
                },
                Math.max(0, offset - 4096),
                offset,
                offset + 32 * 1024,
              );
              await yieldTurn();
              if (signal.aborted) return;
            }
          }
          this.store.run(
            "UPDATE issue_index_jobs SET cursor=?,state=?,error=?,updated_at=? WHERE session_id=? AND source_version=?",
            batch.cursor,
            batch.done ? (batch.partial ? "partial" : "indexed") : "queued",
            batch.partial ? "Some source records could not be indexed" : null,
            Date.now(),
            row.sessionId,
            job.source_version!,
          );
        } catch {
          if (!signal.aborted)
            this.store.run(
              "UPDATE issue_index_jobs SET state='failed',error='Session source unavailable or changed',updated_at=? WHERE session_id=? AND source_version=?",
              Date.now(),
              row.sessionId,
              job.source_version!,
            );
        }
        await yieldTurn();
      }
      this.deps.confirm?.();
      if (!processed) return;
    }
  }
  coverage() {
    return {
      settings: this.settings(),
      knownJiraProjects: this.store.knownJiraProjects(),
      active: Boolean(this.work || this.enumeration || this.viewTasks.size),
      error: this.lastError,
      counts: this.store
        .rows(
          "SELECT state,COUNT(*) AS count FROM issue_index_jobs GROUP BY state",
        )
        .map((row) => ({ state: String(row.state), count: Number(row.count) })),
    };
  }
  /** Fence buffered observations before a user delete; old completed checkpoints stay put. */
  delete(id: string): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.store.delete(id);
    this.store.run(
      "UPDATE issue_index_jobs SET state='queued' WHERE state='indexing'",
    );
    this.kick();
  }
  remap(oldId: string, newId: string): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.store.remap(oldId, newId);
    this.store.run(
      "UPDATE issue_index_jobs SET state='queued' WHERE state='indexing'",
    );
    this.refresh();
  }
  async settled(): Promise<void> {
    while (this.enumeration || this.work || this.viewTasks.size) {
      await this.enumeration;
      await this.work;
      await Promise.all(this.viewTasks);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    await this.settled();
  }
}
