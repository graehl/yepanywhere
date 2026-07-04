import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_PROJECT_QUEUE_QUIET_SECONDS } from "@yep-anywhere/shared";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";

describe("ServerSettingsService", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "server-settings-test-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("uses continue as the default heartbeat turn text", async () => {
    const service = new ServerSettingsService({ dataDir: testDir });

    await service.initialize();

    expect(service.getSetting("heartbeatTurnText")).toBe("continue");
  });

  it("keeps experimental workstreams disabled by default", async () => {
    const service = new ServerSettingsService({ dataDir: testDir });

    await service.initialize();

    expect(service.getSetting("workstreamsEnabled")).toBe(false);
  });

  it.each([
    "heartbeat",
    "yepanywhere heartbeat",
  ])("migrates legacy built-in heartbeat turn text default %j", async (heartbeatTurnText) => {
    await fs.writeFile(
      path.join(testDir, "server-settings.json"),
      JSON.stringify({
        version: 1,
        settings: {
          heartbeatTurnText,
        },
      }),
      "utf-8",
    );
    const service = new ServerSettingsService({ dataDir: testDir });

    await service.initialize();

    expect(service.getSetting("heartbeatTurnText")).toBe("continue");
    const persisted = JSON.parse(
      await fs.readFile(path.join(testDir, "server-settings.json"), "utf-8"),
    ) as { settings: { heartbeatTurnText?: string }; version: number };
    expect(persisted.version).toBe(2);
    expect(persisted.settings.heartbeatTurnText).toBe("continue");
  });

  it("preserves custom heartbeat turn text", async () => {
    await fs.writeFile(
      path.join(testDir, "server-settings.json"),
      JSON.stringify({
        version: 1,
        settings: {
          heartbeatTurnText: "checking in",
        },
      }),
      "utf-8",
    );
    const service = new ServerSettingsService({ dataDir: testDir });

    await service.initialize();

    expect(service.getSetting("heartbeatTurnText")).toBe("checking in");
  });

  it("clamps oversized Project Queue quiet-window settings on load", async () => {
    await fs.writeFile(
      path.join(testDir, "server-settings.json"),
      JSON.stringify({
        version: 2,
        settings: {
          projectQueueQuietSeconds: 999,
        },
      }),
      "utf-8",
    );
    const service = new ServerSettingsService({ dataDir: testDir });

    await service.initialize();

    expect(service.getSetting("projectQueueQuietSeconds")).toBe(
      MAX_PROJECT_QUEUE_QUIET_SECONDS,
    );
  });
});
