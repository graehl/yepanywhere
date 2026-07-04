import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DeferredQueueMessage, PaginationInfo } from "../api/client";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { getMessageId } from "../lib/mergeMessages";
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
import { createSessionDetailCoordinator } from "../lib/sessionDetail/sessionDetailCoordinator";
import { markReloadPerfPhase } from "../lib/diagnostics/reloadPerfProbe";
import {
  getSessionScrollBehaviorMode,
  getSessionTranscriptCacheEnabled,
  recordLastSessionTranscriptBytes,
} from "./useSessionPerformanceSettings";
import { getStreamingEnabled } from "./useStreamingEnabled";
import { shouldRetainSessionScrollMemory } from "../lib/sessionScrollBehavior";
import type { Message, SessionMetadata, SessionStatus } from "../types";
import { reportProviderRuntimeStatusSnapshot } from "../lib/clientSummaryStore";
import {
  isSessionDetailShadowDiagnosticsEnabled,
  reportSessionDetailStoreDivergence,
  type SessionDetailRuntimeStateInput,
} from "../lib/sessionDetail/shadowDiagnostics";
import {
  selectSessionDetailLastMessageId,
  selectSessionDetailPagination,
  selectSessionDetailRuntimeSnapshot,
  selectSessionDetailSession,
} from "../lib/sessionDetail/selectors";
import {
  defaultSessionDetailStore,
  getSessionDetailEntryKey,
  type SessionDetailEntryKeyInput,
  type SessionDetailStore,
} from "../lib/sessionDetail/sessionDetailStore";
import type { GetSessionResult } from "../lib/sourceRuntime";
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

interface StoreBackedSessionDetail {
  /** Transcript fields, gated until the route reveal completes. */
  revealed: ReturnedDetailStoreState | undefined;
  /** Loaded-window pagination; not reveal-gated so warm values stay visible. */
  pagination: PaginationInfo | undefined;
  /** Session metadata; null until reveal so loading semantics hold. */
  session: SessionMetadata | null;
}

function readSessionLoadCache(
  cache: SessionDetailStore,
  input: SessionDetailEntryKeyInput,
): SessionRouteSnapshot | undefined {
  if (!getSessionTranscriptCacheEnabled() || typeof window === "undefined") {
    return undefined;
  }
  return cache.readRouteSnapshot(input);
}

function writeSessionLoadCache(
  cache: SessionDetailStore,
  input: SessionDetailEntryKeyInput,
  entry: SessionRouteSnapshot,
): boolean {
  if (!getSessionTranscriptCacheEnabled() || typeof window === "undefined") {
    return false;
  }
  return cache.writeRouteSnapshot(input, {
    ...entry,
    scrollSnapshot: shouldRetainSessionScrollMemory(
      getSessionScrollBehaviorMode(),
    )
      ? entry.scrollSnapshot
      : undefined,
  });
}

