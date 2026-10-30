import { expect, it } from "vitest";
import { openSqliteOrThrow } from "../../src/storage/sqlite.js";
import { migrateDiscoveryDatabase } from "../../src/storage/discovery-sqlite.js";
import { ApiReceiptStore } from "../../src/core-api/receipt-store.js";
import { SessionCommands } from "../../src/core-api/session-commands.js";
import { nativeSessionCommandOwner } from "../../src/core-api/native-session-commands.js";
import { createSessionRequest } from "../../src/core-api/command-contracts.js";
import { Supervisor } from "../../src/supervisor/Supervisor.js";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type {
  AgentProvider,
  StartSessionOptions,
} from "../../src/sdk/providers/types.js";
import { encodeProjectId } from "../../src/projects/paths.js";

it("uses the native Supervisor owner, retains requested launch options and recovers canonical identity", async () => {
  const database = openSqliteOrThrow(":memory:");
  migrateDiscoveryDatabase(database);
  const store = new ApiReceiptStore(database);
  let options: StartSessionOptions | undefined;
  let starts = 0;
  const nativeId = "00000000-0000-4000-8000-000000000042";
  const provider = {
    name: "codex",
    async startSession(request: StartSessionOptions) {
      if (++starts > 1)
        throw new Error("Scripted queued provider startup failure");
      options = request;
      const queue = new MessageQueue();
      const incoming = queue.generator();
      const iterator = (async function* () {
        yield {
          type: "system" as const,
          subtype: "init" as const,
          session_id: nativeId,
        };
        for await (const _message of incoming)
          yield {
            type: "result" as const,
            subtype: "success" as const,
            session_id: nativeId,
          };
      })();
      return {
        queue,
        iterator,
        abort: async () => {
          await incoming.return();
        },
      };
    },
  } as unknown as AgentProvider;
  const supervisor = new Supervisor({
    provider,
    defaultPermissionMode: "default",
    maxWorkers: 1,
  });
  const nativeOwner = nativeSessionCommandOwner({
    supervisor,
    globalInstructions: () => "Fixture guidance",
  });
  let failed!: () => void;
  const failure = new Promise<void>((resolve) => (failed = resolve));
  const owner: typeof nativeOwner = {
    ...nativeOwner,
    start: (project, request, receipt, settled, onFailed) =>
      nativeOwner.start(project, request, receipt, settled, () => {
        onFailed();
        failed();
      }),
  };
  const remapped: string[] = [];
  const firstObserver = supervisor.observeSessionIdRemaps((oldId, newId) => {
    remapped.push("first:" + newId);
    store.remap(oldId, newId);
  });
  const secondObserver = supervisor.observeSessionIdRemaps((_oldId, newId) =>
    remapped.push("second:" + newId),
  );
  const commands = new SessionCommands("A", store, owner, () => true);
  try {
    const project = {
      id: encodeProjectId(process.cwd()),
      name: "Fixture",
      path: process.cwd(),
    };
    const request = createSessionRequest.parse({
      requestId: "native-review-1",
      projectId: project.id,
      provider: "codex",
      model: "fixture-model",
      thinking: "on:high",
      permissionMode: "bypassPermissions",
      message: "Review",
    });
    const receipt = commands.create(project, request, {
      id: "parent",
      launchId: "launch",
      management: true,
    });
    await commands.idle();
    expect(store.get(receipt.id)).toMatchObject({
      state: "accepted",
      sessionId: nativeId,
      creator: { sessionId: "parent" },
    });
    expect(options).toMatchObject({
      model: "fixture-model",
      effort: "high",
      permissionMode: "bypassPermissions",
      globalInstructions: "Fixture guidance",
    });
    const nativeProcess = supervisor.getProcessForSession(nativeId)!;
    expect(nativeProcess).toBeDefined();
    expect(remapped).toContain("first:" + nativeId);
    expect(remapped).toContain("second:" + nativeId);
    expect(
      nativeProcess
        .getMessageHistory()
        .some((message) => message.uuid === receipt.id),
    ).toBe(true);
    store.update(receipt.id, { state: "uncertain", sessionId: null });
    expect(await commands.receipt(receipt.id)).toMatchObject({
      state: "accepted",
      sessionId: nativeId,
      delivery: "unknown",
    });
    const queued = commands.create(project, {
      ...request,
      requestId: "native-review-2",
    });
    await commands.idle();
    expect(store.get(queued.id)?.state).toBe("queued");
    await supervisor.abortProcess(nativeProcess.id);
    await failure;
    expect(store.get(queued.id)).toMatchObject({
      state: "uncertain",
      failure: { code: "launch_uncertain" },
    });
  } finally {
    commands.close();
    firstObserver();
    secondObserver();
    await Promise.all(
      supervisor
        .getAllProcesses()
        .map((process) => supervisor.abortProcess(process.id)),
    );
    await supervisor.stopBackgroundTasks();
    store.close();
    database.close();
  }
});
