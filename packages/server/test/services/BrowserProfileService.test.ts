import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserProfileService } from "../../src/services/BrowserProfileService.js";

const metadata = {
  origin: "http://localhost:3400",
  scheme: "http",
  hostname: "localhost",
  port: 3400,
  userAgent: "Mozilla/5.0 Test Browser",
};

function storedProfile(browserProfileId: string, lastActiveAt: string) {
  return {
    browserProfileId,
    origins: [
      {
        ...metadata,
        firstSeen: lastActiveAt,
        lastSeen: lastActiveAt,
      },
    ],
    createdAt: lastActiveAt,
    lastActiveAt,
  };
}

describe("BrowserProfileService", () => {
  let tempDir: string;
  let currentTime: Date;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-profiles-"));
    currentTime = new Date("2026-07-01T00:00:00.000Z");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeProfiles(
    profiles: Record<string, ReturnType<typeof storedProfile>>,
  ) {
    await fs.writeFile(
      path.join(tempDir, "browser-profiles.json"),
      JSON.stringify({ version: 1, profiles }, null, 2),
      "utf-8",
    );
  }

  it("records and persists browser profile origins", async () => {
    const service = new BrowserProfileService({
      dataDir: tempDir,
      now: () => currentTime,
    });
    await service.initialize();

    await service.recordConnection("profile-1", metadata);

    expect(service.getProfile("profile-1")).toMatchObject({
      browserProfileId: "profile-1",
      lastActiveAt: "2026-07-01T00:00:00.000Z",
      origins: [
        {
          origin: "http://localhost:3400",
          userAgent: "Mozilla/5.0 Test Browser",
        },
      ],
    });

    const saved = JSON.parse(
      await fs.readFile(path.join(tempDir, "browser-profiles.json"), "utf-8"),
    );
    expect(saved.profiles["profile-1"]).toBeDefined();
  });

  it("prunes old profiles without pruning push-subscribed profiles", async () => {
    await writeProfiles({
      "old-unsubscribed": storedProfile(
        "old-unsubscribed",
        "2026-05-01T00:00:00.000Z",
      ),
      "old-subscribed": storedProfile(
        "old-subscribed",
        "2026-05-01T00:00:00.000Z",
      ),
      recent: storedProfile("recent", "2026-06-20T00:00:00.000Z"),
    });

    const service = new BrowserProfileService({
      dataDir: tempDir,
      retentionDays: 30,
      getProtectedBrowserProfileIds: () => ["old-subscribed"],
      now: () => currentTime,
    });
    await service.initialize();

    expect(service.getProfile("old-unsubscribed")).toBeNull();
    expect(service.getProfile("old-subscribed")).not.toBeNull();
    expect(service.getProfile("recent")).not.toBeNull();
  });

  it("caps non-subscribed profiles by pruning the oldest ones", async () => {
    const service = new BrowserProfileService({
      dataDir: tempDir,
      retentionDays: 0,
      maxNonSubscribedProfiles: 2,
      now: () => currentTime,
    });
    await service.initialize();

    currentTime = new Date("2026-07-01T00:00:00.000Z");
    await service.recordConnection("profile-1", metadata);
    currentTime = new Date("2026-07-02T00:00:00.000Z");
    await service.recordConnection("profile-2", metadata);
    currentTime = new Date("2026-07-03T00:00:00.000Z");
    await service.recordConnection("profile-3", metadata);

    expect(service.getProfile("profile-1")).toBeNull();
    expect(service.getProfile("profile-2")).not.toBeNull();
    expect(service.getProfile("profile-3")).not.toBeNull();
  });

  it("does not count protected profiles against the non-subscribed cap", async () => {
    const service = new BrowserProfileService({
      dataDir: tempDir,
      retentionDays: 0,
      maxNonSubscribedProfiles: 1,
      getProtectedBrowserProfileIds: () => ["profile-1"],
      now: () => currentTime,
    });
    await service.initialize();

    currentTime = new Date("2026-07-01T00:00:00.000Z");
    await service.recordConnection("profile-1", metadata);
    currentTime = new Date("2026-07-02T00:00:00.000Z");
    await service.recordConnection("profile-2", metadata);
    currentTime = new Date("2026-07-03T00:00:00.000Z");
    await service.recordConnection("profile-3", metadata);

    expect(service.getProfile("profile-1")).not.toBeNull();
    expect(service.getProfile("profile-2")).toBeNull();
    expect(service.getProfile("profile-3")).not.toBeNull();
  });
});