export function __resetSessionLoadCacheForTest(): void {
  defaultSessionDetailStore.clear();
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
  const runtime = useCurrentSourceRuntime();
  const sourceKey = runtime.sourceKey;
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
  const coordinator = useMemo(
    () => createSessionDetailCoordinator({ entryKey: snapshotKey, runtime }),
    [runtime, snapshotKey],
  );
  const sourceApi = coordinator.api;
  const sessionDetailCache = coordinator.cache;
  const snapshotKeyString = getSessionDetailEntryKey(snapshotKey);
  const cachedLoadRef = useRef<{
    key: string;
    cache: SessionDetailStore;
    load: SessionRouteSnapshot | undefined;
  } | null>(null);
  if (
    cachedLoadRef.current?.key !== snapshotKeyString ||
    cachedLoadRef.current.cache !== sessionDetailCache
  ) {
    cachedLoadRef.current = {
      key: snapshotKeyString,
      cache: sessionDetailCache,
      load: readSessionLoadCache(sessionDetailCache, snapshotKey),
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
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Store-authoritative fields come from reducer-owned state. The remaining ref
  // holds hook-only scroll bookkeeping, which is intentionally not reactive.
  const scrollSnapshotRef = useRef<SessionRouteScrollSnapshot | undefined>(
    shouldRetainSessionScrollMemory(getSessionScrollBehaviorMode())
      ? cachedLoad?.scrollSnapshot
      : undefined,
  );
  const dispatchSessionDetailAction = useCallback(
    (action: SessionDetailAction) => {
      sessionDetailCache.dispatch(snapshotKey, action);
    },
    [sessionDetailCache, snapshotKey],
  );

  const readStoreSession = useCallback(
    () =>
      sessionDetailCache.readSelected(
        snapshotKey,
        selectSessionDetailSession,
      ) ?? null,
    [sessionDetailCache, snapshotKey],
  );

  const readStoreLastMessageId = useCallback(
    () =>
      sessionDetailCache.readSelected(
        snapshotKey,
        selectSessionDetailLastMessageId,
      ),
    [sessionDetailCache, snapshotKey],
  );

  const readCurrentStoreRouteSnapshot = useCallback(
    () => sessionDetailCache.readRouteSnapshot(snapshotKey),
    [sessionDetailCache, snapshotKey],
  );

  const persistCurrentStoreRouteSnapshot = useCallback(() => {
    if (!getSessionTranscriptCacheEnabled()) {
      return false;
    }
    const snapshot = readCurrentStoreRouteSnapshot();
    if (!snapshot) {
      return false;
    }
    return writeSessionLoadCache(
      sessionDetailCache,
      snapshotKey,
      {
        ...snapshot,
        scrollSnapshot: shouldRetainSessionScrollMemory(
          getSessionScrollBehaviorMode(),
        )
          ? scrollSnapshotRef.current
          : undefined,
      },
    );
  }, [readCurrentStoreRouteSnapshot, sessionDetailCache, snapshotKey]);
  const recordCurrentEntryBytes = useCallback(() => {
    const bytes = sessionDetailCache
      .getStats()
      .entries.find((entry) => entry.key === snapshotKeyString)?.approxBytes;
    if (bytes) {
      recordLastSessionTranscriptBytes(bytes);
    }
  }, [sessionDetailCache, snapshotKeyString]);
  const resetSessionDetailState = useCallback(
    (snapshot?: SessionRouteSnapshot) => {
      if (snapshot) {
        sessionDetailCache.replaceRouteSnapshot(snapshotKey, snapshot);
        return;
      }
      sessionDetailCache.resetEntryState(snapshotKey);
    },
    [sessionDetailCache, snapshotKey],
  );

  // Hold the store entry for the mounted session: retention protects it from
  // TTL/LRU eviction, so incremental dispatches always land on real state.
  useEffect(
    () => sessionDetailCache.retain(snapshotKey),
    [sessionDetailCache, snapshotKey],
  );

  const reportStoreDivergence = useCallback(
    (
      boundary: string,
      livePatch: Partial<SessionDetailRuntimeStateInput> = {},
    ) => {
      if (!isSessionDetailShadowDiagnosticsEnabled()) {
        return;
      }
      const store = sessionDetailCache.readSelected(
        snapshotKey,
        selectSessionDetailRuntimeSnapshot,
      );
      if (!store) {
        return;
      }
      // Session and pagination are store-authoritative, so their live values
      // default to the store snapshot; only explicitly patched fields can
      // still diverge here.
      const liveSession = livePatch.session ?? store.session;
      const live: SessionDetailRuntimeStateInput = {
        messages: livePatch.messages ?? store.messages,
        session: liveSession,
        pagination: livePatch.pagination ?? store.pagination,
        agentContent: livePatch.agentContent ?? store.agentContent,
        toolUseToAgentEntries:
          livePatch.toolUseToAgentEntries ?? store.toolUseToAgentEntries,
      };
      reportSessionDetailStoreDivergence({
        boundary,
        projectId,
        sessionId,
        live,
        store,
      });
    },
    [sessionDetailCache, snapshotKey, projectId, sessionId],
  );

  const updateSession = useCallback(
    (update: SessionMetadataUpdate) => {
      const previous = readStoreSession();
      const next = typeof update === "function" ? update(previous) : update;
      if (next === previous) {
        return;
      }
      dispatchSessionDetailAction({ type: "setSessionMetadata", session: next });
      reportStoreDivergence("session-metadata", {
        session: next,
      });
    },
    [dispatchSessionDetailAction, readStoreSession, reportStoreDivergence],
  );

  const readSelectorBackedRuntimeSnapshot = useCallback(
    () => {
      const selected = sessionDetailCache.readSelected(
        snapshotKey,
        selectSessionDetailRuntimeSnapshot,
      );
      if (!selected) {
        return undefined;
      }
      return {
        ...selected,
        scrollSnapshot: sessionDetailCache.readScrollSnapshot(
          snapshotKey,
        ),
      };
    },
    [sessionDetailCache, snapshotKey],
  );

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

  const warnMissingStoreBackedDetailAfterReveal = useCallback(() => {
    warnSessionDetailStore({
      event: "session-detail-store-missing-after-reveal",
    });
  }, [warnSessionDetailStore]);

  const canRevealReturnedDetail =
    revealedSnapshotKey === snapshotKeyString && !loading;
  const selectStoreBackedDetail = useMemo(() => {
    let previous: StoreBackedSessionDetail | undefined;
    let previousRevealed: ReturnedDetailStoreState | undefined;
    return (
      state: SessionDetailState | undefined,
    ): StoreBackedSessionDetail | undefined => {
      if (!state) {
        return undefined;
      }
      let revealed: ReturnedDetailStoreState | undefined;
      if (canRevealReturnedDetail) {
        revealed =
          previousRevealed &&
          previousRevealed.messages === state.messages &&
          previousRevealed.agentContent === state.agentContent &&
          previousRevealed.toolUseToAgentEntries ===
            state.toolUseToAgentEntries
            ? previousRevealed
            : {
                messages: state.messages,
                agentContent: state.agentContent,
                toolUseToAgentEntries: state.toolUseToAgentEntries,
              };
        previousRevealed = revealed;
      }
      const session = canRevealReturnedDetail ? state.session : null;
      if (
        previous &&
        previous.revealed === revealed &&
        previous.pagination === state.pagination &&
        previous.session === session
      ) {
        return previous;
      }
      previous = { revealed, pagination: state.pagination, session };
      return previous;
    };
  }, [canRevealReturnedDetail]);
  const storeBackedDetail = useSyncExternalStore(
    useCallback(
      (listener) => {
        return sessionDetailCache.subscribe(
          snapshotKey,
          selectStoreBackedDetail,
          listener,
        );
      },
      [sessionDetailCache, snapshotKey, selectStoreBackedDetail],
    ),
    useCallback(
      () =>
        sessionDetailCache.readSelected(
          snapshotKey,
          selectStoreBackedDetail,
        ),
      [sessionDetailCache, snapshotKey, selectStoreBackedDetail],
    ),
    () => undefined,
  );
  const returnedMessages =
    storeBackedDetail?.revealed?.messages ?? EMPTY_RETURNED_MESSAGES;
  const returnedAgentContent =
    storeBackedDetail?.revealed?.agentContent ?? EMPTY_RETURNED_AGENT_CONTENT;
  const returnedToolUseToAgent = useMemo(
    () =>
      storeBackedDetail?.revealed
        ? new Map(storeBackedDetail.revealed.toolUseToAgentEntries)
        : new Map<string, string>(),
    [storeBackedDetail?.revealed],
  );
  useEffect(() => {
    if (!canRevealReturnedDetail || storeBackedDetail?.revealed) {
      return;
    }
    warnMissingStoreBackedDetailAfterReveal();
  }, [
    canRevealReturnedDetail,
    storeBackedDetail,
    warnMissingStoreBackedDetailAfterReveal,
  ]);

  useEffect(() => {
    return () => {
      if (persistCurrentStoreRouteSnapshot()) {
        recordCurrentEntryBytes();
        return;
      }
      recordCurrentEntryBytes();
      sessionDetailCache.deleteEntry({
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
    sessionDetailCache,
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
    },
    [dispatchSessionDetailAction],
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
    },
    [dispatchSessionDetailAction],
  );

  // Initial load. When a warm in-tab cache exists, the REST request is an
  // incremental refresh after the cached tail; merge that delta instead of
  // replacing the cached transcript.
  useEffect(() => {
    let cancelled = false;
    let warmHydrated = false;
    let pendingWarmData: GetSessionResult | null = null;
    let pendingWarmError: Error | null = null;
    let initialAfterMessageId: string | undefined;
    const warmLoad = readSessionLoadCache(sessionDetailCache, snapshotKey);

    const notifyLoadComplete = (
      data: GetSessionResult,
    ) => {
      reportProviderRuntimeStatusSnapshot(
        sourceKey,
        {
          sessionId,
          projectId,
          providerRuntimeStatus: data.providerRuntimeStatus ?? null,
        },
      );
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
      const selected = readSelectorBackedRuntimeSnapshot();
      const reveal = buildSessionDetailRevealSnapshot({
        selected,
        fallback: {
          ...fallback,
          maxPersistedTimestampMs:
            selected?.maxPersistedTimestampMs ?? Number.NEGATIVE_INFINITY,
          scrollSnapshot: fallback.scrollSnapshot ?? scrollSnapshotRef.current,
        },
      });
      if (!reveal.storeBacked) {
        warnSessionDetailStore({
          event: "session-detail-selector-missing-after-dispatch",
          boundary,
          selector: "runtimeSnapshot",
        });
      }
      return reveal;
    };

    const applyRevealSnapshot = (snapshot: SessionRouteSnapshot) => {
      scrollSnapshotRef.current = shouldRetainSessionScrollMemory(
        getSessionScrollBehaviorMode(),
      )
        ? snapshot.scrollSnapshot
        : undefined;
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
      return writeSessionLoadCache(
        sessionDetailCache,
        snapshotKey,
        cacheableSnapshot,
      );
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
      coordinator.completeInitialLoad({
        processMessage: processStreamMessage,
        processSubagentMessage: processStreamSubagentMessage,
      });

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
      loadedSession: SessionMetadata;
      loadedPagination?: PaginationInfo;
      sourceMessageCount: number;
      provider?: string;
      diagnosticBoundary: string;
    }): SessionDetailRevealSnapshotResult => {
      const reveal = readRevealSnapshotAfterStoreUpdate(
        options.diagnosticBoundary,
        {
          session: options.loadedSession,
          pagination: options.loadedPagination,
          lastMessageId: readStoreLastMessageId(),
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

    const applyWarmRefreshAction = (
      data: GetSessionResult,
    ): {
      messageCount: number;
      pagination?: PaginationInfo;
      sourceMessageCount: number;
    } => {
      if (!warmLoad) {
        return {
          messageCount: data.messages.length,
          pagination: data.pagination,
          sourceMessageCount: data.messages.length,
        };
      }

      if (initialAfterMessageId === undefined) {
        dispatchSessionDetailAction({
          type: "loadPersistedTranscript",
          messages: data.messages,
          session: data.session,
          pagination: data.pagination,
        });
        return {
          messageCount: data.messages.length,
          pagination: data.pagination,
          sourceMessageCount: data.messages.length,
        };
      }

      if (data.pagination) {
        dispatchSessionDetailAction({
          type: "replaceTailWindow",
          messages: data.messages,
          session: data.session,
          pagination: data.pagination,
        });
        return {
          messageCount: data.messages.length,
          pagination: data.pagination,
          sourceMessageCount: data.messages.length,
        };
      }

      dispatchSessionDetailAction({
        type: "applyCatchupMessages",
        session: data.session,
        messages: data.messages,
      });
      const merged = readSelectorBackedRuntimeSnapshot();
      return {
        messageCount: merged?.messages.length ?? data.messages.length,
        pagination: merged?.pagination,
        sourceMessageCount: data.messages.length,
      };
    };

    const applyWarmDataBeforeHydration = (
      data: GetSessionResult,
    ) => {
      if (!warmLoad) return;
      markReloadPerfPhase("session_initial_load_data_ready", {
        messages: data.messages.length,
        provider: data.session.provider,
        totalMessages: data.pagination?.totalMessageCount,
        hasOlderMessages: data.pagination?.hasOlderMessages,
        restoredFromSnapshot: true,
      });
      const applied = applyWarmRefreshAction(data);
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("rendering", {
          messageCount: applied.messageCount,
          pagination: applied.pagination,
        }),
      );
      const reveal = finishWarmHydration({
        loadedSession: data.session,
        loadedPagination: applied.pagination,
        sourceMessageCount: applied.sourceMessageCount,
        provider: data.session.provider,
        diagnosticBoundary: "warm-catchup-before-hydration",
      });
      writeRevealSnapshotToLoadCache(reveal);
      notifyLoadComplete(data);
    };

    const applyWarmDeltaAfterHydration = (
      data: GetSessionResult,
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
      const applied = applyWarmRefreshAction(data);
      const reveal = readRevealSnapshotAfterStoreUpdate(
        "warm-catchup-after-hydration",
        {
          session: data.session,
          pagination: applied.pagination,
          lastMessageId: readStoreLastMessageId(),
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
    coordinator.resetForInitialLoad();
    scrollSnapshotRef.current = shouldRetainSessionScrollMemory(
      getSessionScrollBehaviorMode(),
    )
      ? warmLoad?.scrollSnapshot
      : undefined;
    setRevealedSnapshotKey(null);
    if (warmLoad) {
      resetSessionDetailState(warmLoad);
      setSessionLoadProgress(
        createSessionLoadProgressForWindow("fetching", {
          messageCount: warmLoad.messages.length,
          pagination: warmLoad.pagination,
        }),
      );
      setLoading(true);
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
      setLoading(true);
    }

    initialAfterMessageId = readStoreLastMessageId();
    sourceApi
      .getSession({
        projectId,
        sessionId,
        afterMessageId: initialAfterMessageId,
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
          createSessionLoadProgressForWindow("rendering", {
            messageCount: data.messages.length,
            pagination: data.pagination,
          }),
        );
        await yieldForSessionLoadingProgressPaint(detailedLoadingProgress);
        if (cancelled) return;

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
            lastMessageId: readStoreLastMessageId(),
            scrollSnapshot: scrollSnapshotRef.current,
          },
        );
        const { snapshot } = reveal;
        completeInitialReveal({
          snapshot,
          sourceMessageCount: data.messages.length,
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
    coordinator,
    resetSessionDetailState,
    dispatchSessionDetailAction,
    processStreamMessage,
    processStreamSubagentMessage,
    readStoreLastMessageId,
    readSelectorBackedRuntimeSnapshot,
    sessionDetailCache,
    snapshotKey,
    snapshotKeyString,
    sourceApi,
    warnSessionDetailStore,
    sourceKey,
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
    },
    [dispatchSessionDetailAction],
  );

  // Handle stream message event (with buffering)
  const handleStreamMessageEvent = useCallback(
    (incoming: Message) => {
      coordinator.handleStreamMessage(incoming, processStreamMessage);
    },
    [coordinator, processStreamMessage],
  );

  // Handle stream subagent message event (with buffering)
  const handleStreamSubagentMessage = useCallback(
    (incoming: Message, agentId: string) => {
      coordinator.handleStreamSubagentMessage(
        incoming,
        agentId,
        processStreamSubagentMessage,
      );
    },
    [coordinator, processStreamSubagentMessage],
  );

  // Register toolUse → agent mapping
  const registerToolUseAgent = useCallback(
    (toolUseId: string, agentId: string) => {
      dispatchSessionDetailAction({
        type: "registerToolUseAgent",
        toolUseId,
        agentId,
      });
    },
    [dispatchSessionDetailAction],
  );

  const mergeLoadedAgentContent = useCallback(
    (agentId: string, content: AgentContent) => {
      dispatchSessionDetailAction({
        type: "mergeLoadedAgentContent",
        agentId,
        content,
      });
    },
    [dispatchSessionDetailAction],
  );

  const updateAgentContextUsage = useCallback(
    (agentId: string, contextUsage: AgentContextUsage) => {
      dispatchSessionDetailAction({
        type: "updateAgentContextUsage",
        agentId,
        contextUsage,
      });
    },
    [dispatchSessionDetailAction],
  );

  const clearAgentStreamingPlaceholders = useCallback(
    (agentId: string) => {
      dispatchSessionDetailAction({
        type: "clearAgentStreamingPlaceholders",
        agentId,
      });
    },
    [dispatchSessionDetailAction],
  );

  const clearStreamingPlaceholders = useCallback(() => {
    dispatchSessionDetailAction({ type: "clearStreamingPlaceholders" });
  }, [dispatchSessionDetailAction]);

  // Fetch new messages incrementally (for file change events)
  const fetchNewMessages = useCallback(() => {
    return coordinator.runExclusiveFetchNewMessages(async () => {
      try {
        const afterMessageId = readStoreLastMessageId();
        const data = await sourceApi.getSession({
          projectId,
          sessionId,
          afterMessageId,
        });
        reportProviderRuntimeStatusSnapshot(sourceKey, {
          sessionId,
          projectId,
          providerRuntimeStatus: data.providerRuntimeStatus ?? null,
        });
        if (data.messages.length > 0) {
          if (afterMessageId !== undefined && data.pagination) {
            dispatchSessionDetailAction({
              type: "replaceTailWindow",
              messages: data.messages,
              session: data.session,
              pagination: data.pagination,
            });
          } else {
            dispatchSessionDetailAction({
              type: "applyCatchupMessages",
              messages: data.messages,
              session: data.session,
              pagination: data.pagination,
            });
          }
          reportStoreDivergence("catchup", { session: data.session });
        }
        // Update session metadata (including title, model, contextUsage) which may have changed
        // For new sessions, prev may be null if JSONL didn't exist on initial load
        updateSession((prev) =>
          prev ? { ...prev, ...data.session } : data.session,
        );
      } catch {
        // Silent fail for incremental updates
      }
    });
  }, [
    coordinator,
    projectId,
    sessionId,
    readStoreLastMessageId,
    dispatchSessionDetailAction,
    reportStoreDivergence,
    sourceApi,
    sourceKey,
    updateSession,
  ]);

  const readSelectorBackedPagination = useCallback(
    () =>
      sessionDetailCache.readSelected(
        snapshotKey,
        selectSessionDetailPagination,
      ),
    [sessionDetailCache, snapshotKey],
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
      const data = await sourceApi.getSession({
        projectId,
        sessionId,
        tailCompactions: 2,
        beforeMessageId: currentPagination.truncatedBeforeMessageId,
      });
      reportProviderRuntimeStatusSnapshot(sourceKey, {
        sessionId,
        projectId,
        providerRuntimeStatus: data.providerRuntimeStatus ?? null,
      });
      dispatchSessionDetailAction({
        type: "prependOlderMessages",
        messages: data.messages,
        pagination: data.pagination,
      });
      reportStoreDivergence("older-page", { session: data.session });
    } catch {
      // Silent fail for loading older messages
    } finally {
      setLoadingOlder(false);
    }
  }, [
    projectId,
    sessionId,
    readSelectorBackedPagination,
    dispatchSessionDetailAction,
    reportStoreDivergence,
    sourceApi,
    sourceKey,
  ]);

  const updateRouteScrollSnapshot = useCallback(
    (snapshot: SessionRouteScrollSnapshot) => {
      if (
        !shouldRetainSessionScrollMemory(getSessionScrollBehaviorMode())
      ) {
        scrollSnapshotRef.current = undefined;
        return;
      }
      scrollSnapshotRef.current = snapshot;
      sessionDetailCache.patchScrollSnapshot(snapshotKey, snapshot);
    },
    [sessionDetailCache, snapshotKey],
  );

  // Fetch session metadata only
  const fetchSessionMetadata = useCallback(async () => {
    try {
      const data = await sourceApi.getSessionMetadata({
        projectId,
        sessionId,
      });
      reportProviderRuntimeStatusSnapshot(sourceKey, {
        sessionId,
        projectId,
        providerRuntimeStatus: data.providerRuntimeStatus ?? null,
      });
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
  }, [projectId, sessionId, sourceApi, sourceKey, updateSession]);
  const selectedInitialScrollSnapshot =
    shouldRetainSessionScrollMemory(getSessionScrollBehaviorMode())
      ? (sessionDetailCache.readScrollSnapshot(snapshotKey) ??
        cachedLoad?.scrollSnapshot ??
        null)
      : null;

  return {
    messages: returnedMessages,
    agentContent: returnedAgentContent,
    toolUseToAgent: returnedToolUseToAgent,
    loading,
    sessionLoadProgress,
    session: storeBackedDetail?.session ?? null,
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
    pagination: storeBackedDetail?.pagination,
    loadingOlder,
    loadOlderMessages,
    initialScrollSnapshot: selectedInitialScrollSnapshot,
    updateRouteScrollSnapshot,
    restoredFromSnapshot: Boolean(cachedLoad),
  };
}
