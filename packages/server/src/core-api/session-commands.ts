import type { ApiProject, ApiLaunchContext } from "./contracts.js";
import type {
  ApiReceipt,
  CreateSessionRequest,
  ApiCreator,
} from "./command-contracts.js";
import type { ApiReceiptStore } from "./receipt-store.js";
import { CoreApiError } from "./errors.js";

export interface SessionCommandOwner {
  recover?(receipt: ApiReceipt): Promise<{ sessionId: string } | undefined>;
  start(
    project: ApiProject,
    request: CreateSessionRequest,
    receipt: ApiReceipt,
    settled: (sessionId: string) => void,
    failed: () => void,
  ): Promise<{ sessionId: string } | { queueId: string } | { rejected: true }>;
}
/** Native launch admission plus durable retry identity; no HTTP or workflow policy. */
export class SessionCommands {
  private active = new Set<Promise<void>>();
  private disposed = false;
  constructor(
    readonly serverId: string,
    readonly store: ApiReceiptStore,
    private readonly owner: SessionCommandOwner,
    readonly enabled: () => boolean,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    store.recoverInterrupted();
  }
  creator(launch?: ApiLaunchContext): ApiCreator {
    return {
      serverId: this.serverId,
      sessionId: launch?.id ?? null,
      launchId: launch?.launchId ?? null,
      principal: { kind: "superuser" },
    };
  }
  replayCreate(request: CreateSessionRequest, launch?: ApiLaunchContext) {
    return this.store.lookup({
      requestId: request.requestId,
      kind: "createSession",
      projectId: request.projectId,
      sessionId: null,
      creator: this.creator(launch),
      payload: request,
    });
  }
  create(
    project: ApiProject,
    request: CreateSessionRequest,
    launch?: ApiLaunchContext,
  ) {
    if (!this.enabled())
      throw new CoreApiError(
        "forbidden",
        "Session command enablement was revoked before admission",
        403,
      );
    if (this.disposed)
      throw new CoreApiError(
        "controller_unavailable",
        "Session command owner is closing",
        503,
      );
    // Replays remain possible at capacity: inspect durable identity first.
    const reserved = this.store.reserve({
      requestId: request.requestId,
      kind: "createSession",
      projectId: project.id,
      sessionId: null,
      creator: this.creator(launch),
      destinationServerId: this.serverId,
      payload: request,
    });
    if (!reserved.created) return reserved.receipt;
    if (this.active.size >= 16) {
      return this.store.update(reserved.receipt.id, {
        state: "failed",
        failure: {
          code: "command_capacity",
          message:
            "Native launch admission is busy; this request was not dispatched",
        },
      })!;
    }
    const receipt = reserved.receipt;
    const settled = (sessionId: string) => {
      if (this.disposed) return;
      this.store.update(receipt.id, { state: "accepted", sessionId });
    };
    const failed = () => {
      if (!this.disposed)
        this.store.update(receipt.id, {
          state: "uncertain",
          failure: {
            code: "launch_uncertain",
            message:
              "Native launch did not establish a durable outcome; inspect existing work before any intentional retry",
          },
        });
    };
    const work = Promise.resolve()
      .then(() =>
        this.disposed
          ? { rejected: true as const }
          : this.owner.start(project, request, receipt, settled, failed),
      )
      .then((result) => {
        if (this.disposed) return;
        if ("sessionId" in result) settled(result.sessionId);
        else if ("queueId" in result) {
          const current = this.store.get(receipt.id);
          if (current?.state === "dispatching")
            this.store.update(receipt.id, {
              state: "queued",
              queueId: result.queueId,
            });
        } else
          this.store.update(receipt.id, {
            state: "failed",
            failure: {
              code: "admission_rejected",
              message: "Native admission rejected this request before dispatch",
            },
          });
      }, failed)
      .catch((error) => {
        this.onError(error);
      })
      .finally(() => this.active.delete(work));
    this.active.add(work);
    return receipt;
  }
  async receipt(id: string) {
    const receipt = this.store.get(id);
    if (receipt?.state !== "uncertain" || this.disposed) return receipt;
    const evidence = await this.owner.recover?.(receipt);
    if (evidence && !this.disposed)
      return this.store.update(id, {
        state: "accepted",
        sessionId: evidence.sessionId,
      });
    return receipt;
  }
  /** Shutdown fences stale async completions; it never repeats an external launch. */
  close() {
    this.disposed = true;
  }
  async idle() {
    await Promise.allSettled(this.active);
  }
}
