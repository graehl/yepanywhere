export const BROWSER_SETTINGS_BACKUP_VERSION = 1 as const;

export type BrowserSettingsBackupValues = Record<string, string>;

/** One explicit server-stored copy of a browser's portable UI preferences. */
export interface BrowserSettingsBackup {
  version: typeof BROWSER_SETTINGS_BACKUP_VERSION;
  savedAt: string;
  values: BrowserSettingsBackupValues;
}

export interface BrowserSettingsBackupResponse {
  backup: BrowserSettingsBackup | null;
}
