import { useCallback, useEffect, useRef, useState } from "react";
import { type DeferredQueueMessage, type PaginationInfo, api } from "../api/client";
import {
  getMessageTimestampMs,
  hasEquivalentJsonlMessage,
  reconcileLinearMessages,
} from "../lib/linearMessageDedup";
import {
  findMessageIndexById,
  getMessageId,
  mergeJSONLMessages,
  mergeStreamMessage,
} from "../lib/mergeMessages";
import { markReloadPerfPhase } from "../lib/diagnostics/reloadPerfProbe";
import { getProvider } from "../providers/registry";
import { getSessionTranscriptCacheEnabled } from "./useSessionPerformanceSettings";
import { getStreamingEnabled } from "./useStreamingEnabled";
import type { Message, SessionMetadata, SessionStatus } from "../types";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import type { ClientSummarySourceKey } from "../lib/clientSummaryStore";
import {
  createCatchupMessagesAction,
  createClearAgentStreamingPlaceholdersAction,
  createLoadPersistedTranscriptAction,
  createMergeLoadedAgentContentAction,
  createPrependOlderMessagesAction,
  createRegisterToolUseAgentAction,
  createRestoreRouteSnapshotAction,
  createStreamMessageAction,
  createStreamSubagentMessageAction,
  createUpdateAgentContextUsageAction,
} from "../lib/sessionDetail/actionAdapters";
import {
  isSessionDetailShadowDiagnosticsEnabled,
  reportSessionDetailStoreDivergence,
  reportSessionDetailShadowDivergence,
  type SessionDetailRuntimeStateInput,
} from "../lib/sessionDetail/shadowDiagnostics";
import {
  selectSessionDetailPagination,
  selectSessionDetailRuntimeSnapshot,
  selectSessionDetailScrollSnapshot,
} from "../lib/sessionDetail/selectors";
import { defaultSessionDetailStore } from "../lib/sessionDetail/sessionDetailStore";
import {
  clearAgentStreamingPlaceholdersMap,
  createInitialSessionDetailState,
  mergeLoadedAgentContentMap,
  reduceSessionDetailState,
  updateAgentContextUsageMap,
} from "../lib/sessionDetail/transcriptReducer";
import type {
  AgentContextUsage,
  SessionDetailAction,
  SessionDetailState,
} from "../lib/sessionDetail/types";
import {
  getSessionRouteSnapshotKey,
  patchSessionRouteScrollSnapshot,
  readSessionRouteSnapshot,
  resetSessionRouteSnapshotsForTests,
  writeSessionRouteSnapshot,
  type SessionRouteScrollSnapshot,
  type SessionRouteSnapshot,
  type SessionRouteSnapshotKeyInput,
} from "../lib/sessionRouteSnapshots";

/** Content from a subagent (Task tool) */
export interface AgentContent {
  messages: Message[];
  status: "pending" | "running" | "completed" | "failed";
  /** Real-time context usage from message_start events */
  contextUsage?: {
    inputTokens: number;
    percentage: number;
  };
}

/** Map of agentId → agent content */
export type AgentContentMap = Record<string, AgentContent>;

/** Result from initial session load */
export interface SessionLoadResult {
  session: SessionMetadata;
  status: SessionStatus;
  pendingInputRequest?: unknown;
  slashCommands?: Array<{
    name: string;
    description: string;
    argumentHint?: string;
  }> | null;
  deferredMessages?: DeferredQueueMessage[];
}

export type SessionLoadProgressStage =
  | "idle"
  | "fetching"
  | "loaded"
  | "preparing"
  | "rendering"
  | "complete"
  | "error";

export interface SessionLoadProgress {
  stage: SessionLoadProgressStage;
  messageCount?: number;
  totalMessageCount?: number;
  hasOlderMessages?: boolean;
  updatedAtMs: number;
}

/** Options for useSessionMessages */
export interface UseSessionMessagesOptions {
  projectId: string;
  sessionId: string;
  tailTurns?: number;
  tailFrom?: string;
  /** Enable opt-in progress paint yields for large initial transcript loads */
  detailedLoadingProgress?: boolean;
  /** Called when initial load completes with session data */
  onLoadComplete?: (result: SessionLoadResult) => void;
  /** Called on load error */
  onLoadError?: (error: Error) => void;
}

/** Result from useSessionMessages hook */
export interface UseSessionMessagesResult {
  /** Messages in the session */
  messages: Message[];
  /** Subagent content keyed by agentId */
  agentContent: AgentContentMap;
  /** Mapping from Task tool_use_id → agentId */
  toolUseToAgent: Map<string, string>;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Fine-grained initial load progress for opt-in display */
  sessionLoadProgress: SessionLoadProgress;
  /** Session data from initial load */
  session: SessionMetadata | null;
  /** Set session data (for stream connected event) */
  setSession: React.Dispatch<React.SetStateAction<SessionMetadata | null>>;
  /** Handle streaming content updates (for useStreamingContent) */
  handleStreamingUpdate: (message: Message, agentId?: string) => void;
  /** Handle stream message event (buffered until initial load completes) */
  handleStreamMessageEvent: (incoming: Message) => void;
  /** Handle stream subagent message event */
  handleStreamSubagentMessage: (incoming: Message, agentId: string) => void;
  /** Register toolUse → agent mapping */
  registerToolUseAgent: (toolUseId: string, agentId: string) => void;
  /** Merge loaded subagent content with any live content already seen */
  mergeLoadedAgentContent: (agentId: string, content: AgentContent) => void;
  /** Update agent context usage metadata */
  updateAgentContextUsage: (
    agentId: string,
    contextUsage: AgentContextUsage,
  ) => void;
  /** Remove transient streaming placeholder rows from a subagent */
  clearAgentStreamingPlaceholders: (agentId: string) => void;
  /** Update agent content (for lazy loading) */
  setAgentContent: React.Dispatch<React.SetStateAction<AgentContentMap>>;
  /** Direct messages setter (for clearing streaming placeholders) */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Fetch new messages incrementally (for file change events) */
  fetchNewMessages: () => Promise<void>;
  /** Fetch session metadata only */
  fetchSessionMetadata: () => Promise<void>;
  /** Pagination info from compact-boundary-based loading */
  pagination: PaginationInfo | undefined;
  /** Whether older messages are being loaded */
  loadingOlder: boolean;
  /** Load the next chunk of older messages */
  loadOlderMessages: () => Promise<void>;
  /** Retained scroll anchor from the last same-tab route visit */
  initialScrollSnapshot: SessionRouteScrollSnapshot | null;
  /** Update the retained scroll anchor without re-rendering this hook */
  updateRouteScrollSnapshot: (snapshot: SessionRouteScrollSnapshot) => void;
  /** True when the initial render was hydrated from a retained route snapshot */
  restoredFromSnapshot: boolean;
}

