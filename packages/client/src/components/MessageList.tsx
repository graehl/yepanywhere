import type { MarkdownAugment } from "@yep-anywhere/shared";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type ActiveToolApproval,
  preprocessMessages,
} from "../lib/preprocessMessages";
import { useRelativeNow } from "../hooks/useRelativeNow";
import {
  MESSAGE_STALE_THRESHOLD_MS,
  getLatestMessageTimestampMs,
  isStaleTimestamp,
  parseTimestampMs,
} from "../lib/messageAge";
import { parseUserPrompt } from "../lib/parseUserPrompt";
import {
  dispatchSessionIsearchGuideState,
  type SessionIsearchScope,
} from "../lib/sessionIsearchGuide";
import { stabilizeRenderItems } from "../lib/stableRenderItems";
import type { Message } from "../types";
import type { ContentBlock } from "../types";
import type { RenderItem } from "../types/renderItems";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { MessageAge } from "./MessageAge";
import { RenderItemComponent } from "./RenderItemComponent";
import {
  UserTurnNavigator,
  type UserTurnNavAnchor,
  type UserTurnNavSearchState,
} from "./UserTurnNavigator";

/**
 * Groups consecutive assistant items (text, thinking, tool_call) into turns.
 * User prompts break the grouping and are returned as separate groups.
 */
function groupItemsIntoTurns(
  items: RenderItem[],
): Array<{ isUserPrompt: boolean; items: RenderItem[] }> {
  const groups: Array<{ isUserPrompt: boolean; items: RenderItem[] }> = [];
  let currentAssistantGroup: RenderItem[] = [];

  for (const item of items) {
    if (item.type === "user_prompt" || item.type === "session_setup") {
      // Flush any pending assistant items
      if (currentAssistantGroup.length > 0) {
        groups.push({ isUserPrompt: false, items: currentAssistantGroup });
        currentAssistantGroup = [];
      }
      // User prompt is its own group
      groups.push({ isUserPrompt: true, items: [item] });
    } else {
      // Accumulate assistant items
      currentAssistantGroup.push(item);
    }
  }

  // Flush remaining assistant items
  if (currentAssistantGroup.length > 0) {
    groups.push({ isUserPrompt: false, items: currentAssistantGroup });
  }

  return groups;
}

const SESSION_SETUP_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
];

function getPromptTextForCorrection(content: string | ContentBlock[]): string {
  const rawText =
    typeof content === "string"
      ? content
      : content
          .filter(
            (block): block is ContentBlock & { type: "text"; text: string } =>
              block.type === "text" && typeof block.text === "string",
          )
          .map((block) => block.text)
          .join("\n");
  return parseUserPrompt(rawText).text.trim();
}

function getUserTurnPreview(content: string | ContentBlock[]): string {
  const text = getPromptTextForCorrection(content).replace(/\s+/g, " ").trim();
  return getSearchPreviewFallback(text);
}

