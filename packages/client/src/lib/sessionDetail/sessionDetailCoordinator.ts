import type { Message } from "../../types";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
} from "../sessionRouteSnapshots";
import type { GetSessionResult, YaSourceRuntime } from "../sourceRuntime";
import { selectSessionDetailRuntimeSnapshot } from "./selectors";
import {
  buildSessionDetailRevealSnapshot,
  getCacheableSessionDetailRevealSnapshot,
  type SessionDetailRevealSnapshotFallback,
  type SessionDetailRevealSnapshotResult,
} from "./revealSnapshot";
import type { SessionDetailEntryKeyInput } from "./sessionDetailKey";
import { getSessionDetailEntryKey } from "./sessionDetailKey";
import {
  bufferSessionDetailStreamMessage,
  bufferSessionDetailStreamSubagentMessage,
  createSessionDetailStreamBuffer,
  drainSessionDetailStreamBuffer,
  resetSessionDetailStreamBuffer,
} from "./streamBuffer";
import type { SessionDetailAction, SessionDetailState } from "./types";
import type {
  SessionDetailEquality,
  SessionDetailSelector,
} from "./sessionDetailEntryStore";

type SessionDetailReadSelector<T> = (state: SessionDetailState) => T;

export interface SessionDetailCoordinatorInput {
  entryKey: SessionDetailEntryKeyInput;
  runtime: YaSourceRuntime;
}

export interface SessionDetailStreamProcessors {
  processMessage(message: Message, fromBufferedReplay?: boolean): void;
  processSubagentMessage(message: Message, agentId: string): void;
}

export interface SessionDetailBeginInitialLoadOptions {
  warmSnapshot?: SessionRouteSnapshot;
}

export interface SessionDetailRouteSnapshotReadPolicy {
  enabled: boolean;
}

export interface SessionDetailRouteSnapshotWritePolicy {
  enabled: boolean;
  retainScrollSnapshot: boolean;
}

export interface SessionDetailInitialLoadLifecycle {
  readonly restoredFromSnapshot: boolean;
  completeReveal(processors: SessionDetailStreamProcessors): boolean;
}

export interface SessionDetailWarmRefreshOptions {
  warmSnapshot?: SessionRouteSnapshot;
  initialAfterMessageId?: string;
}

export interface SessionDetailAppliedWarmRefresh {
  messageCount: number;
  pagination: GetSessionResult["pagination"];
  sourceMessageCount: number;
}

export interface SessionDetailLoadCompleteResult {
  session: GetSessionResult["session"];
  status: GetSessionResult["ownership"];
  pendingInputRequest?: GetSessionResult["pendingInputRequest"];
  slashCommands?: GetSessionResult["slashCommands"];
  deferredMessages?: GetSessionResult["deferredMessages"];
}

export type SessionDetailRevealSnapshotInput = Omit<
  SessionDetailRevealSnapshotFallback,
  "maxPersistedTimestampMs"
>;

export class SessionDetailCoordinator {
  readonly entryKey: SessionDetailEntryKeyInput;
  readonly runtime: YaSourceRuntime;

  private readonly streamBuffer = createSessionDetailStreamBuffer();
  private initialLoadComplete = false;
  private initialLoadEpoch = 0;
  private fetchNewMessagesInFlight: Promise<void> | null = null;

  constructor({ entryKey, runtime }: SessionDetailCoordinatorInput) {
    this.entryKey = entryKey;
    this.runtime = runtime;
  }

  get sourceKey() {
    return this.runtime.sourceKey;
  }

  get entryKeyString() {
    return getSessionDetailEntryKey(this.entryKey);
  }

  get api() {
    return this.runtime.api;
  }

  get cache() {
    return this.runtime.sessionDetails.cache;
  }

  beginInitialLoad(
    options: SessionDetailBeginInitialLoadOptions = {},
  ): SessionDetailInitialLoadLifecycle {
    const epoch = this.resetForInitialLoad();
    return {
      restoredFromSnapshot: Boolean(options.warmSnapshot),
      completeReveal: (processors) =>
        this.completeInitialReveal(epoch, processors),
    };
  }

  private resetForInitialLoad(): number {
    this.initialLoadEpoch += 1;
    this.initialLoadComplete = false;
    resetSessionDetailStreamBuffer(this.streamBuffer);
    return this.initialLoadEpoch;
  }

  dispatch(action: SessionDetailAction): SessionDetailState | undefined {
    return this.cache.dispatch(this.entryKey, action);
  }

  readSelected<T>(selector: SessionDetailReadSelector<T>): T | undefined {
    return this.cache.readSelected(this.entryKey, selector);
  }

  readRouteSnapshot(): SessionRouteSnapshot | undefined {
    return this.cache.readRouteSnapshot(this.entryKey);
  }

  writeRouteSnapshot(snapshot: SessionRouteSnapshot): boolean {
    return this.cache.writeRouteSnapshot(this.entryKey, snapshot);
  }

  readInitialRouteSnapshot(
    policy: SessionDetailRouteSnapshotReadPolicy,
  ): SessionRouteSnapshot | undefined {
    if (!policy.enabled) {
      return undefined;
    }
    return this.readRouteSnapshot();
  }

  writeInitialRouteSnapshot(
    snapshot: SessionRouteSnapshot,
    policy: SessionDetailRouteSnapshotWritePolicy,
  ): boolean {
    if (!policy.enabled) {
      return false;
    }
    return this.writeRouteSnapshot({
      ...snapshot,
      scrollSnapshot: policy.retainScrollSnapshot
        ? snapshot.scrollSnapshot
        : undefined,
    });
  }

