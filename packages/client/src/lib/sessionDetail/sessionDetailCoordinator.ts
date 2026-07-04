import type { Message } from "../../types";
import type { YaSourceRuntime } from "../sourceRuntime";
import type { SessionDetailEntryKeyInput } from "./sessionDetailKey";
import {
  bufferSessionDetailStreamMessage,
  bufferSessionDetailStreamSubagentMessage,
  createSessionDetailStreamBuffer,
  drainSessionDetailStreamBuffer,
  resetSessionDetailStreamBuffer,
} from "./streamBuffer";

export interface SessionDetailCoordinatorInput {
  entryKey: SessionDetailEntryKeyInput;
  runtime: YaSourceRuntime;
}

export interface SessionDetailStreamProcessors {
  processMessage(message: Message, fromBufferedReplay?: boolean): void;
  processSubagentMessage(message: Message, agentId: string): void;
}

export class SessionDetailCoordinator {
  readonly entryKey: SessionDetailEntryKeyInput;
  readonly runtime: YaSourceRuntime;

  private readonly streamBuffer = createSessionDetailStreamBuffer();
  private initialLoadComplete = false;
  private fetchNewMessagesInFlight: Promise<void> | null = null;

  constructor({ entryKey, runtime }: SessionDetailCoordinatorInput) {
    this.entryKey = entryKey;
    this.runtime = runtime;
  }

  get sourceKey() {
    return this.runtime.sourceKey;
  }

  get api() {
    return this.runtime.api;
  }

  get cache() {
    return this.runtime.sessionDetails.cache;
  }

  resetForInitialLoad(): void {
    this.initialLoadComplete = false;
    resetSessionDetailStreamBuffer(this.streamBuffer);
  }

  completeInitialLoad(processors: SessionDetailStreamProcessors): void {
    this.initialLoadComplete = true;
    this.flushBufferedStream(processors);
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