function readSessionLoadCache(
  sourceKey: ClientSummarySourceKey,
  projectId: string,
  sessionId: string,
  tailTurns?: number,
  tailFrom?: string,
): SessionRouteSnapshot | undefined {
  if (!getSessionTranscriptCacheEnabled()) {
    return undefined;
  }
  return readSessionRouteSnapshot({
    sourceKey,
    projectId,
    sessionId,
    tailTurns,
    tailFrom,
  });
}

function writeSessionLoadCache(
  sourceKey: ClientSummarySourceKey,
  projectId: string,
  sessionId: string,
  entry: SessionRouteSnapshot,
  tailTurns?: number,
  tailFrom?: string,
): void {
  if (!getSessionTranscriptCacheEnabled()) {
    return;
  }
  writeSessionRouteSnapshot(
    { sourceKey, projectId, sessionId, tailTurns, tailFrom },
    entry,
  );
}

export function __resetSessionLoadCacheForTest(): void {
  resetSessionRouteSnapshotsForTests();
}

function usesApproxMessageDedup(provider?: string): boolean {
  return getProvider(provider).capabilities.needsApproxMessageDedup;
}

// Options for the approx-dedup backstop. Codex tool messages dedup by call_id,
// so they are excluded here; the backstop keeps covering non-tool messages.
function approxDedupOptions(provider?: string): { excludeTools: boolean } {
  return {
    excludeTools:
      getProvider(provider).capabilities.approxDedupExcludesTools === true,
  };
}

function isDurableRecapOverlay(message: Message): boolean {
  return typeof message.yaRecapSource === "string";
}

/**
 * Find the id of the newest JSONL-sourced message.
 *
 * The incremental-fetch cursor (afterMessageId) must only advance over
 * rows actually delivered from JSONL. Live stream rows also land in the
 * array (and get persisted to the file), so cursoring on the array tail
 * lets streaming advance the cursor past JSONL rows that were never
 * fetched — permanently skipping them, including chain connector rows
 * (attachment, system/api_error) that only exist in JSONL. Over-fetching
 * is safe (merge dedupes by uuid); gaps are not.
 */
function findLastJsonlMessageId(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message &&
      (message._source ?? "sdk") === "jsonl" &&
      !isDurableRecapOverlay(message)
    ) {
      return getMessageId(message);
    }
  }
  return undefined;
}

function clearStreamingMessages(messages: Message[]): Message[] {
  const filtered = messages.filter((message) => !message._isStreaming);
  return filtered.length === messages.length ? messages : filtered;
}

