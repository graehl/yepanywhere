/**
 * InboxContext - Fetch lifecycle and compatibility context for inbox data.
 *
 * Consolidates inbox fetching, reports accepted snapshots into the client
 * summary store, and exposes store-selected rows to existing consumers.
 * Supports an `enabled` option to pause fetching when inbox UI is not visible.
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type InboxItem, type InboxResponse, api } from "../api/client";
import { useFileActivity } from "../hooks/useFileActivity";
import { authEvents } from "../lib/authEvents";
import { isRemoteClient } from "../lib/connection";
import {
  reportInboxCollectionSnapshot,
  useClientSummarySourceKey,
  useInboxResponseSnapshot,
} from "../lib/clientSummaryStore";
import { INBOX_TIERS, type InboxTier } from "../lib/inboxTiers";
import { useOptionalRemoteConnection } from "./RemoteConnectionContext";

// Re-export types for consumers
export type { InboxItem, InboxResponse } from "../api/client";
export { INBOX_TIERS, type InboxTier } from "../lib/inboxTiers";

// Debounce interval for refetch on SSE events (prevents rapid refetches)
const REFETCH_DEBOUNCE_MS = 500;

/**
 * Tracks the stable order of session IDs within each tier.
 * Used to prevent reordering during polling while still allowing
 * items to move between tiers.
 */
type TierOrder = Record<InboxTier, string[]>;

/**
 * Merges new inbox data with existing tier order for UI stability.
 *
 * Rules:
 * - Existing items stay in their current position within a tier
 * - New items are appended at the end of their tier
 * - Items that are no longer in a tier are removed
 * - Items CAN move between tiers (that's meaningful state change)
 */
function mergeWithStableOrder(
  newData: InboxResponse,
  currentOrder: TierOrder,
): InboxResponse {
  const result: InboxResponse = {
    needsAttention: [],
    active: [],
    recentActivity: [],
    unread8h: [],
    unread24h: [],
  };

  for (const tier of INBOX_TIERS) {
    const newItems = newData[tier];
    const existingOrder = currentOrder[tier];

    // Build lookup map for quick access
    const newItemsMap = new Map(newItems.map((item) => [item.sessionId, item]));

    // First, add existing items that are still in this tier (preserving order)
    const orderedItems: InboxItem[] = [];
    for (const sessionId of existingOrder) {
      const item = newItemsMap.get(sessionId);
      if (item) {
        orderedItems.push(item);
      }
    }

    // Then, append new items that weren't in the existing order
    const existingSet = new Set(existingOrder);
    for (const item of newItems) {
      if (!existingSet.has(item.sessionId)) {
        orderedItems.push(item);
      }
    }

    result[tier] = orderedItems;
  }

  return result;
}

/**
 * Extracts the session ID order from inbox data.
 */
function extractTierOrder(data: InboxResponse): TierOrder {
  return {
    needsAttention: data.needsAttention.map((item) => item.sessionId),
    active: data.active.map((item) => item.sessionId),
    recentActivity: data.recentActivity.map((item) => item.sessionId),
    unread8h: data.unread8h.map((item) => item.sessionId),
    unread24h: data.unread24h.map((item) => item.sessionId),
  };
}

/**
 * Creates an empty tier order structure.
 */
function createEmptyTierOrder(): TierOrder {
  return {
    needsAttention: [],
    active: [],
    recentActivity: [],
    unread8h: [],
    unread24h: [],
  };
}

interface InboxContextValue {
  /** Sessions requiring immediate user input (tool approval or question) */
  needsAttention: InboxItem[];
  /** Sessions with running processes (no pending input) */
  active: InboxItem[];
  /** Sessions updated in the last 30 minutes */
  recentActivity: InboxItem[];
  /** Unread sessions from the last 8 hours */
  unread8h: InboxItem[];
  /** Unread sessions from the last 24 hours */
  unread24h: InboxItem[];
  /** Full inbox response (all tiers) */
  inbox: InboxResponse;
  /** True while loading initial data */
  loading: boolean;
  /** Error from the last fetch attempt, if any */
  error: Error | null;
  /** Force a full refresh with server sort order */
  refresh: () => Promise<void>;
  /** Refetch data (maintains stable ordering) */
  refetch: (forceFullSort?: boolean) => Promise<void>;
  /** Count of sessions needing attention */
  totalNeedsAttention: number;
  /** Count of active sessions */
  totalActive: number;
  /** Total count of all inbox items */
  totalItems: number;
  /** Whether fetching is enabled */
  enabled: boolean;
  /** Enable or disable fetching */
  setEnabled: (enabled: boolean) => void;
}

const InboxContext = createContext<InboxContextValue | null>(null);

interface InboxProviderProps {
  children: ReactNode;
  /** Initial enabled state (default: true) */
  initialEnabled?: boolean;
}