function getSearchPreviewFallback(text: string): string {
  const compactText = text.replace(/\s+/g, " ").trim();
  if (compactText.length <= 180) {
    return compactText;
  }
  return `${compactText.slice(0, 177).trimEnd()}...`;
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function findRenderRow(
  messageList: HTMLDivElement | null,
  id: string,
): HTMLElement | null {
  if (!messageList) return null;
  for (const row of messageList.querySelectorAll<HTMLElement>(
    "[data-render-id]",
  )) {
    if (row.dataset.renderId === id) {
      return row;
    }
  }
  return null;
}

function buildSearchPreview(text: string, query: string): string {
  const compactText = text.replace(/\s+/g, " ").trim();
  const normalizedText = normalizeSearchText(compactText);
  const normalizedQuery = normalizeSearchText(query);
  const fallback =
    compactText.length > 240
      ? `${compactText.slice(0, 237).trimEnd()}...`
      : compactText;
  if (!normalizedQuery) {
    return fallback;
  }

  const matchIndexes: number[] = [];
  let searchFrom = 0;
  while (matchIndexes.length < 3) {
    const index = normalizedText.indexOf(normalizedQuery, searchFrom);
    if (index === -1) break;
    matchIndexes.push(index);
    searchFrom = index + normalizedQuery.length;
  }
  if (matchIndexes.length === 0) {
    return fallback;
  }

  return matchIndexes
    .map((index) => {
      const start = Math.max(0, index - 42);
      const end = Math.min(
        compactText.length,
        index + normalizedQuery.length + 64,
      );
      const prefix = start > 0 ? "..." : "";
      const suffix = end < compactText.length ? "..." : "";
      return `${prefix}${compactText.slice(start, end).trim()}${suffix}`;
    })
    .join(" ... ");
}

function isSessionSetupText(text: string): boolean {
  const trimmed = text.trimStart();
  return SESSION_SETUP_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

interface UserTurnSearchSession {
  active: boolean;
  scope: SessionIsearchScope;
  query: string;
  selectedId: string | null;
  originalScrollTop: number | null;
}

interface CachedUserTurnAnchor {
  item: RenderItem;
  anchor: UserTurnNavAnchor | null;
}

/** Pending message waiting for server confirmation */
interface PendingMessage {
  tempId: string;
  content: string;
  timestamp: string;
  status?: string;
}

/** Deferred message queued server-side */
interface DeferredMessage {
  tempId?: string;
  content: string;
  timestamp: string;
  attachmentCount?: number;
  blockedByEdit?: boolean;
  deliveryState?: "queued" | "sending" | "recovered";
}

interface Props {
  messages: Message[];
  provider?: string;
  isStreaming?: boolean;
  isProcessing?: boolean;
  /** True when context is being compressed */
  isCompacting?: boolean;
  /** Increment this to force scroll to bottom (e.g., when user sends a message) */
  scrollTrigger?: number;
  /** Messages waiting for server confirmation (shown as "Sending...") */
  pendingMessages?: PendingMessage[];
  /** Deferred messages queued server-side (shown as "Queued") */
  deferredMessages?: DeferredMessage[];
  /** Callback to cancel a deferred message */
  onCancelDeferred?: (tempId: string) => void;
  /** Callback to take a deferred message back into the composer */
  onEditDeferred?: (tempId: string) => void;
  /** Callback to correct the latest actually-sent user message */
  onCorrectLatestUserMessage?: (messageId: string, content: string) => void;
  /** Pre-rendered markdown HTML from server (keyed by message ID) */
  markdownAugments?: Record<string, MarkdownAugment>;
  /** Active tool approval - prevents matching orphaned tool from showing as interrupted */
  activeToolApproval?: ActiveToolApproval;
  /** Whether there are older messages not yet loaded */
  hasOlderMessages?: boolean;
  /** Whether older messages are currently being loaded */
  loadingOlder?: boolean;
  /** Callback to load the next chunk of older messages */
  onLoadOlderMessages?: () => void;
}

function PencilIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export const MessageList = memo(function MessageList({
  messages,
  provider,
  isStreaming = false,
  isProcessing = false,
  isCompacting = false,
  scrollTrigger = 0,
  pendingMessages = [],
  deferredMessages = [],
  onCancelDeferred,
  onEditDeferred,
  onCorrectLatestUserMessage,
  markdownAugments,
  activeToolApproval,
  hasOlderMessages = false,
  loadingOlder = false,
  onLoadOlderMessages,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const lastHeightRef = useRef(0);
  const followUpScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRenderItemsRef = useRef<RenderItem[]>([]);
  const userTurnAnchorCacheRef = useRef<Map<string, CachedUserTurnAnchor>>(
    new Map(),
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRestoreFocusRef = useRef<HTMLElement | null>(null);
  const searchOriginalScrollTopRef = useRef<number | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [userTurnSearch, setUserTurnSearch] =
    useState<UserTurnSearchSession>({
      active: false,
      scope: "user",
      query: "",
      selectedId: null,
      originalScrollTop: null,
    });
  const nowMs = useRelativeNow();

  // Scroll to bottom, marking it as programmatic so scroll handler ignores it
  const scrollToBottom = useCallback(
    (container: HTMLElement, behavior: ScrollBehavior = "auto") => {
      isProgrammaticScrollRef.current = true;
      const top = Math.max(0, container.scrollHeight - container.clientHeight);
      if (behavior === "auto") {
        container.scrollTop = top;
      } else {
        container.scrollTo({ top, behavior });
      }
      lastHeightRef.current = container.scrollHeight;

      // Clear programmatic flag after scroll events have fired
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });

      // Schedule a follow-up scroll to catch any async rendering (markdown, syntax highlighting)
      if (followUpScrollRef.current !== null) {
        clearTimeout(followUpScrollRef.current);
      }
      followUpScrollRef.current = setTimeout(() => {
        followUpScrollRef.current = null;
        if (shouldAutoScrollRef.current) {
          isProgrammaticScrollRef.current = true;
          const followUpTop = Math.max(
            0,
            container.scrollHeight - container.clientHeight,
          );
          if (behavior === "auto") {
            container.scrollTop = followUpTop;
          } else {
            container.scrollTo({ top: followUpTop, behavior });
          }
          lastHeightRef.current = container.scrollHeight;
          requestAnimationFrame(() => {
            isProgrammaticScrollRef.current = false;
          });
        }
      }, 50);
    },
    [],
  );

  // Preprocess messages into render items and group into turns
  const renderItems = useMemo(
    () => {
      const nextRenderItems = preprocessMessages(messages, {
        markdown: markdownAugments,
        activeToolApproval,
      });
      return stabilizeRenderItems(
        previousRenderItemsRef.current,
        nextRenderItems,
      );
    },
    [messages, markdownAugments, activeToolApproval],
  );
  useEffect(() => {
    previousRenderItemsRef.current = renderItems;
  }, [renderItems]);
  const turnGroups = useMemo(
    () => groupItemsIntoTurns(renderItems),
    [renderItems],
  );
  const userTurnNavAnchors = useMemo<UserTurnNavAnchor[]>(() => {
    const previousCache = userTurnAnchorCacheRef.current;
    const nextCache = new Map<string, CachedUserTurnAnchor>();
    const anchors: UserTurnNavAnchor[] = [];
    for (const item of renderItems) {
      if (item.type !== "user_prompt" || item.isSubagent) {
        continue;
      }
      const cached = previousCache.get(item.id);
      if (cached?.item === item) {
        nextCache.set(item.id, cached);
        if (cached.anchor) {
          anchors.push(cached.anchor);
        }
        continue;
      }
      const preview = getUserTurnPreview(item.content);
      if (!preview || isSessionSetupText(preview)) {
        nextCache.set(item.id, { item, anchor: null });
        continue;
      }
      const anchor = {
        id: item.id,
        preview,
        searchText: getPromptTextForCorrection(item.content),
      };
      nextCache.set(item.id, { item, anchor });
      anchors.push(anchor);
    }
    userTurnAnchorCacheRef.current = nextCache;
    return anchors;
  }, [renderItems]);
  const includeAllTurnSearchAnchors =
    userTurnSearch.active && userTurnSearch.scope === "all";
  const sessionTurnNavAnchors = useMemo<UserTurnNavAnchor[]>(() => {
    if (!includeAllTurnSearchAnchors) {
      return [];
    }
    const anchors: UserTurnNavAnchor[] = [];
    for (const item of renderItems) {
      if (item.type === "user_prompt") {
        const text = getPromptTextForCorrection(item.content);
        const preview = getSearchPreviewFallback(text);
        if (preview && !isSessionSetupText(preview)) {
          anchors.push({ id: item.id, preview, searchText: text });
        }
        continue;
      }
      if (item.type === "text") {
        const preview = getSearchPreviewFallback(item.text);
        if (preview) {
          anchors.push({ id: item.id, preview, searchText: item.text });
        }
        continue;
      }
      if (item.type === "system") {
        const preview = getSearchPreviewFallback(item.content);
        if (preview) {
          anchors.push({ id: item.id, preview, searchText: item.content });
        }
      }
    }
    return anchors;
  }, [includeAllTurnSearchAnchors, renderItems]);
  const activeSearchAnchors =
    userTurnSearch.scope === "all" ? sessionTurnNavAnchors : userTurnNavAnchors;
  const searchReady =
    userTurnSearch.active &&
    normalizeSearchText(userTurnSearch.query).length >= 2;
  const userTurnSearchMatches = useMemo(() => {
    if (!searchReady) {
      return [];
    }
    const query = normalizeSearchText(userTurnSearch.query);
    return activeSearchAnchors.filter((anchor) =>
      normalizeSearchText(anchor.searchText ?? anchor.preview).includes(query),
    );
  }, [activeSearchAnchors, searchReady, userTurnSearch.query]);
  const userTurnSearchMatchIds = useMemo(
    () => new Set(userTurnSearchMatches.map((anchor) => anchor.id)),
    [userTurnSearchMatches],
  );
  const userTurnSearchPreviewsById = useMemo(() => {
    const previewsById = new Map<string, string>();
    if (!searchReady) {
      return previewsById;
    }
    for (const anchor of userTurnSearchMatches) {
      previewsById.set(
        anchor.id,
        buildSearchPreview(
          anchor.searchText ?? anchor.preview,
          userTurnSearch.query,
        ),
      );
    }
    return previewsById;
  }, [searchReady, userTurnSearch.query, userTurnSearchMatches]);
  const navigatorAnchors = searchReady
    ? userTurnSearchMatches
    : userTurnSearch.active
      ? []
      : userTurnNavAnchors;
  const selectedSearchAnchor =
    userTurnSearch.selectedId && searchReady
      ? (activeSearchAnchors.find(
          (anchor) => anchor.id === userTurnSearch.selectedId,
        ) ?? null)
      : null;
  const userTurnSearchPreview =
    selectedSearchAnchor && searchReady
      ? (userTurnSearchPreviewsById.get(selectedSearchAnchor.id) ?? null)
      : null;
  const userTurnNavSearchState = useMemo<UserTurnNavSearchState | null>(
    () =>
      searchReady
        ? {
            activeId: selectedSearchAnchor?.id ?? null,
            matchIds: userTurnSearchMatchIds,
            preview: userTurnSearchPreview,
            previewsById: userTurnSearchPreviewsById,
            query: userTurnSearch.query,
          }
        : null,
    [
      searchReady,
      selectedSearchAnchor?.id,
      userTurnSearchPreviewsById,
      userTurnSearchMatchIds,
      userTurnSearchPreview,
    ],
  );

  useEffect(() => {
    dispatchSessionIsearchGuideState({
      active: userTurnSearch.active,
      scope: userTurnSearch.scope,
    });
  }, [userTurnSearch.active, userTurnSearch.scope]);

  useEffect(
    () => () => {
      dispatchSessionIsearchGuideState({ active: false, scope: "user" });
    },
    [],
  );
  const latestVisibleTimestampMs = useMemo(() => {
    let latest: number | null = null;
    const includeTimestamp = (timestampMs: number | null) => {
      if (timestampMs === null) return;
      latest = latest === null ? timestampMs : Math.max(latest, timestampMs);
    };

    for (const item of renderItems) {
      includeTimestamp(getLatestMessageTimestampMs(item.sourceMessages));
    }
    for (const pending of pendingMessages) {
      includeTimestamp(parseTimestampMs(pending.timestamp));
    }
    for (const deferred of deferredMessages) {
      includeTimestamp(parseTimestampMs(deferred.timestamp));
    }

    return latest;
  }, [renderItems, pendingMessages, deferredMessages]);
  const latestCorrectablePrompt = useMemo(() => {
    if (!onCorrectLatestUserMessage) return null;

    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
      const item = renderItems[index];
      if (!item || item.type !== "user_prompt" || item.isSubagent) {
        continue;
      }
      const content = getPromptTextForCorrection(item.content);
      if (!content || isSessionSetupText(content)) {
        continue;
      }
      return { id: item.id, content };
    }
    return null;
  }, [renderItems, onCorrectLatestUserMessage]);
  const visibleTurnGroups = useMemo(() => {
    if (!searchReady || userTurnSearchMatchIds.size === 0) {
      return turnGroups;
    }

    let currentUserTurnId: string | null = null;
    const visibleGroups: typeof turnGroups = [];
    for (const group of turnGroups) {
      const firstItem = group.items[0];
      if (group.isUserPrompt && firstItem?.type === "user_prompt") {
        currentUserTurnId = firstItem.id;
      }
      const isVisible =
        userTurnSearch.scope === "all"
          ? group.items.some((item) => userTurnSearchMatchIds.has(item.id)) ||
            (!!currentUserTurnId && userTurnSearchMatchIds.has(currentUserTurnId))
          : !!currentUserTurnId && userTurnSearchMatchIds.has(currentUserTurnId);
      if (isVisible) {
        visibleGroups.push(group);
      }
    }
    return visibleGroups;
  }, [searchReady, turnGroups, userTurnSearch.scope, userTurnSearchMatchIds]);

  const toggleThinkingExpanded = useCallback(() => {
    setThinkingExpanded((prev) => !prev);
  }, []);

  const findPreviousUserTurnMatchId = useCallback(
    (query: string, fromId?: string | null) => {
      const normalizedQuery = normalizeSearchText(query);
      if (normalizedQuery.length < 2 || activeSearchAnchors.length === 0) {
        return null;
      }
      const matches = activeSearchAnchors.filter((anchor) =>
        normalizeSearchText(anchor.searchText ?? anchor.preview).includes(
          normalizedQuery,
        ),
      );
      if (matches.length === 0) {
        return null;
      }
      const matchIds = new Set(matches.map((match) => match.id));
      const foundIndex = fromId
        ? activeSearchAnchors.findIndex((anchor) => anchor.id === fromId)
        : -1;
      const fromIndex =
        foundIndex >= 0 ? foundIndex : activeSearchAnchors.length - 1;
      for (let offset = 0; offset < activeSearchAnchors.length; offset += 1) {
        const index =
          (fromIndex - offset + activeSearchAnchors.length) %
          activeSearchAnchors.length;
        const anchor = activeSearchAnchors[index];
        if (anchor && matchIds.has(anchor.id)) {
          return anchor.id;
        }
      }
      return matches[matches.length - 1]?.id ?? null;
    },
    [activeSearchAnchors],
  );

  const cycleUserTurnSearch = useCallback(() => {
    setUserTurnSearch((previous) => {
      if (!previous.active || activeSearchAnchors.length === 0) {
        return previous;
      }
      const nextSelectedId = findPreviousUserTurnMatchId(
        previous.query,
        previous.selectedId
          ? activeSearchAnchors[
              (activeSearchAnchors.findIndex(
                (anchor) => anchor.id === previous.selectedId,
              ) -
                1 +
                activeSearchAnchors.length) %
                activeSearchAnchors.length
            ]?.id
          : null,
      );
      return { ...previous, selectedId: nextSelectedId };
    });
  }, [activeSearchAnchors, findPreviousUserTurnMatchId]);

  const scrollToRenderId = useCallback(
    (
      id: string,
      behavior: ScrollBehavior,
      align: "start" | "center" = "start",
    ) => {
      const messageList = containerRef.current;
      const scrollContainer = messageList?.parentElement;
      const row = findRenderRow(messageList, id);
      if (!scrollContainer || !row) return;
      shouldAutoScrollRef.current = false;
      const scrollRect = scrollContainer.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const offset =
        align === "center"
          ? Math.max(0, (scrollContainer.clientHeight - rowRect.height) / 2)
          : 12;
      scrollContainer.scrollTo({
        top: Math.max(
          0,
          scrollContainer.scrollTop + rowRect.top - scrollRect.top - offset,
        ),
        behavior,
      });
    },
    [],
  );

  const scrollToCurrent = useCallback(() => {
    const scrollContainer = containerRef.current?.parentElement;
    if (!scrollContainer) return;
    shouldAutoScrollRef.current = true;
    scrollToBottom(scrollContainer, "smooth");
  }, [scrollToBottom]);

  const closeUserTurnSearch = useCallback((restoreScroll: boolean) => {
    const scrollTopToRestore = restoreScroll
      ? searchOriginalScrollTopRef.current
      : null;
    const focusTarget = restoreScroll ? searchRestoreFocusRef.current : null;
    searchOriginalScrollTopRef.current = null;
    searchRestoreFocusRef.current = null;

    if (restoreScroll || focusTarget) {
      requestAnimationFrame(() => {
        const scrollContainer = containerRef.current?.parentElement;
        if (scrollContainer && scrollTopToRestore !== null) {
          scrollContainer.scrollTop = scrollTopToRestore;
        }
        if (focusTarget?.isConnected) {
          focusTarget.focus({ preventScroll: true });
        }
      });
    }

    setUserTurnSearch((previous) => {
      return {
        active: false,
        scope: previous.scope,
        query: "",
        selectedId: null,
        originalScrollTop: null,
      };
    });
  }, []);

  const openUserTurnSearch = useCallback((scope: SessionIsearchScope) => {
    const canSearch =
      scope === "all" ? renderItems.length >= 2 : userTurnNavAnchors.length >= 2;
    if (!canSearch) {
      return;
    }
    const activeElement = document.activeElement;
    searchRestoreFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    const scrollContainer = containerRef.current?.parentElement;
    searchOriginalScrollTopRef.current = scrollContainer?.scrollTop ?? null;
    setUserTurnSearch({
      active: true,
      scope,
      query: "",
      selectedId: null,
      originalScrollTop: searchOriginalScrollTopRef.current,
    });
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [renderItems.length, userTurnNavAnchors]);

  const handleUserTurnSearchQueryChange = useCallback(
    (query: string) => {
      setUserTurnSearch((previous) => ({
        ...previous,
        query,
        selectedId: findPreviousUserTurnMatchId(query),
      }));
    },
    [findPreviousUserTurnMatchId],
  );

  useEffect(() => {
    if (!searchReady || !userTurnSearch.selectedId) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrollToRenderId(userTurnSearch.selectedId as string, "smooth");
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToRenderId, searchReady, userTurnSearch.selectedId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "End" ||
          event.code === "End" ||
          event.key === "." ||
          event.code === "Period")
      ) {
        event.preventDefault();
        event.stopPropagation();
        scrollToCurrent();
        return;
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key.toLocaleLowerCase() === "r" ||
          event.key.toLocaleLowerCase() === "s")
      ) {
        event.preventDefault();
        event.stopPropagation();
        const requestedScope: SessionIsearchScope =
          event.key.toLocaleLowerCase() === "s" ? "all" : "user";
        if (userTurnSearch.active && userTurnSearch.scope === requestedScope) {
          cycleUserTurnSearch();
        } else {
          openUserTurnSearch(requestedScope);
        }
        return;
      }
      if (!userTurnSearch.active) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeUserTurnSearch(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const selectedId = userTurnSearch.selectedId;
        closeUserTurnSearch(false);
        if (selectedId) {
          requestAnimationFrame(() =>
            scrollToRenderId(selectedId, "auto", "center"),
          );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    closeUserTurnSearch,
    cycleUserTurnSearch,
    openUserTurnSearch,
    scrollToCurrent,
    scrollToRenderId,
    userTurnSearch.active,
    userTurnSearch.scope,
    userTurnSearch.selectedId,
  ]);

  // Load older messages with scroll position preservation
  const handleLoadOlder = useCallback(() => {
    if (!onLoadOlderMessages) return;
    const container = containerRef.current?.parentElement;
    if (!container) {
      onLoadOlderMessages();
      return;
    }
    // Capture scroll state before prepending older messages
    const scrollHeightBefore = container.scrollHeight;
    const scrollTopBefore = container.scrollTop;
    onLoadOlderMessages();
    // Restore scroll position after React re-renders with prepended messages
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollHeightAfter = container.scrollHeight;
        const heightDelta = scrollHeightAfter - scrollHeightBefore;
        isProgrammaticScrollRef.current = true;
        container.scrollTop = scrollTopBefore + heightDelta;
        lastHeightRef.current = container.scrollHeight;
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false;
        });
      });
    });
  }, [onLoadOlderMessages]);

  // Track scroll position to determine if user is near bottom.
  // Ignore programmatic scrolls - only user-initiated scrolls should affect auto-scroll state.
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;

    const container = containerRef.current?.parentElement;
    if (!container) return;

    const threshold = 100; // pixels from bottom
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < threshold;
  }, []);

  // Attach scroll listener to parent container
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  // Use ResizeObserver to detect content height changes (handles async markdown rendering)
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;

    const scrollContainer = container;
    lastHeightRef.current = scrollContainer.scrollHeight;

    const resizeObserver = new ResizeObserver(() => {
      const newHeight = scrollContainer.scrollHeight;
      const heightIncreased = newHeight > lastHeightRef.current;

      // Auto-scroll when content height increases and auto-scroll is enabled
      if (heightIncreased && shouldAutoScrollRef.current) {
        scrollToBottom(scrollContainer);
      } else {
        // Update height tracking even when not scrolling
        lastHeightRef.current = newHeight;
      }
    });

    // Observe the inner container (message-list) since that's what changes size
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      // Clean up any pending scroll on unmount
      if (followUpScrollRef.current !== null) {
        clearTimeout(followUpScrollRef.current);
      }
    };
  }, [scrollToBottom]);

  // Force scroll to bottom when scrollTrigger changes (user sent a message)
  useEffect(() => {
    if (scrollTrigger > 0) {
      shouldAutoScrollRef.current = true;
      const container = containerRef.current?.parentElement;
      if (container) {
        scrollToBottom(container);
      }
    }
  }, [scrollTrigger, scrollToBottom]);

  // Initial scroll to bottom on first render
  useEffect(() => {
    if (isInitialLoadRef.current && renderItems.length > 0) {
      const container = containerRef.current?.parentElement;
      if (container) {
        scrollToBottom(container);
      }
      isInitialLoadRef.current = false;
    }
  }, [renderItems.length, scrollToBottom]);

  const searchPanelTarget =
    userTurnSearch.active && typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(".session-input-inner")
      : null;
  const searchPanel = userTurnSearch.active ? (
    <div
      className="user-turn-search-panel"
      role="search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closeUserTurnSearch(false);
        }
      }}
    >
      <span className="user-turn-search-label">
        {userTurnSearch.scope === "all" ? "All turns" : "User turns"}
      </span>
      <input
        ref={searchInputRef}
        className="user-turn-search-input"
        value={userTurnSearch.query}
        onChange={(event) =>
          handleUserTurnSearchQueryChange(event.target.value)
        }
        placeholder="reverse search"
        aria-label={
          userTurnSearch.scope === "all"
            ? "Reverse search all turns"
            : "Reverse search user turns"
        }
      />
      <span className="user-turn-search-count">
        {!searchReady
          ? "2+ chars"
          : userTurnSearchMatches.length > 0
            ? `${Math.max(
                1,
                userTurnSearchMatches.findIndex(
                  (anchor) => anchor.id === userTurnSearch.selectedId,
                ) + 1,
              )}/${userTurnSearchMatches.length}`
            : "0/0"}
      </span>
      <span className="user-turn-search-keys">
        {userTurnSearch.scope === "all" ? "Ctrl+S" : "Ctrl+R"} prev / Enter jump
        / Esc cancel
      </span>
    </div>
  ) : null;

  return (
    <>
      <UserTurnNavigator
        anchors={navigatorAnchors}
        messageListRef={containerRef}
        onNavigateStart={() => {
          shouldAutoScrollRef.current = false;
        }}
        searchState={userTurnNavSearchState}
      />
      {searchPanelTarget && searchPanel
        ? createPortal(searchPanel, searchPanelTarget)
        : searchPanel}
      <div className="message-list" ref={containerRef}>
        {hasOlderMessages && (
          <div className="load-older-messages">
            <button
              type="button"
              className="load-older-button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? (
                <>
                  <span className="spinning">&#x21BB;</span> Loading...
                </>
              ) : (
                "Load older messages"
              )}
            </button>
          </div>
        )}
        {visibleTurnGroups.map((group) => {
          if (group.isUserPrompt) {
            // User prompts render directly without timeline wrapper
            const item = group.items[0];
            if (!item) return null;
            return (
              <RenderItemComponent
                key={item.id}
                item={item}
                isStreaming={isStreaming}
                thinkingExpanded={thinkingExpanded}
                toggleThinkingExpanded={toggleThinkingExpanded}
                sessionProvider={provider}
                onCorrectUserPrompt={
                  latestCorrectablePrompt?.id === item.id
                    ? () =>
                        onCorrectLatestUserMessage?.(
                          latestCorrectablePrompt.id,
                          latestCorrectablePrompt.content,
                        )
                    : undefined
                }
                nowMs={nowMs}
                latestVisibleTimestampMs={latestVisibleTimestampMs}
              />
            );
          }
          // Assistant items wrapped in timeline container - key based on first item
          const firstItem = group.items[0];
          if (!firstItem) return null;
          return (
            <div key={`turn-${firstItem.id}`} className="assistant-turn">
              {group.items.map((item) => (
                <RenderItemComponent
                  key={item.id}
                  item={item}
                  isStreaming={isStreaming}
                  thinkingExpanded={thinkingExpanded}
                  toggleThinkingExpanded={toggleThinkingExpanded}
                  sessionProvider={provider}
                  nowMs={nowMs}
                  latestVisibleTimestampMs={latestVisibleTimestampMs}
                />
              ))}
            </div>
          );
        })}
        {/* Pending messages - shown as "Uploading..." or "Sending..." until server confirms */}
        {pendingMessages.map((pending) => {
          const timestampMs = parseTimestampMs(pending.timestamp);
          const showAgeByDefault =
            latestVisibleTimestampMs === timestampMs &&
            isStaleTimestamp(
              timestampMs,
              nowMs,
              MESSAGE_STALE_THRESHOLD_MS,
            );
          return (
            <div
              key={pending.tempId}
              className={`pending-message message-render-row ${
                timestampMs !== null ? "has-message-age" : ""
              } ${showAgeByDefault ? "is-message-age-visible" : ""}`}
            >
              <div className="message-render-content">
                <div className="message-user-prompt pending-message-bubble">
                  {pending.content}
                </div>
                <div className="pending-message-status">
                  {pending.status || "Sending..."}
                </div>
              </div>
              <MessageAge timestampMs={timestampMs} nowMs={nowMs} />
            </div>
          );
        })}
        {/* Deferred messages - queued server-side, waiting for agent turn to end */}
        {deferredMessages.map((deferred, index) => {
          const canEditDeferred = !!(deferred.tempId && onEditDeferred);
          const timestampMs = parseTimestampMs(deferred.timestamp);
          const showAgeByDefault =
            latestVisibleTimestampMs === timestampMs &&
            isStaleTimestamp(
              timestampMs,
              nowMs,
              MESSAGE_STALE_THRESHOLD_MS,
            );
          return (
            <div
              key={deferred.tempId ?? `deferred-${index}`}
              className={`deferred-message message-render-row ${
                timestampMs !== null ? "has-message-age" : ""
              } ${showAgeByDefault ? "is-message-age-visible" : ""}`}
            >
              <div className="message-render-content">
                {canEditDeferred ? (
                  <button
                    type="button"
                    className="message-user-prompt deferred-message-bubble deferred-message-edit"
                    onClick={() => onEditDeferred?.(deferred.tempId as string)}
                    title="Edit queued message"
                    aria-label="Edit queued message text"
                  >
                    {deferred.content}
                  </button>
                ) : (
                  <div className="message-user-prompt deferred-message-bubble">
                    {deferred.content}
                  </div>
                )}
                <div className="deferred-message-footer">
                  <span className="deferred-message-status">
                    {deferred.deliveryState === "sending"
                      ? "Sending queued message..."
                      : deferred.deliveryState === "recovered"
                        ? "Recovered draft (not queued)"
                        : deferred.blockedByEdit
                          ? "Queued (after edit)"
                          : index === 0
                            ? "Queued (next)"
                            : `Queued (#${index + 1})`}
                  </span>
                  {deferred.attachmentCount ? (
                    <span
                      className="deferred-message-attachments"
                      title={`${deferred.attachmentCount} attachment${
                        deferred.attachmentCount === 1 ? "" : "s"
                      } queued`}
                      aria-label={`${deferred.attachmentCount} attachment${
                        deferred.attachmentCount === 1 ? "" : "s"
                      } queued`}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <span>{deferred.attachmentCount}</span>
                    </span>
                  ) : null}
                  {(canEditDeferred ||
                    (deferred.tempId && onCancelDeferred)) && (
                    <div className="deferred-message-actions">
                      {canEditDeferred && (
                        <button
                          type="button"
                          className="deferred-message-action deferred-message-action-edit"
                          onClick={() =>
                            onEditDeferred?.(deferred.tempId as string)
                          }
                          aria-label="Edit queued message"
                          title="Edit queued message"
                        >
                          <PencilIcon />
                          <span>Edit</span>
                        </button>
                      )}
                      {deferred.tempId && onCancelDeferred && (
                        <button
                          type="button"
                          className="deferred-message-action deferred-message-action-cancel"
                          onClick={() =>
                            onCancelDeferred(deferred.tempId as string)
                          }
                          aria-label="Cancel queued message"
                          title="Cancel queued message"
                        >
                          <XIcon />
                          <span>Cancel</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <MessageAge timestampMs={timestampMs} nowMs={nowMs} />
            </div>
          );
        })}
        {/* Compacting indicator - shown when context is being compressed */}
        {isCompacting && (
          <div className="system-message system-message-compacting">
            <span className="system-message-icon spinning">⟳</span>
            <span className="system-message-text">Compacting context...</span>
          </div>
        )}
        <ProcessingIndicator isProcessing={isProcessing} />
      </div>
    </>
  );
});