function isEmptyAssistantContent(message: Message): boolean {
  if (message.type !== "assistant") {
    return false;
  }

  const content = message.message?.content;
  if (typeof content === "string") {
    return content.trim().length === 0;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.every((block) => {
    if (!block || typeof block !== "object") {
      return true;
    }

    const typedBlock = block as Record<string, unknown>;
    if (typedBlock.type === "text") {
      return (
        typeof typedBlock.text !== "string" || typedBlock.text.trim() === ""
      );
    }
    if (typedBlock.type === "thinking") {
      return (
        typeof typedBlock.thinking !== "string" ||
        typedBlock.thinking.trim() === ""
      );
    }
    return false;
  });
}

function createSessionLoadProgress(
  stage: SessionLoadProgressStage,
  details: Omit<SessionLoadProgress, "stage" | "updatedAtMs"> = {},
): SessionLoadProgress {
  return {
    stage,
    ...details,
    updatedAtMs: Date.now(),
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function yieldForSessionLoadingProgressPaint(
  enabled: boolean | undefined,
): Promise<void> {
  if (!enabled) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}

function tagJsonlMessages(messages: Message[]): Message[] {
  return messages.map((m) => ({
    ...m,
    _source: "jsonl" as const,
  }));
}

function mergePersistedMessagesForProvider(
  baseMessages: Message[],
  taggedMessages: Message[],
  provider: string | undefined,
): Message[] {
  const result = mergeJSONLMessages(baseMessages, taggedMessages, {
    skipDagOrdering: !getProvider(provider).capabilities.supportsDag,
  });
  return usesApproxMessageDedup(provider)
    ? reconcileLinearMessages(result.messages, approxDedupOptions(provider))
    : result.messages;
}

/**
 * Hook for managing session messages with stream buffering.
 *
 * Handles:
 * - Initial REST load of messages
 * - Buffering stream messages until initial load completes
 * - Merging stream and JSONL messages
 * - Routing subagent messages to agentContent
 */
export function useSessionMessages(
  options: UseSessionMessagesOptions,
): UseSessionMessagesResult {
  const {
    projectId,
    sessionId,
    tailTurns,
    tailFrom,
    detailedLoadingProgress,
    onLoadComplete,
    onLoadError,
  } = options;
  const sourceKey = useClientSummarySourceKey();
  const snapshotKey: SessionRouteSnapshotKeyInput = {
    sourceKey,
    projectId,
    sessionId,
    tailTurns,
    tailFrom,
  };
  const snapshotKeyString = getSessionRouteSnapshotKey(snapshotKey);
  const cachedLoadRef = useRef<{
    key: string;
    load: SessionRouteSnapshot | undefined;
  } | null>(null);
  if (cachedLoadRef.current?.key !== snapshotKeyString) {
    cachedLoadRef.current = {
      key: snapshotKeyString,
      load: readSessionLoadCache(
        sourceKey,
        projectId,
        sessionId,
        tailTurns,
        tailFrom,
      ),
    };
  }
  const cachedLoad = cachedLoadRef.current.load;

  // Core state
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentContent, setAgentContent] = useState<AgentContentMap>({});
  const [toolUseToAgent, setToolUseToAgent] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [sessionLoadProgress, setSessionLoadProgress] =
    useState<SessionLoadProgress>(() => createSessionLoadProgress("idle"));
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | undefined>(
    undefined,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollSnapshotRef = useRef<SessionRouteScrollSnapshot | undefined>(
    cachedLoad?.scrollSnapshot,
  );
  const latestSnapshotRef = useRef<SessionRouteSnapshot | null>(null);
  const sessionDetailShadowRef = useRef<SessionDetailState>(
    createInitialSessionDetailState(),
  );
  const dispatchSessionDetailShadowAction = useCallback(
    (action: SessionDetailAction) => {
      sessionDetailShadowRef.current = reduceSessionDetailState(
        sessionDetailShadowRef.current,
        action,
      );
    },
    [],
  );
  const dispatchSessionDetailAction = useCallback(
    (action: SessionDetailAction) => {
      dispatchSessionDetailShadowAction(action);
      if (action.type === "patchScrollSnapshot") {
        defaultSessionDetailStore.patchScrollSnapshot(
          { sourceKey, projectId, sessionId, tailTurns, tailFrom },
          action.scrollSnapshot,
        );
        return;
      }
      defaultSessionDetailStore.dispatch(
        { sourceKey, projectId, sessionId, tailTurns, tailFrom },
        action,
      );
    },
    [
      sourceKey,
      projectId,
      sessionId,
      tailTurns,
      tailFrom,
      dispatchSessionDetailShadowAction,
    ],
  );
  const resetSessionDetailState = useCallback(
    (snapshot?: SessionRouteSnapshot) => {
      const initial = createInitialSessionDetailState();
      if (snapshot) {
        const action = createRestoreRouteSnapshotAction(snapshot);
        sessionDetailShadowRef.current = reduceSessionDetailState(
          initial,
          action,
        );
        defaultSessionDetailStore.writeRouteSnapshot(
          { sourceKey, projectId, sessionId, tailTurns, tailFrom },
          snapshot,
        );
        return;
      }
      sessionDetailShadowRef.current = initial;
      defaultSessionDetailStore.deleteEntry({
        sourceKey,
        projectId,
        sessionId,
        tailTurns,
        tailFrom,
      });
    },
    [sourceKey, projectId, sessionId, tailTurns, tailFrom],
  );

  // Track provider for DAG ordering decisions
  const providerRef = useRef<string | undefined>(undefined);

  // Track last message ID for incremental fetching
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  // Highest timestamp observed from persisted JSONL messages.
  // Used to suppress startup replay events that are already on disk.
  const maxPersistedTimestampMsRef = useRef<number>(Number.NEGATIVE_INFINITY);

  const reportShadowDivergence = useCallback(
    (
      boundary: string,
      livePatch: Partial<SessionDetailRuntimeStateInput> = {},
    ) => {
      if (!isSessionDetailShadowDiagnosticsEnabled()) {
        return;
      }
      const snapshot = latestSnapshotRef.current;
      const liveSession = livePatch.session ?? snapshot?.session ?? null;
      const live: SessionDetailRuntimeStateInput = {
        messages: livePatch.messages ?? snapshot?.messages ?? [],
        session: liveSession,
        pagination: livePatch.pagination ?? snapshot?.pagination,
        agentContent: livePatch.agentContent ?? snapshot?.agentContent ?? {},
        toolUseToAgentEntries:
          livePatch.toolUseToAgentEntries ??
          snapshot?.toolUseToAgentEntries ??
          [],
        lastMessageId: livePatch.lastMessageId ?? lastMessageIdRef.current,
        maxPersistedTimestampMs:
          livePatch.maxPersistedTimestampMs ??
          maxPersistedTimestampMsRef.current,
        scrollSnapshot: livePatch.scrollSnapshot ?? snapshot?.scrollSnapshot,
      };
      reportSessionDetailShadowDivergence({
        boundary,
        projectId,
        sessionId,
        provider: liveSession?.provider ?? providerRef.current,
        live,
        shadow: sessionDetailShadowRef.current,
      });
      const store = defaultSessionDetailStore.readSelected(
        { sourceKey, projectId, sessionId, tailTurns, tailFrom },
        selectSessionDetailRuntimeSnapshot,
      );
      if (store) {
        reportSessionDetailStoreDivergence({
          boundary,
          projectId,
          sessionId,
          provider: liveSession?.provider ?? providerRef.current,
          live,
          store,
        });
      }
    },
    [sourceKey, projectId, sessionId, tailTurns, tailFrom],
  );

  // Buffering: queue stream messages until initial load completes
  const streamBufferRef = useRef<
    Array<
      | { type: "message"; msg: Message }
      | { type: "subagent"; msg: Message; agentId: string }
    >
  >([]);
  const initialLoadCompleteRef = useRef(false);

  const updatePersistedTimestampWatermark = useCallback(
    (persistedMessages: Message[]) => {
      let maxMs = maxPersistedTimestampMsRef.current;
      for (const message of persistedMessages) {
        if (isDurableRecapOverlay(message)) {
          continue;
        }
        const ts = getMessageTimestampMs(message);
        if (ts !== null && ts > maxMs) {
          maxMs = ts;
        }
      }
      maxPersistedTimestampMsRef.current = maxMs;
    },
    [],
  );

  // Update lastMessageIdRef when messages change.
  // Cursor on the newest JSONL-sourced row, not the array tail (see
  // findLastJsonlMessageId).
  useEffect(() => {
    const lastJsonlId = findLastJsonlMessageId(messages);
    if (lastJsonlId) {
      lastMessageIdRef.current = lastJsonlId;
    }
  }, [messages]);

  useEffect(() => {
    if (!session) {
      latestSnapshotRef.current = null;
      return;
    }
    latestSnapshotRef.current = {
      messages,
      session,
      pagination,
      agentContent,
      toolUseToAgentEntries: Array.from(toolUseToAgent.entries()),
      lastMessageId: lastMessageIdRef.current,
      maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
      scrollSnapshot: scrollSnapshotRef.current,
    };
  }, [agentContent, messages, pagination, session, toolUseToAgent]);

  useEffect(() => {
    return () => {
      const snapshot = latestSnapshotRef.current;
      if (snapshot && getSessionTranscriptCacheEnabled()) {
        writeSessionLoadCache(
          sourceKey,
          projectId,
          sessionId,
          {
            ...snapshot,
            scrollSnapshot: scrollSnapshotRef.current,
          },
          tailTurns,
          tailFrom,
        );
        return;
      }
      defaultSessionDetailStore.deleteEntry({
        sourceKey,
        projectId,
        sessionId,
        tailTurns,
        tailFrom,
      });
    };
  }, [sourceKey, projectId, sessionId, tailTurns, tailFrom]);

  // Process a stream message event.
  // When replaying buffered startup events for Codex, suppress entries that are
  // semantically identical to already-loaded JSONL messages but have different UUIDs.
  const processStreamMessage = useCallback(
    (incoming: Message, fromBufferedReplay = false) => {
      const provider = providerRef.current;
      const streamingEnabled = getStreamingEnabled();
      const isReplay = incoming.isReplay === true;
      const shouldApplyReplayDedupe =
        (fromBufferedReplay || isReplay) && usesApproxMessageDedup(provider);
      const incomingTimestampMs = getMessageTimestampMs(incoming);
      const isPersistedReplay =
        isReplay &&
        incomingTimestampMs !== null &&
        incomingTimestampMs <= maxPersistedTimestampMsRef.current;
      const suppressStreaming =
        incoming._isStreaming === true && !streamingEnabled;

      dispatchSessionDetailAction(
        createStreamMessageAction(incoming, {
          fromBufferedReplay,
          streamingEnabled,
        }),
      );

      setMessages((prev) => {
        let nextMessages = prev;
        if (suppressStreaming) {
          nextMessages = clearStreamingMessages(prev);
        } else if (!isPersistedReplay) {
          if (shouldApplyReplayDedupe) {
            if (isEmptyAssistantContent(incoming)) {
              reportShadowDivergence("stream-message", {
                messages: nextMessages,
              });
              return nextMessages;
            }
            if (
              hasEquivalentJsonlMessage(
                prev,
                incoming,
                approxDedupOptions(provider),
              )
            ) {
              reportShadowDivergence("stream-message", {
                messages: nextMessages,
              });
              return nextMessages;
            }
          }

          const result = mergeStreamMessage(prev, incoming);
          nextMessages = usesApproxMessageDedup(provider)
            ? reconcileLinearMessages(
                result.messages,
                approxDedupOptions(provider),
              )
            : result.messages;
        }

        reportShadowDivergence("stream-message", {
          messages: nextMessages,
        });
        return nextMessages;
      });
    },
    [dispatchSessionDetailAction, reportShadowDivergence],
  );

  // Process a buffered stream subagent message
  const processStreamSubagentMessage = useCallback(
    (incoming: Message, agentId: string) => {
      const streamingEnabled = getStreamingEnabled();
      dispatchSessionDetailAction(
        createStreamSubagentMessageAction(agentId, incoming, {
          streamingEnabled,
        }),
      );
      setAgentContent((prev) => {
        const existing = prev[agentId] ?? {
          messages: [],
          status: "running" as const,
        };
        if (incoming._isStreaming === true && !streamingEnabled) {
          const messages = clearStreamingMessages(existing.messages);
          if (messages === existing.messages) {
            reportShadowDivergence("stream-subagent-message", {
              agentContent: prev,
            });
            return prev;
          }
          if (messages.length === 0 && existing.contextUsage === undefined) {
            const next = { ...prev };
            delete next[agentId];
            reportShadowDivergence("stream-subagent-message", {
              agentContent: next,
            });
            return next;
          }
          const next: AgentContentMap = {
            ...prev,
            [agentId]: {
              ...existing,
              messages,
            },
          };
          reportShadowDivergence("stream-subagent-message", {
            agentContent: next,
          });
          return next;
        }
        const incomingId = getMessageId(incoming);
        if (findMessageIndexById(existing.messages, incomingId) !== -1) {
          reportShadowDivergence("stream-subagent-message", {
            agentContent: prev,
          });
          return prev;
        }
        const next: AgentContentMap = {
          ...prev,
          [agentId]: {
            ...existing,
            messages: [...existing.messages, incoming],
            status: "running" as const,
          },
        };
        reportShadowDivergence("stream-subagent-message", {
          agentContent: next,
        });
        return next;
      });
    },
    [dispatchSessionDetailAction, reportShadowDivergence],
  );

  // Flush buffered stream messages after initial load
  const flushBuffer = useCallback(() => {
    const buffer = streamBufferRef.current;
    streamBufferRef.current = [];
    for (const item of buffer) {
      if (item.type === "message") {
        processStreamMessage(item.msg, true);
      } else {
        processStreamSubagentMessage(item.msg, item.agentId);
      }
    }
  }, [processStreamMessage, processStreamSubagentMessage]);

  // Initial load. When a warm in-tab cache exists, the REST request is an
  // incremental refresh after the cached tail; merge that delta instead of
  // replacing the cached transcript.
  useEffect(() => {
    let cancelled = false;
    let warmHydrated = false;
    let pendingWarmData: Awaited<ReturnType<typeof api.getSession>> | null =
      null;
    let pendingWarmError: Error | null = null;
    const warmLoad = readSessionLoadCache(
      sourceKey,
      projectId,
      sessionId,
      tailTurns,
      tailFrom,
    );

    const notifyLoadComplete = (
      data: Awaited<ReturnType<typeof api.getSession>>,
    ) => {
      onLoadComplete?.({
        session: data.session,
        status: data.ownership,
        pendingInputRequest: data.pendingInputRequest,
        slashCommands: data.slashCommands,
        deferredMessages: data.deferredMessages,
      });
    };

    const finishWarmHydration = (options: {
      loadedMessages: Message[];
      loadedSession: SessionMetadata;
      loadedPagination?: PaginationInfo;
      sourceMessageCount: number;
      provider?: string;
      diagnosticBoundary: string;
    }) => {
      const lastJsonlId = findLastJsonlMessageId(options.loadedMessages);
      if (lastJsonlId) {
        lastMessageIdRef.current = lastJsonlId;
      }

      setAgentContent(warmLoad?.agentContent ?? {});
      setToolUseToAgent(new Map(warmLoad?.toolUseToAgentEntries ?? []));
      setSession(options.loadedSession);
      setMessages(options.loadedMessages);
      setPagination(options.loadedPagination);
      markReloadPerfPhase("session_initial_messages_state_queued", {
        messages: options.sourceMessageCount,
        totalMessages: options.loadedMessages.length,
        provider: options.provider,
        restoredFromSnapshot: true,
      });
      reportShadowDivergence(options.diagnosticBoundary, {
        messages: options.loadedMessages,
        session: options.loadedSession,
        pagination: options.loadedPagination,
        agentContent: warmLoad?.agentContent ?? {},
        toolUseToAgentEntries: warmLoad?.toolUseToAgentEntries ?? [],
        lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
        maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
        scrollSnapshot: scrollSnapshotRef.current,
      });

      initialLoadCompleteRef.current = true;
      flushBuffer();

      setLoading(false);
      setSessionLoadProgress(
        createSessionLoadProgress("complete", {
          messageCount: options.loadedMessages.length,
          totalMessageCount: options.loadedPagination?.totalMessageCount,
          hasOlderMessages: options.loadedPagination?.hasOlderMessages,
        }),
      );
      markReloadPerfPhase("session_initial_load_complete", {
        messages: options.sourceMessageCount,
        restoredFromSnapshot: true,
      });
    };

    const applyWarmDataBeforeHydration = (
      data: Awaited<ReturnType<typeof api.getSession>>,
    ) => {
      if (!warmLoad) return;
      markReloadPerfPhase("session_initial_load_data_ready", {
        messages: data.messages.length,
        provider: data.session.provider,
        totalMessages: data.pagination?.totalMessageCount,
        hasOlderMessages: data.pagination?.hasOlderMessages,
        restoredFromSnapshot: true,
      });
      providerRef.current = data.session.provider;
      setSessionLoadProgress(
        createSessionLoadProgress("loaded", {
          messageCount: data.messages.length,
          totalMessageCount: data.pagination?.totalMessageCount,
          hasOlderMessages: data.pagination?.hasOlderMessages,
        }),
      );
      setSessionLoadProgress(
        createSessionLoadProgress("preparing", {
          messageCount: data.messages.length,
          totalMessageCount: data.pagination?.totalMessageCount,
          hasOlderMessages: data.pagination?.hasOlderMessages,
        }),
      );
      const taggedMessages = tagJsonlMessages(data.messages);
      updatePersistedTimestampWatermark(taggedMessages);
      const loadedMessages = warmLoad.lastMessageId
        ? mergePersistedMessagesForProvider(
            warmLoad.messages,
            taggedMessages,
            data.session.provider,
          )
        : usesApproxMessageDedup(data.session.provider)
          ? reconcileLinearMessages(
              taggedMessages,
              approxDedupOptions(data.session.provider),
            )
          : taggedMessages;
      const nextPagination = data.pagination ?? warmLoad.pagination;
      dispatchSessionDetailAction(
        createCatchupMessagesAction({
          session: data.session,
          messages: data.messages,
          pagination: nextPagination,
        }),
      );
      setSessionLoadProgress(
        createSessionLoadProgress("rendering", {
          messageCount: loadedMessages.length,
          totalMessageCount: nextPagination?.totalMessageCount,
          hasOlderMessages: nextPagination?.hasOlderMessages,
        }),
      );
      finishWarmHydration({
        loadedMessages,
        loadedSession: data.session,
        loadedPagination: nextPagination,
        sourceMessageCount: taggedMessages.length,
        provider: data.session.provider,
        diagnosticBoundary: "warm-catchup-before-hydration",
      });
      writeSessionLoadCache(
        sourceKey,
        projectId,
        sessionId,
        {
          messages: loadedMessages,
          session: data.session,
          pagination: nextPagination,
          agentContent: warmLoad.agentContent,
          toolUseToAgentEntries: warmLoad.toolUseToAgentEntries,
          lastMessageId: lastMessageIdRef.current,
          maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
          scrollSnapshot: scrollSnapshotRef.current,
        },
        tailTurns,
        tailFrom,
      );
      notifyLoadComplete(data);
    };

    const applyWarmDeltaAfterHydration = (
      data: Awaited<ReturnType<typeof api.getSession>>,
    ) => {
      if (!warmLoad) return;
      markReloadPerfPhase("session_initial_load_data_ready", {
        messages: data.messages.length,
        provider: data.session.provider,
        totalMessages: data.pagination?.totalMessageCount,
        hasOlderMessages: data.pagination?.hasOlderMessages,
        restoredFromSnapshot: true,
        appliedAfterSnapshotHydration: true,
      });
      providerRef.current = data.session.provider;
      setSession(data.session);
      const taggedMessages = tagJsonlMessages(data.messages);
      updatePersistedTimestampWatermark(taggedMessages);
      const nextPagination = data.pagination ?? warmLoad.pagination;
      dispatchSessionDetailAction(
        createCatchupMessagesAction({
          session: data.session,
          messages: data.messages,
          pagination: nextPagination,
        }),
      );
      setMessages((prev) => {
        const baseMessages = prev.length > 0 ? prev : warmLoad.messages;
        const loadedMessages = mergePersistedMessagesForProvider(
          baseMessages,
          taggedMessages,
          data.session.provider,
        );
        const lastJsonlId = findLastJsonlMessageId(loadedMessages);
        if (lastJsonlId) {
          lastMessageIdRef.current = lastJsonlId;
        }
        reportShadowDivergence("warm-catchup-after-hydration", {
          messages: loadedMessages,
          session: data.session,
          pagination: nextPagination,
          agentContent:
            latestSnapshotRef.current?.agentContent ??
            warmLoad.agentContent ??
            {},
          toolUseToAgentEntries:
            latestSnapshotRef.current?.toolUseToAgentEntries ??
            warmLoad.toolUseToAgentEntries ??
            [],
          lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
          maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
          scrollSnapshot: scrollSnapshotRef.current,
        });
        return loadedMessages;
      });
      setPagination(nextPagination);
      setSessionLoadProgress(
        createSessionLoadProgress("complete", {
          messageCount: nextPagination?.returnedMessageCount,
          totalMessageCount: nextPagination?.totalMessageCount,
          hasOlderMessages: nextPagination?.hasOlderMessages,
        }),
      );
      notifyLoadComplete(data);
    };

    markReloadPerfPhase("session_initial_load_start", {
      projectId,
      sessionId,
      tailCompactions: 2,
      tailTurns,
      tailFrom,
      restoredFromSnapshot: Boolean(warmLoad),
    });
    initialLoadCompleteRef.current = false;
    streamBufferRef.current = [];
    scrollSnapshotRef.current = warmLoad?.scrollSnapshot;
    if (warmLoad) {
      resetSessionDetailState(warmLoad);
      setSessionLoadProgress(
        createSessionLoadProgress("fetching", {
          messageCount: warmLoad.messages.length,
          totalMessageCount: warmLoad.pagination?.totalMessageCount,
          hasOlderMessages: warmLoad.pagination?.hasOlderMessages,
        }),
      );
      maxPersistedTimestampMsRef.current = warmLoad.maxPersistedTimestampMs;
      providerRef.current = warmLoad.session.provider;
      lastMessageIdRef.current = warmLoad.lastMessageId;
      setLoading(true);
      setMessages([]);
      setAgentContent({});
      setToolUseToAgent(new Map());
      setSession(null);
      setPagination(undefined);
      void (async () => {
        setSessionLoadProgress(
          createSessionLoadProgress("rendering", {
            messageCount: warmLoad.messages.length,
            totalMessageCount: warmLoad.pagination?.totalMessageCount,
            hasOlderMessages: warmLoad.pagination?.hasOlderMessages,
          }),
        );
        await yieldForSessionLoadingProgressPaint(true);
        if (cancelled) return;
        warmHydrated = true;
        if (pendingWarmData) {
          applyWarmDataBeforeHydration(pendingWarmData);
          return;
        }
        finishWarmHydration({
          loadedMessages: warmLoad.messages,
          loadedSession: warmLoad.session,
          loadedPagination: warmLoad.pagination,
          sourceMessageCount: warmLoad.messages.length,
          provider: warmLoad.session.provider,
          diagnosticBoundary: "warm-route-snapshot",
        });
        if (pendingWarmError) {
          onLoadError?.(pendingWarmError);
        }
      })();
    } else {
      setSessionLoadProgress(createSessionLoadProgress("fetching"));
      resetSessionDetailState();
      maxPersistedTimestampMsRef.current = Number.NEGATIVE_INFINITY;
      providerRef.current = undefined;
      lastMessageIdRef.current = undefined;
      setLoading(true);
      setAgentContent({});
      setToolUseToAgent(new Map());
      setSession(null);
      setPagination(undefined);
    }

    api
      .getSession(projectId, sessionId, lastMessageIdRef.current, {
        tailCompactions: 2,
        tailTurns,
        tailFrom,
      })
      .then(async (data) => {
        if (cancelled) return;
        if (warmLoad) {
          if (!warmHydrated) {
            pendingWarmData = data;
            return;
          }
          applyWarmDeltaAfterHydration(data);
          return;
        }
        markReloadPerfPhase("session_initial_load_data_ready", {
          messages: data.messages.length,
          provider: data.session.provider,
          totalMessages: data.pagination?.totalMessageCount,
          hasOlderMessages: data.pagination?.hasOlderMessages,
        });
        setSessionLoadProgress(
          createSessionLoadProgress("loaded", {
            messageCount: data.messages.length,
            totalMessageCount: data.pagination?.totalMessageCount,
            hasOlderMessages: data.pagination?.hasOlderMessages,
          }),
        );
        setSession(data.session);
        providerRef.current = data.session.provider;

        // Tag messages from JSONL as authoritative
        setSessionLoadProgress(
          createSessionLoadProgress("preparing", {
            messageCount: data.messages.length,
            totalMessageCount: data.pagination?.totalMessageCount,
            hasOlderMessages: data.pagination?.hasOlderMessages,
          }),
        );
        const taggedMessages = tagJsonlMessages(data.messages);
        updatePersistedTimestampWatermark(taggedMessages);
        const loadedMessages = usesApproxMessageDedup(data.session.provider)
          ? reconcileLinearMessages(
              taggedMessages,
              approxDedupOptions(data.session.provider),
            )
          : taggedMessages;
        setSessionLoadProgress(
          createSessionLoadProgress("rendering", {
            messageCount: loadedMessages.length,
            totalMessageCount: data.pagination?.totalMessageCount,
            hasOlderMessages: data.pagination?.hasOlderMessages,
          }),
        );
        await yieldForSessionLoadingProgressPaint(detailedLoadingProgress);
        if (cancelled) return;
        // Update lastMessageIdRef synchronously to avoid race condition:
        // stream "connected" event calls fetchNewMessages() immediately, but the
        // useEffect that normally updates lastMessageIdRef runs asynchronously.
        // Without this, fetchNewMessages() would use undefined and refetch everything.
        const lastJsonlId = findLastJsonlMessageId(loadedMessages);
        if (lastJsonlId) {
          lastMessageIdRef.current = lastJsonlId;
        }

        const nextPagination = data.pagination;
        dispatchSessionDetailAction(
          createLoadPersistedTranscriptAction({
            session: data.session,
            messages: data.messages,
            pagination: nextPagination,
          }),
        );
        const revealInitialTranscript = () => {
          setMessages(loadedMessages);
          setPagination(nextPagination);
          markReloadPerfPhase("session_initial_messages_state_queued", {
            messages: taggedMessages.length,
            totalMessages: loadedMessages.length,
            provider: data.session.provider,
          });
          reportShadowDivergence("initial-load", {
            messages: loadedMessages,
            session: data.session,
            pagination: nextPagination,
            agentContent: {},
            toolUseToAgentEntries: [],
            lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
            maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
            scrollSnapshot: scrollSnapshotRef.current,
          });

          // Mark ready and flush buffer after the REST snapshot has been queued
          // so buffered stream events merge on top of the loaded transcript.
          initialLoadCompleteRef.current = true;
          flushBuffer();

          setLoading(false);
          setSessionLoadProgress(
            createSessionLoadProgress("complete", {
              messageCount: loadedMessages.length,
              totalMessageCount: data.pagination?.totalMessageCount,
              hasOlderMessages: data.pagination?.hasOlderMessages,
            }),
          );
          markReloadPerfPhase("session_initial_load_complete", {
            messages: taggedMessages.length,
          });
        };

        revealInitialTranscript();

        writeSessionLoadCache(
          sourceKey,
          projectId,
          sessionId,
          {
            messages: loadedMessages,
            session: data.session,
            pagination: data.pagination,
            agentContent: {},
            toolUseToAgentEntries: [],
            lastMessageId: lastMessageIdRef.current,
            maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
            scrollSnapshot: scrollSnapshotRef.current,
          },
          tailTurns,
          tailFrom,
        );

        // Notify parent
        onLoadComplete?.({
          session: data.session,
          status: data.ownership,
          pendingInputRequest: data.pendingInputRequest,
          slashCommands: data.slashCommands,
          deferredMessages: data.deferredMessages,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (warmLoad) {
          const error = toError(err);
          markReloadPerfPhase("session_initial_load_error", {
            message: error.message,
            restoredFromSnapshot: true,
          });
          if (!warmHydrated) {
            pendingWarmError = error;
            return;
          }
          onLoadError?.(error);
          return;
        }
        markReloadPerfPhase("session_initial_load_error", {
          message: err instanceof Error ? err.message : String(err),
        });
        setSessionLoadProgress(createSessionLoadProgress("error"));
        setLoading(false);
        onLoadError?.(err);
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    sessionId,
    sourceKey,
    tailTurns,
    tailFrom,
    detailedLoadingProgress,
    onLoadComplete,
    onLoadError,
    flushBuffer,
    updatePersistedTimestampWatermark,
    resetSessionDetailState,
    dispatchSessionDetailAction,
    reportShadowDivergence,
  ]);

  // Handle streaming content updates (from useStreamingContent)
  const handleStreamingUpdate = useCallback(
    (streamingMessage: Message, agentId?: string) => {
      const messageId = getMessageId(streamingMessage);
      if (!messageId) return;

      if (agentId) {
        // Route to agentContent
        setAgentContent((prev) => {
          const existing = prev[agentId] ?? {
            messages: [],
            status: "running" as const,
          };
          const existingIdx = findMessageIndexById(
            existing.messages,
            messageId,
          );

          if (existingIdx >= 0) {
            const updated = [...existing.messages];
            updated[existingIdx] = streamingMessage;
            return { ...prev, [agentId]: { ...existing, messages: updated } };
          }
          return {
            ...prev,
            [agentId]: {
              ...existing,
              messages: [...existing.messages, streamingMessage],
            },
          };
        });
        return;
      }

      // Route to main messages
      setMessages((prev) => {
        const existingIdx = findMessageIndexById(prev, messageId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = streamingMessage;
          return updated;
        }
        return [...prev, streamingMessage];
      });
    },
    [],
  );

  // Handle stream message event (with buffering)
  const handleStreamMessageEvent = useCallback(
    (incoming: Message) => {
      if (!initialLoadCompleteRef.current) {
        streamBufferRef.current.push({ type: "message", msg: incoming });
        return;
      }
      processStreamMessage(incoming);
    },
    [processStreamMessage],
  );

  // Handle stream subagent message event (with buffering)
  const handleStreamSubagentMessage = useCallback(
    (incoming: Message, agentId: string) => {
      if (!initialLoadCompleteRef.current) {
        streamBufferRef.current.push({
          type: "subagent",
          msg: incoming,
          agentId,
        });
        return;
      }
      processStreamSubagentMessage(incoming, agentId);
    },
    [processStreamSubagentMessage],
  );

  // Register toolUse → agent mapping
  const registerToolUseAgent = useCallback(
    (toolUseId: string, agentId: string) => {
      dispatchSessionDetailAction(
        createRegisterToolUseAgentAction(toolUseId, agentId),
      );
      setToolUseToAgent((prev) => {
        if (prev.has(toolUseId)) {
          reportShadowDivergence("tool-use-agent-map", {
            toolUseToAgentEntries: Array.from(prev.entries()),
          });
          return prev;
        }
        const next = new Map(prev);
        next.set(toolUseId, agentId);
        reportShadowDivergence("tool-use-agent-map", {
          toolUseToAgentEntries: Array.from(next.entries()),
        });
        return next;
      });
    },
    [dispatchSessionDetailAction, reportShadowDivergence],
  );

  const mergeLoadedAgentContent = useCallback(
    (agentId: string, content: AgentContent) => {
      dispatchSessionDetailAction(
        createMergeLoadedAgentContentAction(agentId, content),
      );
      setAgentContent((prev) => {
        const next = mergeLoadedAgentContentMap(prev, agentId, content);
        reportShadowDivergence("loaded-agent-content", {
          agentContent: next,
        });
        return next;
      });
    },
    [dispatchSessionDetailAction, reportShadowDivergence],
  );

  const updateAgentContextUsage = useCallback(
    (agentId: string, contextUsage: AgentContextUsage) => {
      dispatchSessionDetailAction(
        createUpdateAgentContextUsageAction(agentId, contextUsage),
      );
      setAgentContent((prev) => {
        const next = updateAgentContextUsageMap(prev, agentId, contextUsage);
        reportShadowDivergence("agent-context-usage", {
          agentContent: next,
        });
        return next;
      });
    },
    [dispatchSessionDetailAction, reportShadowDivergence],
  );

  const clearAgentStreamingPlaceholders = useCallback(
    (agentId: string) => {
      dispatchSessionDetailAction(
        createClearAgentStreamingPlaceholdersAction(agentId),
      );
      setAgentContent((prev) => {
        const next = clearAgentStreamingPlaceholdersMap(prev, agentId);
        reportShadowDivergence("agent-streaming-placeholder-cleanup", {
          agentContent: next,
        });
        return next;
      });
    },
    [dispatchSessionDetailAction, reportShadowDivergence],
  );

  const fetchNewMessagesInFlightRef = useRef<Promise<void> | null>(null);

  // Fetch new messages incrementally (for file change events)
  const fetchNewMessages = useCallback(() => {
    if (fetchNewMessagesInFlightRef.current) {
      return fetchNewMessagesInFlightRef.current;
    }

    const request = (async () => {
      try {
        const data = await api.getSession(
          projectId,
          sessionId,
          lastMessageIdRef.current,
        );
        if (data.messages.length > 0) {
          dispatchSessionDetailAction(
            createCatchupMessagesAction({
              session: data.session,
              messages: data.messages,
            }),
          );
          updatePersistedTimestampWatermark(data.messages);
          setMessages((prev) => {
            const result = mergeJSONLMessages(prev, data.messages, {
              skipDagOrdering: !getProvider(data.session.provider).capabilities
                .supportsDag,
            });
            const nextMessages = usesApproxMessageDedup(data.session.provider)
              ? reconcileLinearMessages(
                  result.messages,
                  approxDedupOptions(data.session.provider),
                )
              : result.messages;
            const lastJsonlId = findLastJsonlMessageId(nextMessages);
            if (lastJsonlId) {
              lastMessageIdRef.current = lastJsonlId;
            }
            reportShadowDivergence("catchup", {
              messages: nextMessages,
              session: data.session,
              lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
              maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
            });
            return nextMessages;
          });
        }
        // Update session metadata (including title, model, contextUsage) which may have changed
        // For new sessions, prev may be null if JSONL didn't exist on initial load
        setSession((prev) =>
          prev ? { ...prev, ...data.session } : data.session,
        );
      } catch {
        // Silent fail for incremental updates
      }
    })();

    fetchNewMessagesInFlightRef.current = request;
    void request.finally(() => {
      if (fetchNewMessagesInFlightRef.current === request) {
        fetchNewMessagesInFlightRef.current = null;
      }
    });

    return request;
  }, [
    projectId,
    sessionId,
    updatePersistedTimestampWatermark,
    dispatchSessionDetailAction,
    reportShadowDivergence,
  ]);

  const readSelectorBackedPagination = useCallback(
    () =>
      defaultSessionDetailStore.readSelected(
        { sourceKey, projectId, sessionId, tailTurns, tailFrom },
        selectSessionDetailPagination,
      ) ?? pagination,
    [sourceKey, projectId, sessionId, tailTurns, tailFrom, pagination],
  );

  // Load older messages (previous chunk before the current truncation point)
  const loadOlderMessages = useCallback(async () => {
    const currentPagination = readSelectorBackedPagination();
    if (
      !currentPagination?.hasOlderMessages ||
      !currentPagination.truncatedBeforeMessageId
    ) {
      return;
    }
    setLoadingOlder(true);
    try {
      const data = await api.getSession(projectId, sessionId, undefined, {
        tailCompactions: 2,
        beforeMessageId: currentPagination.truncatedBeforeMessageId,
      });
      dispatchSessionDetailAction(
        createPrependOlderMessagesAction({
          messages: data.messages,
          pagination: data.pagination,
        }),
      );
      setMessages((prev) => {
        const taggedOlder = data.messages.map((m) => ({
          ...m,
          _source: "jsonl" as const,
        }));
        updatePersistedTimestampWatermark(taggedOlder);
        const combined = [...taggedOlder, ...prev];
        const nextMessages = usesApproxMessageDedup(data.session.provider)
          ? reconcileLinearMessages(
              combined,
              approxDedupOptions(data.session.provider),
            )
          : combined;
        const lastJsonlId = findLastJsonlMessageId(nextMessages);
        if (lastJsonlId) {
          lastMessageIdRef.current = lastJsonlId;
        }
        reportShadowDivergence("older-page", {
          messages: nextMessages,
          session: data.session,
          pagination: data.pagination,
          lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
          maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
        });
        return nextMessages;
      });
      setPagination(data.pagination);
    } catch {
      // Silent fail for loading older messages
    } finally {
      setLoadingOlder(false);
    }
  }, [
    projectId,
    sessionId,
    readSelectorBackedPagination,
    updatePersistedTimestampWatermark,
    dispatchSessionDetailAction,
    reportShadowDivergence,
  ]);

  const updateRouteScrollSnapshot = useCallback(
    (snapshot: SessionRouteScrollSnapshot) => {
      scrollSnapshotRef.current = snapshot;
      dispatchSessionDetailAction({
        type: "patchScrollSnapshot",
        scrollSnapshot: snapshot,
      });
      if (getSessionTranscriptCacheEnabled()) {
        patchSessionRouteScrollSnapshot(snapshotKey, snapshot);
      }
      if (latestSnapshotRef.current) {
        latestSnapshotRef.current = {
          ...latestSnapshotRef.current,
          scrollSnapshot: snapshot,
        };
      }
      reportShadowDivergence("scroll-snapshot", {
        scrollSnapshot: snapshot,
      });
    },
    [
      sourceKey,
      projectId,
      sessionId,
      tailTurns,
      tailFrom,
      dispatchSessionDetailAction,
      reportShadowDivergence,
    ],
  );

  // Fetch session metadata only
  const fetchSessionMetadata = useCallback(async () => {
    try {
      const data = await api.getSessionMetadata(projectId, sessionId);
      const metadataSession = {
        ...data.session,
        ownership: data.ownership,
      };
      // For new sessions, prev may be null if JSONL didn't exist on initial load
      setSession((prev) =>
        prev ? { ...prev, ...metadataSession } : metadataSession,
      );
    } catch {
      // Silent fail for metadata updates
    }
  }, [projectId, sessionId]);
  const selectedInitialScrollSnapshot =
    defaultSessionDetailStore.readSelected(
      snapshotKey,
      selectSessionDetailScrollSnapshot,
    ) ??
    cachedLoad?.scrollSnapshot ??
    null;
  const selectedPagination =
    readSelectorBackedPagination();

  return {
    messages,
    agentContent,
    toolUseToAgent,
    loading,
    sessionLoadProgress,
    session,
    setSession,
    handleStreamingUpdate,
    handleStreamMessageEvent,
    handleStreamSubagentMessage,
    registerToolUseAgent,
    mergeLoadedAgentContent,
    updateAgentContextUsage,
    clearAgentStreamingPlaceholders,
    setAgentContent,
    setMessages,
    fetchNewMessages,
    fetchSessionMetadata,
    pagination: selectedPagination,
    loadingOlder,
    loadOlderMessages,
    initialScrollSnapshot: selectedInitialScrollSnapshot,
    updateRouteScrollSnapshot,
    restoredFromSnapshot: Boolean(cachedLoad),
  };
}
