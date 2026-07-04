import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  type StoredWorkstream,
  type WorkstreamId,
  mainWorkstreamId,
  toUrlProjectId,
  type UrlProjectId,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkstreamService,
  WorkstreamValidationError,
} from "../../src/services/WorkstreamService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const FILE_NAME = "workstreams.json";
const NOW = "2026-07-04T10:00:00.000Z";
const PROJECT_PATH = "/tmp/workstreams-project";

describe("WorkstreamService", () => {
  let testDir: string;
  let filePath: string;
  let projectId: UrlProjectId;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-test-"));
    filePath = path.join(testDir, FILE_NAME);
    projectId = toUrlProjectId(PROJECT_PATH);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function makeWorkstream(
    overrides: Partial<StoredWorkstream> = {},
  ): StoredWorkstream {
    return {
      id: "ws-tools" as WorkstreamId,
      projectId,
      label: "tools cleanup",
      kind: "checkout",
      path: "/tmp/workstreams-project-tools",
      branch: "ya/tools-cleanup",
      baseBranch: "main",
      baseCommit: null,
      managedByYa: true,
      queuePaused: false,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  async function createService(eventBus?: EventBus): Promise<WorkstreamService> {
    const service = new WorkstreamService({
      dataDir: testDir,
      eventBus,
      now: () => new Date(NOW),
    });
    await service.initialize();
    return service;
  }

  it("synthesizes the implicit main workstream without writing a file", async () => {
    const service = await createService();

    const workstreams = service.listProject({
      projectId,
      projectPath: PROJECT_PATH,
      mainBranch: "trunk",
    });

    expect(workstreams).toEqual([
      {
        id: mainWorkstreamId(projectId),
        projectId,
        label: "main",
        kind: "main",
        path: PROJECT_PATH,
        branch: "trunk",
        baseBranch: "trunk",
        baseCommit: null,
        managedByYa: false,
        queuePaused: false,
        status: "active",
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
      },
    ]);
    expect(service.listStored()).toEqual([]);
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists non-main workstreams and lists main first", async () => {
    const service = await createService();

    await service.upsertWorkstream(makeWorkstream());

    const reloaded = await createService();
    const workstreams = reloaded.listProject({
      projectId,
      projectPath: PROJECT_PATH,
    });

    expect(workstreams.map((workstream) => workstream.id)).toEqual([
      mainWorkstreamId(projectId),
      "ws-tools",
    ]);
    expect(workstreams[1]).toMatchObject({
      label: "tools cleanup",
      kind: "checkout",
      path: "/tmp/workstreams-project-tools",
      branch: "ya/tools-cleanup",
      managedByYa: true,
    });

    const saved = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
      version: number;
      workstreams: StoredWorkstream[];
    };
    expect(saved.version).toBe(1);
    expect(saved.workstreams).toHaveLength(1);
    expect(saved.workstreams[0]?.kind).toBe("checkout");
    expect(saved.workstreams[0]?.id).toBe("ws-tools");
  });

  it("filters malformed, duplicate, and implicit-main disk records", async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 0,
        workstreams: [
          { id: "bad-project", projectId: "not-a-url-project-id" },
          makeWorkstream({ id: "ws-valid" as WorkstreamId }),
          makeWorkstream({
            id: "ws-valid" as WorkstreamId,
            label: "duplicate",
          }),
          makeWorkstream({ id: mainWorkstreamId(projectId) }),
        ],
      }),
    );

    const service = await createService();

    expect(service.listStored().map((workstream) => workstream.id)).toEqual([
      "ws-valid",
    ]);

    const saved = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
      version: number;
      workstreams: StoredWorkstream[];
    };
    expect(saved.version).toBe(1);
    expect(saved.workstreams).toHaveLength(1);
    expect(saved.workstreams[0]?.id).toBe("ws-valid");
  });

  it("creates metadata-only workstreams with default durable state", async () => {
    const service = await createService();

    const created = await service.createWorkstream({
      projectId,
      label: "world CRUD",
      path: "/tmp/workstreams-project-world",
      branch: "ya/world-crud",
      managedByYa: true,
    });

    expect(created).toMatchObject({
      projectId,
      label: "world CRUD",
      kind: "checkout",
      path: "/tmp/workstreams-project-world",
      branch: "ya/world-crud",
      baseBranch: "main",
      baseCommit: null,
      managedByYa: true,
      queuePaused: false,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(created.id).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    );
  });

  it("serializes concurrent upserts and preserves insertion order", async () => {
    const service = await createService();

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        service.upsertWorkstream(
          makeWorkstream({
            id: `ws-${index}` as WorkstreamId,
            label: `stream ${index}`,
          }),
        ),
      ),
    );

    const reloaded = await createService();

    expect(reloaded.listStored().map((workstream) => workstream.id)).toEqual([
      "ws-0",
      "ws-1",
      "ws-2",
      "ws-3",
      "ws-4",
    ]);
  });

  it("removes the backing file when the last stored workstream is deleted", async () => {
    const service = await createService();
    await service.upsertWorkstream(makeWorkstream());

    await expect(fs.access(filePath)).resolves.toBeUndefined();

    await expect(service.deleteWorkstream("ws-tools" as WorkstreamId)).resolves.toBe(
      true,
    );
    expect(service.listStored()).toEqual([]);
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("emits change events after successful mutations", async () => {
    const eventBus = new EventBus();
    const listener = vi.fn();
    eventBus.subscribe((event) => {
      if (event.type === "workstreams-changed") {
        listener(`${event.reason}:${event.workstreamId ?? ""}`);
      }
    });
    const service = await createService(eventBus);

    await service.upsertWorkstream(makeWorkstream());
    await service.upsertWorkstream(makeWorkstream({ label: "renamed" }));
    await service.deleteWorkstream("ws-tools" as WorkstreamId);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map((call) => call[0])).toEqual([
      "created:ws-tools",
      "updated:ws-tools",
      "deleted:ws-tools",
    ]);
  });

  it("emits change events for projects emptied by replaceAll", async () => {
    const eventBus = new EventBus();
    const listener = vi.fn();
    eventBus.subscribe((event) => {
      if (event.type === "workstreams-changed") {
        listener(`${event.reason}:${event.projectId}`);
      }
    });
    const service = await createService(eventBus);
    await service.upsertWorkstream(makeWorkstream());
    listener.mockClear();

    await service.replaceAll([]);

    expect(listener.mock.calls.map((call) => call[0])).toEqual([
      `replaced:${projectId}`,
    ]);
    expect(service.listStored()).toEqual([]);
  });

  it("rejects invalid caller mutations without changing current state", async () => {
    const service = await createService();
    await service.upsertWorkstream(makeWorkstream());

    await expect(
      service.upsertWorkstream(makeWorkstream({ id: mainWorkstreamId(projectId) })),
    ).rejects.toBeInstanceOf(WorkstreamValidationError);

    await expect(
      service.upsertWorkstream(
        makeWorkstream({
          projectId: toUrlProjectId("/tmp/other-workstreams-project"),
        }),
      ),
    ).rejects.toBeInstanceOf(WorkstreamValidationError);

    await expect(
      service.replaceAll([
        makeWorkstream({ id: "ws-a" as WorkstreamId }),
        makeWorkstream({ id: "ws-a" as WorkstreamId }),
      ]),
    ).rejects.toBeInstanceOf(WorkstreamValidationError);

    expect(service.listStored().map((workstream) => workstream.id)).toEqual([
      "ws-tools",
    ]);
  });
});
