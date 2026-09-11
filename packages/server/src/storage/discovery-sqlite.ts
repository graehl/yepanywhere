import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SqliteStatus } from "@yep-anywhere/shared";
import { networkFilesystemName } from "../lib/filesystemKind.js";
import {
  SPEECH_VOCABULARY_SCHEMA,
  SPEECH_VOCABULARY_SET_SCHEMA,
} from "./migrations/002-003-vocabulary.js";
import {
  loadSqliteDriver,
  type SqliteDatabase,
  type SqliteDriver,
} from "./sqlite.js";

import { ISSUE_RESOLUTION_SCHEMA } from "./migrations/005-issue-resolution.js";
import { ISSUE_SCHEMA } from "./migrations/004-issues.js";
import { ISSUE_CONFIRMATION_SCHEMA } from "./migrations/006-issue-confirmation.js";

import { JIRA_PROJECT_SCHEMA } from "./migrations/007-jira-projects.js";

export type SqliteMode = "off" | "auto" | "on";

export function parseSqliteMode(value: string | undefined): SqliteMode {
  if (value === undefined || value === "auto") return "auto";
  if (value === "off" || value === "on") return value;
  throw new Error("YEP_SQLITE must be one of: off, auto, on");
}

export interface DiscoveryMigration {
  version: number;
  sql: string;
}

// YA discovery file identity (ASCII YADI). Version 1 reserves the format;
// domain tables belong to the feature migrations that introduce their use.
const APPLICATION_ID = 0x59414449;
export const DISCOVERY_MIGRATIONS: readonly DiscoveryMigration[] = [
  { version: 1, sql: "" },
  { version: 2, sql: SPEECH_VOCABULARY_SCHEMA },
  { version: 3, sql: SPEECH_VOCABULARY_SET_SCHEMA },
  { version: 4, sql: ISSUE_SCHEMA },
  { version: 5, sql: ISSUE_RESOLUTION_SCHEMA },
  { version: 6, sql: ISSUE_CONFIRMATION_SCHEMA },
  { version: 7, sql: JIRA_PROJECT_SCHEMA },
];

/** Construct fixtures with the actual historical schema, never a parallel SQL copy. */
export function discoveryMigrationPrefix(
  version: number,
): readonly DiscoveryMigration[] {
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    version > DISCOVERY_MIGRATIONS.length
  ) {
    throw new Error("Invalid discovery migration prefix");
  }
  return DISCOVERY_MIGRATIONS.slice(0, version);
}

function readRow(database: SqliteDatabase, sql: string) {
  const statement = database.prepare(sql);
  try {
    return statement.get();
  } finally {
    statement.finalize();
  }
}

export function migrateDiscoveryDatabase(
  database: SqliteDatabase,
  migrations: readonly DiscoveryMigration[] = DISCOVERY_MIGRATIONS,
): void {
  if (
    migrations.length === 0 ||
    migrations.some((migration, index) => migration.version !== index + 1)
  ) {
    throw new Error("Discovery migrations must be consecutive from version 1");
  }
  database.transaction(() => {
    const applicationId = readRow(
      database,
      "PRAGMA application_id",
    )?.application_id;
    const version = readRow(database, "PRAGMA user_version")?.user_version;
    if (
      typeof version !== "number" ||
      version < 0 ||
      version > migrations.length
    ) {
      throw new Error("Discovery database has a newer or invalid schema");
    }
    if (applicationId !== APPLICATION_ID) {
      const table = readRow(database, "SELECT name FROM sqlite_schema LIMIT 1");
      if (applicationId !== 0 || version !== 0 || table) {
        throw new Error("Database is not a YA discovery database");
      }
    }
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      if (migration.sql) database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
    }
    database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
  });
}

/** One optional connection per Hono generation, owned below the YA data dir. */
export class DiscoverySqliteService {
  private database: SqliteDatabase | undefined;
  private state: SqliteStatus["state"] = "disabled";
  private networkFilesystem: string | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;

  constructor(options: {
    dataDir: string;
    mode: SqliteMode;
    loadDriver?: () => SqliteDriver | undefined;
    onError?: (error: unknown) => void;
    /** Injected by tests; production probes the real data directory. */
    probeNetworkFilesystem?: (dir: string) => string | undefined;
  }) {
    this.onError = options.onError;
    if (options.mode === "off") return;
    try {
      const driver = (options.loadDriver ?? loadSqliteDriver)();
      if (!driver) {
        this.state = "unsupported";
        return;
      }
      mkdirSync(options.dataDir, { recursive: true });
      // Both adapters are synchronous and SQLite takes an advisory lock per
      // transaction, so on a share every one of those locks is a network round
      // trip taken on the event loop. A busy server spends most of each second
      // in uninterruptible sleep and stops answering requests at all. Losing
      // the features this database backs is a far smaller harm, so refuse
      // rather than open. `on` is the escape for a share fast enough to take it.
      const network =
        options.mode === "on"
          ? undefined
          : (options.probeNetworkFilesystem ?? networkFilesystemName)(
              options.dataDir,
            );
      if (network) {
        this.state = "error";
        this.networkFilesystem = network;
        options.onError?.(
          new Error(
            `Refusing to open ${join(options.dataDir, "discovery.sqlite")}: the data directory is on ${network}, where every SQLite lock is a network round trip that stalls the server. Set YEP_DATA_DIR to a directory on local disk, or YEP_SQLITE=on to open it anyway.`,
          ),
        );
        return;
      }
      this.database = driver.open(join(options.dataDir, "discovery.sqlite"));
      // A short, bounded wait also applies while obtaining the migration lock.
      this.database.exec("PRAGMA busy_timeout = 250");
      this.database.exec("PRAGMA foreign_keys = ON");
      migrateDiscoveryDatabase(this.database);
      this.state = "ready";
    } catch (error) {
      this.state = "error";
      try {
        this.database?.close();
      } catch {
        // Preserve the initialization error; optional teardown must not abort boot.
      } finally {
        this.database = undefined;
        options.onError?.(error);
      }
    }
  }

  getStatus(): SqliteStatus {
    return {
      state: this.state,
      ...(this.networkFilesystem
        ? { networkFilesystem: this.networkFilesystem }
        : {}),
    };
  }

  /** Consumers must still gate their own feature contract before using this. */
  getDatabase(): SqliteDatabase | undefined {
    return this.database;
  }

  close(): void {
    try {
      this.database?.close();
      if (this.state === "ready") this.state = "disabled";
    } catch (error) {
      this.state = "error";
      this.onError?.(error);
    } finally {
      this.database = undefined;
    }
  }
}
