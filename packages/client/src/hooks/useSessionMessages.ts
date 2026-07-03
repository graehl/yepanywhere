import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type DeferredQueueMessage,
  type PaginationInfo,
  api,
} from "../api/client";
import { getMessageTimestampMs } from "../lib/linearMessageDedup";
import {
  findLastJsonlMessageId,
  reconcilePersistedMessagesForProvider,
  tagJsonlMessages,
} from "../lib/sessionDetail/transcriptReducer";
import { getMessageId } from "../lib/mergeMessages";
import {
  prepareWarmRefreshAfterHydration,
  prepareWarmRefreshBeforeHydration,
} from "../lib/sessionDetail/warmRefresh";
import {
  buildSessionDetailRevealSnapshot,
  getCacheableSessionDetailRevealSnapshot,
  type SessionDetailRevealSnapshotFallback,
  type SessionDetailRevealSnapshotResult,
} from "../lib/sessionDetail/revealSnapshot";
import {
  createSessionLoadProgress,
  createSessionLoadProgressForWindow,
  type SessionLoadProgress,
  type SessionLoadProgressStage,
} from "../lib/sessionDetail/loadProgress";
import {
  bufferSessionDetailStreamMessage,
  bufferSessionDetailStreamSubagentMessage,
  createSessionDetailStreamBuffer,
  drainSessionDetailStreamBuffer,
  resetSessionDetailStreamBuffer,
  type SessionDetailStreamBuffer,
} from "../lib/sessionDetail/streamBuffer";
import { markReloadPerfPhase } from "../lib/diagnostics/reloadPerfProbe";
import {
  getSessionTranscriptCacheEnabled,
  recordLastSessionTranscriptBytes,
} from "./useSessionPerformanceSettings";
import { getStreamingEnabled } from "./useStreamingEnabled";
import type { Message, SessionMetadata, SessionStatus } from "../types";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import {
  isSessionDetailShadowDiagnosticsEnabled,
  reportSessionDetailStoreDivergence,
  type SessionDetailRuntimeStateInput,
} from "../lib/sessionDetail/shadowDiagnostics";
import {
  selectSessionDetailAgentContent,
  selectSessionDetailMessages,
  selectSessionDetailPagination,
  selectSessionDetailRuntimeSnapshot,
  selectSessionDetailScrollSnapshot,
  selectSessionDetailToolUseToAgentEntries,
} from "../lib/sessionDetail/selectors";
import {
  defaultSessionDetailStore,
  getSessionDetailEntryKey,
  type SessionDetailEntryKeyInput,
} from "../lib/sessionDetail/sessionDetailStore";
import type {
  AgentContextUsage,
  SessionDetailAction,
  SessionDetailState,
} from "../lib/sessionDetail/types";
import type {
  SessionRouteScrollSnapshot,
  SessionRouteSnapshot,
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

export type SessionMetadataUpdate =
  | SessionMetadata
  | null
  | ((previous: SessionMetadata | null) => SessionMetadata | null);

export type { SessionLoadProgress, SessionLoadProgressStage };

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
  /** Apply session metadata updates through the session detail action layer */
  updateSession: (update: SessionMetadataUpdate) => void;
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
  /** Remove transient streaming placeholder rows from the main transcript */
  clearStreamingPlaceholders: () => void;
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

const EMPTY_RETURNED_MESSAGES: Message[] = [];
const EMPTY_RETURNED_AGENT_CONTENT: AgentContentMap = {};

interface ReturnedDetailStoreState {
  messages: Message[];
  agentContent: AgentContentMap;
  toolUseToAgentEntries: Array<[string, string]>;
}

function readSessionLoadCache(
  input: SessionDetailEntryKeyInput,
): SessionRouteSnapshot | undefined {
  if (!getSessionTranscriptCacheEnabled() || typeof window === "undefined") {
    return undefined;
  }
  return defaultSessionDetailStore.readRouteSnapshot(input);
}

function writeSessionLoadCache(
  input: SessionDetailEntryKeyInput,
  entry: SessionRouteSnapshot,
): boolean {
  if (!getSessionTranscriptCacheEnabled() || typeof window === "undefined") {
    return false;
  }
  return defaultSessionDetailStore.writeRouteSnapshot(input, entry);
}

export function __resetSessionLoadCacheForTest(): void {
  defaultSessionDetailStore.clear();
}

function isDurableRecapOverlay(message: Message): boolean {
  return typeof message.yaRecapSource === "string";
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
  const snapshotKey: SessionDetailEntryKeyInput = useMemo(
    () => ({
      sourceKey,
      projectId,
      sessionId,
      tailTurns,
      tailFrom,
    }),
    [projectId, sessionId, sourceKey, tailFrom, tailTurns],
  );
  const snapshotKeyString = getSessionDetailEntryKey(snapshotKey);
  const cachedLoadRef = useRef<{
    key: string;
    load: SessionRouteSnapshot | undefined;
  } | null>(null);
  if (cachedLoadRef.current?.key !== snapshotKeyString) {
    cachedLoadRef.current = {
      key: snapshotKeyString,
      load: readSessionLoadCache(snapshotKey),
    };
  }
  const cachedLoad = cachedLoadRef.current.load;

  // Core state
  const [loading, setLoading] = useState(true);
  const [revealedSnapshotKey, setRevealedSnapshotKey] = useState<string | null>(
    null,
  );
  const [sessionLoadProgress, setSessionLoadProgress] =
    useState<SessionLoadProgress>(() => createSessionLoadProgress("idle"));
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | undefined>(
    undefined,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);

  // State updaters must stay pure (React may replay them mid-render), so
  // store dispatches and divergence reports cannot live inside setState
  // callbacks. Session/pagination still write local state directly; returned
  // transcript data comes from the store after reveal.
  const sessionRef = useRef<SessionMetadata | null>(null);
  const paginationRef = useRef<PaginationInfo | undefined>(undefined);
  const applySession = useCallback((next: SessionMetadata | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);
  const applyPagination = useCallback((next: PaginationInfo | undefined) => {
    paginationRef.current = next;
    setPagination(next);
  }, []);
  const scrollSnapshotRef = useRef<SessionRouteScrollSnapshot | undefined>(
    cachedLoad?.scrollSnapshot,
  );
  const dispatchSessionDetailAction = useCallback(
    (action: SessionDetailAction) => {
      if (action.type === "patchScrollSnapshot") {
        defaultSessionDetailStore.patchScrollSnapshot(
          snapshotKey,
          action.scrollSnapshot,
        );
        return;
      }
      defaultSessionDetailStore.dispatch(snapshotKey, action);
    },
    [snapshotKey],
  );

  const readCurrentStoreRouteSnapshot = useCallback(
    () => defaultSessionDetailStore.readRouteSnapshot(snapshotKey),
    [snapshotKey],
  );

  const persistCurrentStoreRouteSnapshot = useCallback(() => {
    if (!getSessionTranscriptCacheEnabled()) {
      return false;
    }
    const snapshot = readCurrentStoreRouteSnapshot();
    if (!snapshot) {
      return false;
    }
    return writeSessionLoadCache(snapshotKey, {
      ...snapshot,
      scrollSnapshot: scrollSnapshotRef.current,
    });
  }, [readCurrentStoreRouteSnapshot, snapshotKey]);
  const recordCurrentEntryBytes = useCallback(() => {
    const bytes = defaultSessionDetailStore
      .getStats()
      .entries.find((entry) => entry.key === snapshotKeyString)?.approxBytes;
    if (bytes) {
      recordLastSessionTranscriptBytes(bytes);
    }
  }, [snapshotKeyString]);
  const resetSessionDetailState = useCallback(
    (snapshot?: SessionRouteSnapshot) => {
      if (snapshot) {
        defaultSessionDetailStore.writeRouteSnapshot(snapshotKey, snapshot);
        return;
      }
      defaultSessionDetailStore.resetEntryState(snapshotKey);
    },
    [snapshotKey],
  );

  // Hold the store entry for the mounted session: retention protects it from
  // TTL/LRU eviction, so incremental dispatches always land on real state.
  useEffect(
    () => defaultSessionDetailStore.retain(snapshotKey),
    [snapshotKey],
  );

  // Track provider for DAG ordering decisions
  const providerRef = useRef<string | undefined>(undefined);

  // Track last message ID for incremental fetching
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  // Highest timestamp observed from persisted JSONL messages.
  // Used to suppress startup replay events that are already on disk.
  const maxPersistedTimestampMsRef = useRef<number>(Number.NEGATIVE_INFINITY);

  const reportStoreDivergence = useCallback(
    (
      boundary: string,
      livePatch: Partial<SessionDetailRuntimeStateInput> = {},
    ) => {
      if (!isSessionDetailShadowDiagnosticsEnabled()) {
        return;
      }
      const store = defaultSessionDetailStore.readSelected(
        snapshotKey,
        selectSessionDetailRuntimeSnapshot,
      );
      if (!store) {
        return;
      }
      const liveSession =
        livePatch.session ?? sessionRef.current ?? store.session;
      const live: SessionDetailRuntimeStateInput = {
        messages: livePatch.messages ?? store.messages,
        session: liveSession,
        pagination: livePatch.pagination ?? paginationRef.current,
        agentContent: livePatch.agentContent ?? store.agentContent,
        toolUseToAgentEntries:
          livePatch.toolUseToAgentEntries ?? store.toolUseToAgentEntries,
        lastMessageId: livePatch.lastMessageId ?? lastMessageIdRef.current,
        maxPersistedTimestampMs:
          livePatch.maxPersistedTimestampMs ??
          maxPersistedTimestampMsRef.current,
        scrollSnapshot: livePatch.scrollSnapshot ?? scrollSnapshotRef.current,
      };
      reportSessionDetailStoreDivergence({
        boundary,
        projectId,
        sessionId,
        provider: liveSession?.provider ?? providerRef.current,
        live,
        store,
      });
    },
    [snapshotKey, projectId, sessionId],
  );

  const updateSession = useCallback(
    (update: SessionMetadataUpdate) => {
      const previous = sessionRef.current;
      const next = typeof update === "function" ? update(previous) : update;
      if (next === previous) {
        return;
      }
      dispatchSessionDetailAction({ type: "setSessionMetadata", session: next });
      reportStoreDivergence("session-metadata", {
        session: next,
      });
      applySession(next);
    },
    [applySession, dispatchSessionDetailAction, reportStoreDivergence],
  );

  const readSelectorBackedMessages = useCallback(
    () =>
      defaultSessionDetailStore.readSelected(
        snapshotKey,
        selectSessionDetailMessages,
      ),
    [snapshotKey],
  );

  const readSelectorBackedAgentContent = useCallback(
    () =>
      defaultSessionDetailStore.readSelected(
        snapshotKey,
        selectSessionDetailAgentContent,
      ),
    [snapshotKey],
  );

  const readSelectorBackedRuntimeSnapshot = useCallback(
    () =>
      defaultSessionDetailStore.readSelected(
        snapshotKey,
        selectSessionDetailRuntimeSnapshot,
      ),
    [snapshotKey],
  );

  const readSelectorBackedToolUseToAgent = useCallback(() => {
    const entries = defaultSessionDetailStore.readSelected(
      snapshotKey,
      selectSessionDetailToolUseToAgentEntries,
    );
    return entries ? new Map(entries) : undefined;
  }, [snapshotKey]);

  const warnSessionDetailStore = useCallback(
    (payload: Record<string, unknown>) => {
      if (!import.meta.env.DEV) {
        return;
      }
      console.warn("[SessionDetailStore]", {
        ...payload,
        projectId,
        sessionId,
      });
    },
    [projectId, sessionId],
  );

  const warnMissingSelectorAfterDispatch = useCallback(
    (boundary: string, selector: string) => {
      warnSessionDetailStore({
        event: "session-detail-selector-missing-after-dispatch",
        boundary,
        selector,
      });
    },
    [warnSessionDetailStore],
  );

  const readMessagesAfterDispatch = useCallback(
    (boundary: string) => {
      const selected = readSelectorBackedMessages();
      if (selected) {
        return selected;
      }
      warnMissingSelectorAfterDispatch(boundary, "messages");
      return EMPTY_RETURNED_MESSAGES;
    },
    [readSelectorBackedMessages, warnMissingSelectorAfterDispatch],
  );

  const readAgentContentAfterDispatch = useCallback(
    (boundary: string) => {
      const selected = readSelectorBackedAgentContent();
      if (selected) {
        return selected;
      }
      warnMissingSelectorAfterDispatch(boundary, "agentContent");
      return EMPTY_RETURNED_AGENT_CONTENT;
    },
    [readSelectorBackedAgentContent, warnMissingSelectorAfterDispatch],
  );

  const readToolUseToAgentAfterDispatch = useCallback(
    (boundary: string) => {
      const selected = readSelectorBackedToolUseToAgent();
      if (selected) {
        return selected;
      }
      warnMissingSelectorAfterDispatch(boundary, "toolUseToAgent");
      return new Map<string, string>();
    },
    [readSelectorBackedToolUseToAgent, warnMissingSelectorAfterDispatch],
  );

  const warnMissingStoreBackedDetailAfterReveal = useCallback(() => {
    warnSessionDetailStore({
      event: "session-detail-store-missing-after-reveal",
    });
  }, [warnSessionDetailStore]);

  const canRevealReturnedDetail =
    revealedSnapshotKey === snapshotKeyString && !loading;
  const selectReturnedDetailStoreState = useMemo(() => {
    let previous: ReturnedDetailStoreState | undefined;
    return (
      state: SessionDetailState | undefined,
    ): ReturnedDetailStoreState | undefined => {
      if (!canRevealReturnedDetail || !state) {
        return undefined;
      }
      if (
        previous &&
        previous.messages === state.messages &&
        previous.agentContent === state.agentContent &&
        previous.toolUseToAgentEntries === state.toolUseToAgentEntries
      ) {
        return previous;
      }
      previous = {
        messages: state.messages,
        agentContent: state.agentContent,
        toolUseToAgentEntries: state.toolUseToAgentEntries,
      };
      return previous;
    };
  }, [canRevealReturnedDetail]);
  const storeBackedReturnedDetail = useSyncExternalStore(
    useCallback(
      (listener) => {
        return defaultSessionDetailStore.subscribe(
          snapshotKey,
          selectReturnedDetailStoreState,
          listener,
        );
      },
      [snapshotKey, selectReturnedDetailStoreState],
    ),
    useCallback(
      () =>
        defaultSessionDetailStore.readSelected(
          snapshotKey,
          selectReturnedDetailStoreState,
        ),
      [snapshotKey, selectReturnedDetailStoreState],
    ),
    () => undefined,
  );
  const returnedMessages = canRevealReturnedDetail
    ? (storeBackedReturnedDetail?.messages ?? EMPTY_RETURNED_MESSAGES)
    : EMPTY_RETURNED_MESSAGES;
  const returnedAgentContent = canRevealReturnedDetail
    ? (storeBackedReturnedDetail?.agentContent ?? EMPTY_RETURNED_AGENT_CONTENT)
    : EMPTY_RETURNED_AGENT_CONTENT;
  const returnedToolUseToAgent = useMemo(
    () => {
      if (!canRevealReturnedDetail) {
        return new Map<string, string>();
      }
      return storeBackedReturnedDetail
        ? new Map(storeBackedReturnedDetail.toolUseToAgentEntries)
        : new Map<string, string>();
    },
    [canRevealReturnedDetail, storeBackedReturnedDetail],
  );
  useEffect(() => {
    if (!canRevealReturnedDetail || storeBackedReturnedDetail) {
      return;
    }
    warnMissingStoreBackedDetailAfterReveal();
  }, [
    canRevealReturnedDetail,
    storeBackedReturnedDetail,
    warnMissingStoreBackedDetailAfterReveal,
  ]);

  // Buffering: queue stream messages until initial load completes
  const streamBufferRef = useRef<SessionDetailStreamBuffer>(
    createSessionDetailStreamBuffer(),
  );
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

  useEffect(() => {
    return () => {
      if (persistCurrentStoreRouteSnapshot()) {
        recordCurrentEntryBytes();
        return;
      }
      recordCurrentEntryBytes();
      defaultSessionDetailStore.deleteEntry({
        sourceKey,
        projectId,
        sessionId,
        tailTurns,
        tailFrom,
      });
    };
  }, [
    persistCurrentStoreRouteSnapshot,
    sourceKey,
    projectId,
    sessionId,
    tailTurns,
    tailFrom,
    recordCurrentEntryBytes,
  ]);

  // Process a stream message event.
  const processStreamMessage = useCallback(
    (incoming: Message, fromBufferedReplay = false) => {
      const streamingEnabled = getStreamingEnabled();

      dispatchSessionDetailAction({
        type: "applyStreamMessage",
        message: incoming,
        fromBufferedReplay,
        streamingEnabled,
      });
      readMessagesAfterDispatch("stream-message");
    },
    [dispatchSessionDetailAction, readMessagesAfterDispatch],
  );

  // Process a buffered stream subagent message
  const processStreamSubagentMessage = useCallback(
    (incoming: Message, agentId: string) => {
      const streamingEnabled = getStreamingEnabled();
      dispatchSessionDetailAction({
        type: "applyStreamSubagentMessage",
        agentId,
        message: incoming,
        streamingEnabled,
      });
      readAgentContentAfterDispatch("stream-subagent-message");
    },
    [dispatchSessionDetailAction, readAgentContentAfterDispatch],
  );

  // Flush buffered stream messages after initial load
  const flushBuffer = useCallback(() => {
    const buffer = drainSessionDetailStreamBuffer(streamBufferRef.current);
    for (const item of buffer) {
      if (item.type === "message") {
        processStreamMessage(item.message, true);
      } else {
        processStreamSubagentMessage(item.message, item.agentId);
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
    const warmLoad = readSessionLoadCache(snapshotKey);

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

    const readRevealSnapshotAfterStoreUpdate = (
      boundary: string,
      fallback: Omit<
        SessionDetailRevealSnapshotFallback,
        "maxPersistedTimestampMs"
      >,
    ): SessionDetailRevealSnapshotResult => {
      const reveal = buildSessionDetailRevealSnapshot({
        selected: readSelectorBackedRuntimeSnapshot(),
        fallback: {
          ...fallback,
          maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
          scrollSnapshot: fallback.scrollSnapshot ?? scrollSnapshotRef.current,
        },
      });
      if (!reveal.storeBacked) {
        warnMissingSelectorAfterDispatch(boundary, "runtimeSnapshot");
      }
      return reveal;
    };

    const applyRevealSnapshot = (snapshot: SessionRouteSnapshot) => {
      if (snapshot.lastMessageId) {
        lastMessageIdRef.current = snapshot.lastMessageId;
      }
      maxPersistedTimestampMsRef.current = snapshot.maxPersistedTimestampMs;
      scrollSnapshotRef.current = snapshot.scrollSnapshot;
      applySession(snapshot.session);
      applyPagination(snapshot.pagination);
      setRevealedSnapshotKey(snapshotKeyString);
    };

    const writeRevealSnapshotToLoadCache = (
      reveal: SessionDetailRevealSnapshotResult,
    ) => {
      const cacheableSnapshot =
        getCacheableSessionDetailRevealSnapshot(reveal);
      if (!cacheableSnapshot) {
        return false;
      }
      return writeSessionLoadCache(snapshotKey, cacheableSnapshot);
    };

    const completeInitialReveal = (options: {
      snapshot: SessionRouteSnapshot;
      sourceMessageCount: number;
      provider?: string;
      restoredFromSnapshot?: boolean;
    }) => {
      const { snapshot } = options;
      applyRevealSnapshot(snapshot);
      markReloadPerfPhase("session_initial_messages_state_queued", {
        messages: options.sourceMessageCount,
        totalMessages: snapshot.messages.length,
        provider: options.provider,
        ...(options.restoredFromSnapshot && { restoredFromSnapshot: true }),
      });

      // Mark ready and flush buffered stream events after the reveal snapshot
      // has been queued so buffered events merge on top of loaded transcript.
      initialLoadCompleteRef.current = true;
      flushBuffer();

      setLoading(false);
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("complete", {
          messageCount: snapshot.messages.length,
          pagination: snapshot.pagination,
        }),
      );
      markReloadPerfPhase("session_initial_load_complete", {
        messages: options.sourceMessageCount,
        ...(options.restoredFromSnapshot && { restoredFromSnapshot: true }),
      });
    };

    const finishWarmHydration = (options: {
      loadedMessages: Message[];
      loadedSession: SessionMetadata;
      loadedPagination?: PaginationInfo;
      sourceMessageCount: number;
      provider?: string;
      diagnosticBoundary: string;
    }): SessionDetailRevealSnapshotResult => {
      const lastJsonlId = findLastJsonlMessageId(options.loadedMessages);
      if (lastJsonlId) {
        lastMessageIdRef.current = lastJsonlId;
      }
      const reveal = readRevealSnapshotAfterStoreUpdate(
        options.diagnosticBoundary,
        {
          session: options.loadedSession,
          pagination: options.loadedPagination,
          lastMessageId: lastJsonlId,
          scrollSnapshot: scrollSnapshotRef.current,
        },
      );
      const { snapshot } = reveal;
      completeInitialReveal({
        snapshot,
        sourceMessageCount: options.sourceMessageCount,
        provider: options.provider,
        restoredFromSnapshot: true,
      });
      return reveal;
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
        createSessionLoadProgressForWindow("loaded", {
          messageCount: data.messages.length,
          pagination: data.pagination,
        }),
      );
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("preparing", {
          messageCount: data.messages.length,
          pagination: data.pagination,
        }),
      );
      const warmRefresh = prepareWarmRefreshBeforeHydration({
        warmLoad,
        refreshMessages: data.messages,
        refreshSession: data.session,
        refreshPagination: data.pagination,
      });
      updatePersistedTimestampWatermark(warmRefresh.taggedMessages);
      dispatchSessionDetailAction({
        type: "applyCatchupMessages",
        session: data.session,
        messages: data.messages,
        pagination: warmRefresh.pagination,
      });
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("rendering", {
          messageCount: warmRefresh.mergedMessages.length,
          pagination: warmRefresh.pagination,
        }),
      );
      const reveal = finishWarmHydration({
        loadedMessages: warmRefresh.mergedMessages,
        loadedSession: data.session,
        loadedPagination: warmRefresh.pagination,
        sourceMessageCount: warmRefresh.taggedMessages.length,
        provider: data.session.provider,
        diagnosticBoundary: "warm-catchup-before-hydration",
      });
      writeRevealSnapshotToLoadCache(reveal);
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
      const latestSnapshot = readCurrentStoreRouteSnapshot();
      const warmRefresh = prepareWarmRefreshAfterHydration({
        warmLoad,
        latestSnapshot,
        refreshMessages: data.messages,
        refreshSession: data.session,
        refreshPagination: data.pagination,
      });
      updatePersistedTimestampWatermark(warmRefresh.taggedMessages);
      dispatchSessionDetailAction({
        type: "applyCatchupMessages",
        session: data.session,
        messages: data.messages,
        pagination: warmRefresh.pagination,
      });
      const reveal = readRevealSnapshotAfterStoreUpdate(
        "warm-catchup-after-hydration",
        {
          session: data.session,
          pagination: warmRefresh.pagination,
          lastMessageId: findLastJsonlMessageId(warmRefresh.mergedMessages),
          scrollSnapshot: scrollSnapshotRef.current,
        },
      );
      const { snapshot } = reveal;
      applyRevealSnapshot(snapshot);
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("complete", {
          messageCount: snapshot.pagination?.returnedMessageCount,
          pagination: snapshot.pagination,
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
    resetSessionDetailStreamBuffer(streamBufferRef.current);
    scrollSnapshotRef.current = warmLoad?.scrollSnapshot;
    setRevealedSnapshotKey(null);
    if (warmLoad) {
      resetSessionDetailState(warmLoad);
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("fetching", {
          messageCount: warmLoad.messages.length,
          pagination: warmLoad.pagination,
        }),
      );
      maxPersistedTimestampMsRef.current = warmLoad.maxPersistedTimestampMs;
      providerRef.current = warmLoad.session.provider;
      lastMessageIdRef.current = warmLoad.lastMessageId;
      setLoading(true);
      applySession(null);
      applyPagination(undefined);
      void (async () => {
        setSessionLoadProgress(
          createSessionLoadProgressForWindow("rendering", {
            messageCount: warmLoad.messages.length,
            pagination: warmLoad.pagination,
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
      applySession(null);
      applyPagination(undefined);
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
          createSessionLoadProgressForWindow("loaded", {
            messageCount: data.messages.length,
            pagination: data.pagination,
          }),
        );
        providerRef.current = data.session.provider;

        // Tag messages from JSONL as authoritative
        setSessionLoadProgress(
          createSessionLoadProgressForWindow("preparing", {
            messageCount: data.messages.length,
            pagination: data.pagination,
          }),
        );
        const taggedMessages = tagJsonlMessages(data.messages);
        updatePersistedTimestampWatermark(taggedMessages);
        const loadedMessages = reconcilePersistedMessagesForProvider(
          taggedMessages,
          data.session.provider,
        );
        setSessionLoadProgress(
          createSessionLoadProgressForWindow("rendering", {
            messageCount: loadedMessages.length,
            pagination: data.pagination,
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
        dispatchSessionDetailAction({
          type: "loadPersistedTranscript",
          messages: data.messages,
          session: data.session,
          pagination: nextPagination,
        });
        const reveal = readRevealSnapshotAfterStoreUpdate(
          "initial-load",
          {
            session: data.session,
            pagination: nextPagination,
            lastMessageId: lastJsonlId,
            scrollSnapshot: scrollSnapshotRef.current,
          },
        );
        const { snapshot } = reveal;
        completeInitialReveal({
          snapshot,
          sourceMessageCount: taggedMessages.length,
          provider: data.session.provider,
        });

        writeRevealSnapshotToLoadCache(reveal);

        notifyLoadComplete(data);
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
    tailTurns,
    tailFrom,
    detailedLoadingProgress,
    onLoadComplete,
    onLoadError,
    flushBuffer,
    updatePersistedTimestampWatermark,
    resetSessionDetailState,
    dispatchSessionDetailAction,
    applyPagination,
    applySession,
    readCurrentStoreRouteSnapshot,
    readSelectorBackedRuntimeSnapshot,
    snapshotKey,
    snapshotKeyString,
    warnMissingSelectorAfterDispatch,
  ]);

  // Handle streaming content updates (from useStreamingContent)
  const handleStreamingUpdate = useCallback(
    (streamingMessage: Message, agentId?: string) => {
      const messageId = getMessageId(streamingMessage);
      if (!messageId) return;

      dispatchSessionDetailAction({
        type: "upsertStreamingPlaceholder",
        message: streamingMessage,
        agentId,
      });

      if (agentId) {
        readAgentContentAfterDispatch("streaming-placeholder");
        return;
      }

      readMessagesAfterDispatch("streaming-placeholder");
    },
    [
      dispatchSessionDetailAction,
      readAgentContentAfterDispatch,
      readMessagesAfterDispatch,
    ],
  );

  // Handle stream message event (with buffering)
  const handleStreamMessageEvent = useCallback(
    (incoming: Message) => {
      if (!initialLoadCompleteRef.current) {
        bufferSessionDetailStreamMessage(streamBufferRef.current, incoming);
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
        bufferSessionDetailStreamSubagentMessage(
          streamBufferRef.current,
          incoming,
          agentId,
        );
        return;
      }
      processStreamSubagentMessage(incoming, agentId);
    },
    [processStreamSubagentMessage],
  );

  // Register toolUse → agent mapping
  const registerToolUseAgent = useCallback(
    (toolUseId: string, agentId: string) => {
      dispatchSessionDetailAction({
        type: "registerToolUseAgent",
        toolUseId,
        agentId,
      });
      readToolUseToAgentAfterDispatch("tool-use-agent-map");
    },
    [dispatchSessionDetailAction, readToolUseToAgentAfterDispatch],
  );

  const mergeLoadedAgentContent = useCallback(
    (agentId: string, content: AgentContent) => {
      dispatchSessionDetailAction({
        type: "mergeLoadedAgentContent",
        agentId,
        content,
      });
      readAgentContentAfterDispatch("loaded-agent-content");
    },
    [dispatchSessionDetailAction, readAgentContentAfterDispatch],
  );

  const updateAgentContextUsage = useCallback(
    (agentId: string, contextUsage: AgentContextUsage) => {
      dispatchSessionDetailAction({
        type: "updateAgentContextUsage",
        agentId,
        contextUsage,
      });
      readAgentContentAfterDispatch("agent-context-usage");
    },
    [dispatchSessionDetailAction, readAgentContentAfterDispatch],
  );

  const clearAgentStreamingPlaceholders = useCallback(
    (agentId: string) => {
      dispatchSessionDetailAction({
        type: "clearAgentStreamingPlaceholders",
        agentId,
      });
      readAgentContentAfterDispatch("agent-streaming-placeholder-cleanup");
    },
    [dispatchSessionDetailAction, readAgentContentAfterDispatch],
  );

  const clearStreamingPlaceholders = useCallback(() => {
    dispatchSessionDetailAction({ type: "clearStreamingPlaceholders" });
    readMessagesAfterDispatch("streaming-placeholder-cleanup");
  }, [dispatchSessionDetailAction, readMessagesAfterDispatch]);

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
          dispatchSessionDetailAction({
            type: "applyCatchupMessages",
            messages: data.messages,
            session: data.session,
          });
          updatePersistedTimestampWatermark(data.messages);
          const nextMessages = readMessagesAfterDispatch("catchup");
          const lastJsonlId = findLastJsonlMessageId(nextMessages);
          if (lastJsonlId) {
            lastMessageIdRef.current = lastJsonlId;
          }
          reportStoreDivergence("catchup", {
            messages: nextMessages,
            session: data.session,
            lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
            maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
          });
        }
        // Update session metadata (including title, model, contextUsage) which may have changed
        // For new sessions, prev may be null if JSONL didn't exist on initial load
        updateSession((prev) =>
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
    readMessagesAfterDispatch,
    reportStoreDivergence,
    updateSession,
  ]);

  const readSelectorBackedPagination = useCallback(
    () =>
      defaultSessionDetailStore.readSelected(
        snapshotKey,
        selectSessionDetailPagination,
      ) ?? pagination,
    [snapshotKey, pagination],
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
      dispatchSessionDetailAction({
        type: "prependOlderMessages",
        messages: data.messages,
        pagination: data.pagination,
      });
      const taggedOlder = data.messages.map((m) => ({
        ...m,
        _source: "jsonl" as const,
      }));
      updatePersistedTimestampWatermark(taggedOlder);
      const selectorBackedMessages = readSelectorBackedMessages();
      const selectorBackedPagination = defaultSessionDetailStore.readSelected(
        snapshotKey,
        selectSessionDetailPagination,
      );
      const nextMessages =
        selectorBackedMessages ?? readMessagesAfterDispatch("older-page");
      const lastJsonlId = findLastJsonlMessageId(nextMessages);
      if (lastJsonlId) {
        lastMessageIdRef.current = lastJsonlId;
      }
      reportStoreDivergence("older-page", {
        messages: nextMessages,
        session: data.session,
        pagination: selectorBackedPagination ?? data.pagination,
        lastMessageId: lastJsonlId ?? lastMessageIdRef.current,
        maxPersistedTimestampMs: maxPersistedTimestampMsRef.current,
      });
      applyPagination(selectorBackedPagination ?? data.pagination);
    } catch {
      // Silent fail for loading older messages
    } finally {
      setLoadingOlder(false);
    }
  }, [
    projectId,
    sessionId,
    applyPagination,
    readSelectorBackedPagination,
    updatePersistedTimestampWatermark,
    dispatchSessionDetailAction,
    readSelectorBackedMessages,
    readMessagesAfterDispatch,
    reportStoreDivergence,
    snapshotKey,
  ]);

  const updateRouteScrollSnapshot = useCallback(
    (snapshot: SessionRouteScrollSnapshot) => {
      scrollSnapshotRef.current = snapshot;
      dispatchSessionDetailAction({
        type: "patchScrollSnapshot",
        scrollSnapshot: snapshot,
      });
      reportStoreDivergence("scroll-snapshot", {
        scrollSnapshot: snapshot,
      });
    },
    [dispatchSessionDetailAction, reportStoreDivergence],
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
      updateSession((prev) =>
        prev ? { ...prev, ...metadataSession } : metadataSession,
      );
    } catch {
      // Silent fail for metadata updates
    }
  }, [projectId, sessionId, updateSession]);
  const selectedInitialScrollSnapshot =
    defaultSessionDetailStore.readSelected(
      snapshotKey,
      selectSessionDetailScrollSnapshot,
    ) ??
    cachedLoad?.scrollSnapshot ??
    null;
  const selectedPagination = readSelectorBackedPagination();

  return {
    messages: returnedMessages,
    agentContent: returnedAgentContent,
    toolUseToAgent: returnedToolUseToAgent,
    loading,
    sessionLoadProgress,
    session,
    updateSession,
    handleStreamingUpdate,
    handleStreamMessageEvent,
    handleStreamSubagentMessage,
    registerToolUseAgent,
    mergeLoadedAgentContent,
    updateAgentContextUsage,
    clearAgentStreamingPlaceholders,
    clearStreamingPlaceholders,
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