  replaceRouteSnapshot(snapshot: SessionRouteSnapshot): boolean {
    return this.cache.replaceRouteSnapshot(this.entryKey, snapshot);
  }

  resetEntryState(): void {
    this.cache.resetEntryState(this.entryKey);
  }

  retain(): () => void {
    return this.cache.retain(this.entryKey);
  }

  subscribe<T>(
    selector: SessionDetailSelector<T>,
    listener: () => void,
    equality?: SessionDetailEquality<T>,
  ): () => void {
    return this.cache.subscribe(this.entryKey, selector, listener, equality);
  }

  readScrollSnapshot(): SessionRouteScrollSnapshot | undefined {
    return this.cache.readScrollSnapshot(this.entryKey);
  }

  patchScrollSnapshot(snapshot: SessionRouteScrollSnapshot): void {
    this.cache.patchScrollSnapshot(this.entryKey, snapshot);
  }

  deleteEntry(): boolean {
    return this.cache.deleteEntry(this.entryKey);
  }

  getEntryApproxBytes(): number | undefined {
    return this.cache
      .getStats()
      .entries.find((entry) => entry.key === this.entryKeyString)?.approxBytes;
  }

  applyWarmRefresh(
    data: GetSessionResult,
    options: SessionDetailWarmRefreshOptions,
  ): SessionDetailAppliedWarmRefresh {
    const sourceMessageCount = data.messages.length;
    if (!options.warmSnapshot) {
      return {
        messageCount: sourceMessageCount,
        pagination: data.pagination,
        sourceMessageCount,
      };
    }

    if (options.initialAfterMessageId === undefined) {
      this.dispatch({
        type: "loadPersistedTranscript",
        messages: data.messages,
        session: data.session,
        pagination: data.pagination,
      });
      return {
        messageCount: sourceMessageCount,
        pagination: data.pagination,
        sourceMessageCount,
      };
    }

    if (data.pagination) {
      this.dispatch({
        type: "replaceTailWindow",
        messages: data.messages,
        session: data.session,
        pagination: data.pagination,
      });
      return {
        messageCount: sourceMessageCount,
        pagination: data.pagination,
        sourceMessageCount,
      };
    }

    this.dispatch({
      type: "applyCatchupMessages",
      session: data.session,
      messages: data.messages,
    });
    const merged = this.readSelected(selectSessionDetailRuntimeSnapshot);
    return {
      messageCount: merged?.messages.length ?? sourceMessageCount,
      pagination: merged?.pagination,
      sourceMessageCount,
    };
  }

  buildRevealSnapshot(
    fallback: SessionDetailRevealSnapshotInput,
  ): SessionDetailRevealSnapshotResult {
    const selected = this.readSelected(selectSessionDetailRuntimeSnapshot);
    return buildSessionDetailRevealSnapshot({
      selected: selected
        ? {
            ...selected,
            scrollSnapshot: this.readScrollSnapshot(),
          }
        : undefined,
      fallback: {
        ...fallback,
        maxPersistedTimestampMs:
          selected?.maxPersistedTimestampMs ?? Number.NEGATIVE_INFINITY,
      },
    });
  }

  getCacheableRevealSnapshot(
    reveal: SessionDetailRevealSnapshotResult,
  ): SessionRouteSnapshot | undefined {
    return getCacheableSessionDetailRevealSnapshot(reveal);
  }

  buildLoadCompleteResult(
    data: GetSessionResult,
  ): SessionDetailLoadCompleteResult {
    return {
      session: data.session,
      status: data.ownership,
      pendingInputRequest: data.pendingInputRequest,
      slashCommands: data.slashCommands,
      deferredMessages: data.deferredMessages,
    };
  }

  private completeInitialReveal(
    epoch: number,
    processors: SessionDetailStreamProcessors,
  ): boolean {
    if (epoch !== this.initialLoadEpoch) {
      return false;
    }
    this.initialLoadComplete = true;
    this.flushBufferedStream(processors);
    return true;
  }

  handleStreamMessage(
    message: Message,
    processMessage: SessionDetailStreamProcessors["processMessage"],
  ): void {
    if (!this.initialLoadComplete) {
      bufferSessionDetailStreamMessage(this.streamBuffer, message);
      return;
    }
    processMessage(message);
  }

  handleStreamSubagentMessage(
    message: Message,
    agentId: string,
    processSubagentMessage: SessionDetailStreamProcessors["processSubagentMessage"],
  ): void {
    if (!this.initialLoadComplete) {
      bufferSessionDetailStreamSubagentMessage(
        this.streamBuffer,
        message,
        agentId,
      );
      return;
    }
    processSubagentMessage(message, agentId);
  }

  runExclusiveFetchNewMessages(task: () => Promise<void>): Promise<void> {
    if (this.fetchNewMessagesInFlight) {
      return this.fetchNewMessagesInFlight;
    }

    let request: Promise<void>;
    try {
      request = task();
    } catch (error) {
      request = Promise.reject(error);
    }
    this.fetchNewMessagesInFlight = request;
    void request.finally(() => {
      if (this.fetchNewMessagesInFlight === request) {
        this.fetchNewMessagesInFlight = null;
      }
    });
    return request;
  }

  private flushBufferedStream(processors: SessionDetailStreamProcessors): void {
    const buffer = drainSessionDetailStreamBuffer(this.streamBuffer);
    for (const item of buffer) {
      if (item.type === "message") {
        processors.processMessage(item.message, true);
      } else {
        processors.processSubagentMessage(item.message, item.agentId);
      }
    }
  }
}

export function createSessionDetailCoordinator(
  input: SessionDetailCoordinatorInput,
): SessionDetailCoordinator {
  return new SessionDetailCoordinator(input);
}
