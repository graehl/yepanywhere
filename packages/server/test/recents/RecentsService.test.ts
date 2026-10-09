import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecentsService } from "../../src/recents/index.js";

describe("RecentsService", () => {
  let dataDir: string;
  let service: RecentsService;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "recents-"));
    service = new RecentsService({ dataDir });
    await service.initialize();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  const ids = () => service.getRecents().map((e) => e.sessionId);

  it("notifies readers after visits, remaps and clears are saved", async () => {
    const observed: string[][] = [];
    service = new RecentsService({
      dataDir,
      onChanged: () => observed.push(ids()),
    });
    await service.initialize();
    await service.recordVisit("provisional", "proj-1");
    await service.remapSession("provisional", "real");
    await service.clear();
    expect(observed).toEqual([["provisional"], ["real"], []]);
  });

  it("renames a provisional visit to the real session id", async () => {
    await service.recordVisit("other", "proj-1");
    await service.recordVisit("provisional", "proj-1");
    await service.remapSession("provisional", "real");
    expect(ids()).toEqual(["real", "other"]);
  });

  it("drops the provisional visit when the real id is already listed", async () => {
    await service.recordVisit("real", "proj-1");
    await service.recordVisit("provisional", "proj-1");
    await service.remapSession("provisional", "real");
    expect(ids()).toEqual(["real"]);
  });

  it("records a visit arriving after the remap under the real id", async () => {
    await service.remapSession("provisional", "real");
    await service.recordVisit("provisional", "proj-1");
    expect(ids()).toEqual(["real"]);
  });

  it("prunes unresolved visits but keeps fresh ones", async () => {
    await service.recordVisit("old-ghost", "proj-1");
    await service.recordVisit("kept", "proj-1");
    await service.pruneUnresolved(["old-ghost"], -1);
    expect(ids()).toEqual(["kept"]);

    await service.recordVisit("just-started", "proj-1");
    await service.pruneUnresolved(["just-started"], 60_000);
    expect(ids()).toEqual(["just-started", "kept"]);
  });
});