export function InboxProvider({
  children,
  initialEnabled = true,
}: InboxProviderProps) {
  const remoteConnection = useOptionalRemoteConnection();
  const sourceKey = useClientSummarySourceKey();
  const inbox = useInboxResponseSnapshot();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [enabled, setEnabled] = useState(initialEnabled);
  const isRemoteConnectionReady =
    !isRemoteClient() ||
    (remoteConnection !== null && remoteConnection.connection !== null);

  // Track the order of session IDs per tier for stable rendering
  const tierOrderRef = useRef<TierOrder>(createEmptyTierOrder());
  // Track if we've done the initial load (determines whether to use stable ordering)
  const hasInitialLoadRef = useRef(false);
  // Track accepted responses so an older overlapping request cannot perturb the
  // stable tier order after a newer request already won.
  const latestAcceptedRequestStartedAtRef = useRef(0);
  // Debounce timer for SSE-triggered refetches
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track enabled state in ref for callbacks
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /**
   * Fetches inbox data and applies stable ordering.
   * @param forceFullSort - If true, uses server sort order instead of stable merge
   */
  const fetchInbox = useCallback(
    async (forceFullSort = false) => {
      // Skip if disabled, remote auth is still establishing, on login page,
      // or login is required (prevents transient auth errors and 401s).
      if (
        !enabledRef.current ||
        !isRemoteConnectionReady ||
        window.location.pathname === "/login" ||
        authEvents.loginRequired
      ) {
        return;
      }

      const requestStartedAt = Date.now();
      const requestSourceKey = sourceKey;
      try {
        const data = await api.getInbox();
        const nextInbox =
          !hasInitialLoadRef.current || forceFullSort
            ? data
            : mergeWithStableOrder(data, tierOrderRef.current);

        if (requestStartedAt < latestAcceptedRequestStartedAtRef.current) {
          return;
        }

        reportInboxCollectionSnapshot(
          requestSourceKey,
          nextInbox,
          requestStartedAt,
        );
        tierOrderRef.current = extractTierOrder(nextInbox);
        latestAcceptedRequestStartedAtRef.current = requestStartedAt;
        hasInitialLoadRef.current = true;
        setError(null);
      } catch (err) {
        if (requestStartedAt >= latestAcceptedRequestStartedAtRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        setLoading(false);
      }
    },
    [isRemoteConnectionReady, sourceKey],
  );

  /**
   * Force a full refresh with server-provided sort order.
   */
  const refresh = useCallback(() => {
    return fetchInbox(true);
  }, [fetchInbox]);

  /**
   * Debounced refetch - prevents rapid refetches from multiple SSE events
   */
  const debouncedRefetch = useCallback(() => {
    // Skip if disabled, remote auth is still establishing, on login page,
    // or login is required.
    if (
      !enabledRef.current ||
      !isRemoteConnectionReady ||
      window.location.pathname === "/login" ||
      authEvents.loginRequired
    ) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchInbox();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchInbox, isRemoteConnectionReady]);

  // Subscribe to SSE events for real-time updates
  // NOTE: We no longer refetch on file-change events. The inbox API primarily categorizes
  // sessions by processState and pendingInputType, which are now available via SSE events:
  // - process-state-changed: processState, pendingInputType (for needsAttention/active tiers)
  // - session-status-changed: when session becomes owned/external/idle
  // - session-created: new session
  // - session-seen: hasUnread status changes (less critical for inbox tiers)
  //
  // File changes mostly affect hasUnread, which is secondary to inbox tier categorization.
  useFileActivity({
    onProcessStateChange: debouncedRefetch,
    onSessionStatusChange: debouncedRefetch,
    onSessionSeen: debouncedRefetch,
    onSessionCreated: debouncedRefetch,
  });

  // Initial fetch when enabled (and not on login page or requiring login)
  useEffect(() => {
    if (
      enabled &&
      isRemoteConnectionReady &&
      window.location.pathname !== "/login" &&
      !authEvents.loginRequired
    ) {
      fetchInbox();
    }
  }, [enabled, fetchInbox, isRemoteConnectionReady]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Computed totals
  const totalNeedsAttention = inbox.needsAttention.length;
  const totalActive = inbox.active.length;
  const totalItems =
    inbox.needsAttention.length +
    inbox.active.length +
    inbox.recentActivity.length +
    inbox.unread8h.length +
    inbox.unread24h.length;

  return (
    <InboxContext.Provider
      value={{
        needsAttention: inbox.needsAttention,
        active: inbox.active,
        recentActivity: inbox.recentActivity,
        unread8h: inbox.unread8h,
        unread24h: inbox.unread24h,
        inbox,
        loading,
        error,
        refresh,
        refetch: fetchInbox,
        totalNeedsAttention,
        totalActive,
        totalItems,
        enabled,
        setEnabled,
      }}
    >
      {children}
    </InboxContext.Provider>
  );
}

/**
 * Hook to access inbox data from the global context.
 * Must be used within an InboxProvider.
 */
export function useInboxContext() {
  const context = useContext(InboxContext);
  if (!context) {
    throw new Error("useInboxContext must be used within an InboxProvider");
  }
  return context;
}
