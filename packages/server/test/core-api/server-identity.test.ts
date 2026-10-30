import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openSqliteOrThrow } from "../../src/storage/sqlite.js";
import {
  migrateDiscoveryDatabase,
  openDiscoveryDatabase,
} from "../../src/storage/discovery-sqlite.js";
import { readServerIdentity } from "../../src/core-api/server-identity.js";

it("persists public identity across reopening a profile without sharing it with another profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ya-v0-identity-"));
  try {
    const first = openDiscoveryDatabase({ dataDir: dir });
    const id = readServerIdentity(first);
    expect(readServerIdentity(first)).toBe(id);
    first.close();
    const reopened = openDiscoveryDatabase({ dataDir: dir });
    try {
      expect(readServerIdentity(reopened)).toBe(id);
    } finally {
      reopened.close();
    }
    const isolated = openSqliteOrThrow(":memory:");
    try {
      migrateDiscoveryDatabase(isolated);
      expect(readServerIdentity(isolated)).not.toBe(id);
      isolated.exec("UPDATE public_server_identity SET server_id = 'damaged'");
      expect(() => readServerIdentity(isolated)).toThrow(
        "Invalid public YA server identity",
      );
    } finally {
      isolated.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
