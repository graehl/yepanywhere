import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BROWSER_SETTINGS_BACKUP_VERSION } from "@yep-anywhere/shared";
import { createBrowserSettingsBackupRoutes } from "../../src/routes/browser-settings-backup.js";
import { BrowserSettingsBackupService } from "../../src/services/BrowserSettingsBackupService.js";

describe("browser settings backup routes", () => {
  let testDir: string;
  let service: BrowserSettingsBackupService;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "browser-settings-backup-test-"),
    );
    service = new BrowserSettingsBackupService({ dataDir: testDir });
    await service.initialize();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("stores and reloads the server copy", async () => {
    const routes = createBrowserSettingsBackupRoutes({
      browserSettingsBackupService: service,
    });
    const saveResponse = await routes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: BROWSER_SETTINGS_BACKUP_VERSION,
        values: { "yep-anywhere-theme": "verydark" },
      }),
    });

    expect(saveResponse.status).toBe(200);
    const reloaded = new BrowserSettingsBackupService({ dataDir: testDir });
    await reloaded.initialize();
    const getRoutes = createBrowserSettingsBackupRoutes({
      browserSettingsBackupService: reloaded,
    });
    const getResponse = await getRoutes.request("/");
    const body = await getResponse.json();
    expect(body.backup).toMatchObject({
      version: BROWSER_SETTINGS_BACKUP_VERSION,
      values: { "yep-anywhere-theme": "verydark" },
    });
    expect(body.backup.savedAt).toEqual(expect.any(String));
  });

  it("rejects unsupported versions and non-string values", async () => {
    const routes = createBrowserSettingsBackupRoutes({
      browserSettingsBackupService: service,
    });

    const wrongVersion = await routes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 99, values: {} }),
    });
    expect(wrongVersion.status).toBe(400);

    const invalidValue = await routes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: BROWSER_SETTINGS_BACKUP_VERSION,
        values: { "yep-anywhere-theme": false },
      }),
    });
    expect(invalidValue.status).toBe(400);
  });
});
