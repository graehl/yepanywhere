/**
 * Persists one explicit backup of portable browser UI preferences.
 *
 * Server settings remain live, server-owned configuration. This file only
 * holds the client-provided, allowlisted localStorage snapshot used by the
 * Settings navigation Save/Load controls.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  BROWSER_SETTINGS_BACKUP_VERSION,
  type BrowserSettingsBackup,
  type BrowserSettingsBackupValues,
} from "@yep-anywhere/shared";

const MAX_SETTINGS_COUNT = 256;
const MAX_KEY_BYTES = 256;
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_BACKUP_BYTES = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseValues(value: unknown): BrowserSettingsBackupValues | null {
  if (!isRecord(value)) return null;

  const entries = Object.entries(value);
  if (entries.length > MAX_SETTINGS_COUNT) return null;

  let totalBytes = 0;
  const values: BrowserSettingsBackupValues = Object.create(null);
  for (const [key, entryValue] of entries) {
    if (
      key.length === 0 ||
      Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES ||
      typeof entryValue !== "string" ||
      Buffer.byteLength(entryValue, "utf8") > MAX_VALUE_BYTES
    ) {
      return null;
    }
    totalBytes +=
      Buffer.byteLength(key, "utf8") + Buffer.byteLength(entryValue, "utf8");
    if (totalBytes > MAX_BACKUP_BYTES) return null;
    values[key] = entryValue;
  }
  return values;
}

function parseBackup(value: unknown): BrowserSettingsBackup | null {
  if (!isRecord(value)) return null;
  if (value.version !== BROWSER_SETTINGS_BACKUP_VERSION) return null;
  if (
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt))
  ) {
    return null;
  }
  const values = parseValues(value.values);
  if (!values) return null;
  return {
    version: BROWSER_SETTINGS_BACKUP_VERSION,
    savedAt: value.savedAt,
    values,
  };
}

function cloneBackup(backup: BrowserSettingsBackup): BrowserSettingsBackup {
  return { ...backup, values: { ...backup.values } };
}

export class BrowserSettingsBackupValidationError extends Error {}

export interface BrowserSettingsBackupServiceOptions {
  dataDir: string;
}

export class BrowserSettingsBackupService {
  private readonly dataDir: string;
  private readonly filePath: string;
  private backup: BrowserSettingsBackup | null = null;
  private initialized = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(options: BrowserSettingsBackupServiceOptions) {
    this.dataDir = options.dataDir;
    this.filePath = path.join(this.dataDir, "browser-settings-backup.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = parseBackup(JSON.parse(content));
      if (!parsed) {
        console.warn(
          "[BrowserSettingsBackupService] Ignoring invalid browser settings backup",
        );
      }
      this.backup = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          "[BrowserSettingsBackupService] Failed to load browser settings backup:",
          error,
        );
      }
      this.backup = null;
    }
    this.initialized = true;
  }

  getBackup(): BrowserSettingsBackup | null {
    this.ensureInitialized();
    return this.backup ? cloneBackup(this.backup) : null;
  }

  async saveBackup(input: {
    version: unknown;
    values: unknown;
  }): Promise<BrowserSettingsBackup> {
    this.ensureInitialized();
    if (input.version !== BROWSER_SETTINGS_BACKUP_VERSION) {
      throw new BrowserSettingsBackupValidationError(
        `version must be ${BROWSER_SETTINGS_BACKUP_VERSION}`,
      );
    }
    const values = parseValues(input.values);
    if (!values) {
      throw new BrowserSettingsBackupValidationError(
        "values must be a bounded string-to-string settings map",
      );
    }

    const backup: BrowserSettingsBackup = {
      version: BROWSER_SETTINGS_BACKUP_VERSION,
      savedAt: new Date().toISOString(),
      values,
    };
    const operation = this.writeTail.then(() => this.persist(backup));
    this.writeTail = operation.catch(() => undefined);
    await operation;
    return cloneBackup(backup);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "BrowserSettingsBackupService not initialized. Call initialize() first.",
      );
    }
  }

  private async persist(backup: BrowserSettingsBackup): Promise<void> {
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(backup, null, 2), "utf8");
      await fs.rename(tempPath, this.filePath);
      this.backup = backup;
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
