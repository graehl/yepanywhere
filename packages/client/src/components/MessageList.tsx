import type {
  MarkdownAugment,
  ProjectQueueItemStatus,
  SessionQueuedMessageSummary,
  TranscriptDisplayObject,
  UploadedFile,
} from "@yep-anywhere/shared";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  createCommentAnchor,
  type CommentAnchor,
  draftQuoteSignaturesContainAnchor,
  type DraftTextChangeMetadata,
  getCommentAnchorRange,
  getDraftQuoteLineSignatures,
} from "../lib/commentAnchors";
import { getShowThinkingSetting } from "../hooks/useModelSettings";
import { useAlwaysShowQuoteCircles } from "../hooks/useAlwaysShowQuoteCircles";
import { useRelativeNow } from "../hooks/useRelativeNow";
import { useI18n } from "../i18n";
import { markReloadPerfPhase } from "../lib/diagnostics/reloadPerfProbe";
import {
  copyMarkdownSelectionToClipboard,
  extractMarkdownSnippetsFromSelection,
} from "../lib/markdownSelectionCopy";
import {
  formatCompactRelativeAge,
  getLatestMessageTimestampMs,
  MESSAGE_STALE_THRESHOLD_MS,
} from "../lib/messageAge";
import type { ActiveToolApproval } from "../lib/preprocessMessages";
import {
  dispatchSessionIsearchGuideState,
  type SessionIsearchScope,
} from "../lib/sessionIsearchGuide";
import type { SessionRouteScrollSnapshot } from "../lib/sessionRouteSnapshots";
import {
  buildComposerTailDisplayRows,
  buildSessionDetailRenderItems,
  buildTimelineEntryDisplayRows,
  buildVisibleTimelineEntries,
  countThinkingItems,
  getAllTurnSearchAnchors,
  getDisplayRenderItems,
  getFullSessionSearchAnchors,
  getLastTimestampedRenderItem,
  getLatestVisibleTimestampMs,
  getLatestThinkingItemId,
  getNextProgressiveEntryCount,
  getProgressiveTimelineVisibility,
  getTailEntryCountForRenderItemTarget,
  getSearchMatchProjection,
  getSearchableUserTurnPreview,
  getSearchSelectionProjection,
  getSearchVisibleTurnGroups,
  getThinkingItemIds,
  getThinkingTextLengths,
  getUserTurnNavAnchors,
  getUserTurnSearchAnchors,
  groupEndsVisibleTurn,
  groupRenderItemsIntoTurns,
  hasVisibleThinkingTextDelta,
  normalizeSearchText,
  reconcileAutoExpandedThinkingItemIds,
  selectLatestCorrectablePrompt,
  type ComposerTailLanePosition,
  type RenderTurnGroup,
} from "../lib/sessionDetail/renderSelectors";
import { UI_KEYS } from "../lib/storageKeys";
import type { Message } from "../types";
import type { RenderItem } from "../types/renderItems";
import { AttachmentChip } from "./AttachmentChip";
import {
  BtwAsideTranscript,
  type BtwAsideTranscriptTurn,
} from "./BtwAsidePane";
import { ExploredToolGroup } from "./blocks/ExploredToolGroup";
import { MessageAge } from "./MessageAge";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { RenderItemComponent } from "./RenderItemComponent";
import {
  type UserTurnNavAnchor,
  UserTurnNavigator,
  type UserTurnNavMotionCue,
  type UserTurnNavSearchState,
} from "./UserTurnNavigator";
import { CopyTextButton } from "./ui/CopyTextButton";

const EMPTY_TRANSCRIPT_DISPLAY_OBJECTS: readonly TranscriptDisplayObject[] = [];
const SELECTION_QUOTE_BUTTON_SIZE_PX = 30;
const SELECTION_QUOTE_BUTTON_GAP_PX = 8;
const PROGRESSIVE_INITIAL_RENDER_ITEM_TARGET = 120;
const PROGRESSIVE_RENDER_ITEM_BATCH_TARGET = 90;
const PROGRESSIVE_RENDER_BATCH_DELAY_MS = 32;
const PROGRESSIVE_RENDER_REVEAL_DELAY_MS = 180;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isCtrlKeyShortcut(
  event: KeyboardEvent,
  key: string,
  code: string,
  options: { allowAlt?: boolean } = {},
): boolean {
  if (
    !event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (!options.allowAlt && event.altKey) ||
    event.getModifierState("AltGraph")
  ) {
    return false;
  }
  return event.key.toLocaleLowerCase() === key || event.code === code;
}

function getSessionIsearchShortcutScope(
  event: KeyboardEvent,
): SessionIsearchScope | null {
  if (
    isCtrlKeyShortcut(event, "s", "KeyS", { allowAlt: true }) &&
    event.altKey
  ) {
    return "full";
  }
  if (isCtrlKeyShortcut(event, "s", "KeyS")) {
    return "all";
  }
  if (isCtrlKeyShortcut(event, "r", "KeyR", { allowAlt: true })) {
    return "user";
  }
  return null;
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

interface VisibleRenderAnchor {
  id: string;
  topOffset: number;
}

function getVisibleTurnEndTimestampMs(
  messageList: HTMLDivElement,
  scrollContainer: HTMLElement,
  groups: readonly RenderTurnGroup[],
): number | null {
  const containerRect = scrollContainer.getBoundingClientRect();
  let timestampMs: number | null = null;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group || !groupEndsVisibleTurn(group, groups[index + 1])) {
      continue;
    }
    const item = getLastTimestampedRenderItem(group.items);
    if (!item) {
      continue;
    }
    const row = findRenderRow(messageList, item.id);
    if (!row) {
      continue;
    }
    const rowRect = row.getBoundingClientRect();
    if (
      rowRect.bottom >= containerRect.top &&
      rowRect.bottom <= containerRect.bottom
    ) {
      timestampMs = getLatestMessageTimestampMs(item.sourceMessages);
    }
  }

  return timestampMs;
}

function getMiddleVisibleTimestampMs(
  messageList: HTMLDivElement,
  scrollContainer: HTMLElement,
  items: readonly RenderItem[],
): number | null {
  const containerRect = scrollContainer.getBoundingClientRect();
  const middleY = containerRect.top + containerRect.height / 2;
  const timestampsById = new Map<string, number>();

  for (const item of items) {
    const timestampMs = getLatestMessageTimestampMs(item.sourceMessages);
    if (timestampMs !== null) {
      timestampsById.set(item.id, timestampMs);
    }
  }

  let best: { distance: number; timestampMs: number } | null = null;
  for (const row of messageList.querySelectorAll<HTMLElement>(
    "[data-render-id]",
  )) {
    const id = row.dataset.renderId;
    if (!id) {
      continue;
    }
    const timestampMs = timestampsById.get(id);
    if (timestampMs === undefined) {
      continue;
    }
    const rowRect = row.getBoundingClientRect();
    const visible =
      rowRect.bottom >= containerRect.top &&
      rowRect.top <= containerRect.bottom;
    if (!visible) {
      continue;
    }
    const distance =
      rowRect.top <= middleY && rowRect.bottom >= middleY
        ? 0
        : Math.min(
            Math.abs(rowRect.top - middleY),
            Math.abs(rowRect.bottom - middleY),
          );
    if (!best || distance <= best.distance) {
      best = { distance, timestampMs };
    }
  }

  return best?.timestampMs ?? null;
}

function getTranscriptPositionTimestampMs(
  messageList: HTMLDivElement,
  scrollContainer: HTMLElement,
  groups: readonly RenderTurnGroup[],
  items: readonly RenderItem[],
): number | null {
  return (
    getVisibleTurnEndTimestampMs(messageList, scrollContainer, groups) ??
    getMiddleVisibleTimestampMs(messageList, scrollContainer, items)
  );
}

function getFirstVisibleRenderAnchor(
  messageList: HTMLDivElement,
  scrollContainer: HTMLElement,
): VisibleRenderAnchor | null {
  const containerRect = scrollContainer.getBoundingClientRect();
  for (const row of messageList.querySelectorAll<HTMLElement>(
    "[data-render-id]",
  )) {
    const id = row.dataset.renderId;
    if (!id) {
      continue;
    }
    const rowRect = row.getBoundingClientRect();
    if (
      rowRect.bottom > containerRect.top &&
      rowRect.top < containerRect.bottom
    ) {
      return {
        id,
        topOffset: rowRect.top - containerRect.top,
      };
    }
  }
  return null;
}

function shouldRestoreInitialScrollSnapshot(
  snapshot: SessionRouteScrollSnapshot,
): boolean {
  if (snapshot.atBottom) {
    return true;
  }

  // A top-of-transcript snapshot, with or without a first-row anchor, can be
  // produced by a transient cached/progressive restore before tail follow has
  // settled. Treat it as "no useful retained position" so ordinary session
  // opens follow the tail instead of pinning the transcript to the top.
  if (snapshot.scrollTop <= FOLLOW_BOTTOM_TOLERANCE_PX) {
    return false;
  }

  return true;
}

function getSearchScopeLabel(scope: SessionIsearchScope): string {
  if (scope === "full") {
    return "Full session";
  }
  return scope === "all" ? "All turns" : "User turns";
}

function getSearchScopeAriaLabel(scope: SessionIsearchScope): string {
  if (scope === "full") {
    return "Reverse search full session";
  }
  return scope === "all"
    ? "Reverse search all turns"
    : "Reverse search user turns";
}

function getSearchScopeKeys(scope: SessionIsearchScope): string {
  if (scope === "full") {
    return "Ctrl+Alt+S";
  }
  return scope === "all" ? "Ctrl+S" : "Ctrl+R/Ctrl+Alt+R";
}

interface UserTurnSearchSession {
  active: boolean;
  scope: SessionIsearchScope;
  query: string;
  caseSensitive: boolean;
  selectedId: string | null;
  originalScrollTop: number | null;
}

const NAV_MOTION_CUE_CLEAR_MS = 760;
const SEARCH_ARROW_REPEAT_DELAY_MS = 150;
const SEARCH_ARROW_REPEAT_INTERVAL_MS = 42;
const MIN_BOTTOM_FOLLOW_THRESHOLD_PX = 120;
const MAX_BOTTOM_FOLLOW_THRESHOLD_PX = 520;
const BOTTOM_FOLLOW_VIEWPORT_FRACTION = 0.45;
const FOLLOW_CATCH_UP_DELAYS_MS = [50, 120, 240, 480, 960, 1600, 2400];
const SEND_CATCH_UP_DELAYS_MS = [80, 240, 640];
const TOUCH_SCROLL_CANCEL_THRESHOLD_PX = 6;
const INTERACTIVE_SCROLL_TARGET_SELECTOR =
  "button, input, textarea, select, a[href], [contenteditable='true']";

function highResolutionNowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function isNearScrollBottom(container: HTMLElement): boolean {
  const followThreshold = Math.min(
    MAX_BOTTOM_FOLLOW_THRESHOLD_PX,
    Math.max(
      MIN_BOTTOM_FOLLOW_THRESHOLD_PX,
      container.clientHeight * BOTTOM_FOLLOW_VIEWPORT_FRACTION,
    ),
  );
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    followThreshold
  );
}

// Tolerance for "the last line is in view" — sub-pixel / zoom / high-DPI
// rounding only, not a behavioural band.
const FOLLOW_BOTTOM_TOLERANCE_PX = 4;

// "At bottom" for follow purposes = the last rendered line is in view (its
// bottom edge at or above the viewport bottom), not that scrollTop reached the
// literal pixel-bottom. So trailing padding below the processing indicator
// needn't be scrolled past ("as soon as the fun-text line shows, we're
// following"), and the indicator being absent is handled for free —
// lastElementChild is then the last message row. The generous isNearScrollBottom
// stays only for *continuing* an already-on follow through fast-streaming gaps;
// re-acquiring follow is governed here.
//
// Deliberately position-only, with no scroll-direction inference. Momentum
// scrolling fires scroll events after the finger has lifted, and iOS rubber-band
// bounce briefly overshoots the bottom then springs back — both corrupt any
// velocity/direction reading. "Is the bottom line visible right now" stays
// consistent through momentum and bounce (during a bottom bounce the last line
// is *more* in view, which correctly reads as at-bottom), so it needs no
// direction tracking and no settle timer. Exit-follow stays sensitive via the
// directional wheel/touch/key handlers, which fire on intent during the touch,
// before momentum begins.
function isAtScrollBottom(
  viewport: HTMLElement,
  content: HTMLElement,
): boolean {
  const lastLine = content.lastElementChild;
  if (!lastLine) {
    return (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
      FOLLOW_BOTTOM_TOLERANCE_PX
    );
  }
  return (
    lastLine.getBoundingClientRect().bottom <=
    viewport.getBoundingClientRect().bottom + FOLLOW_BOTTOM_TOLERANCE_PX
  );
}

function eventTargetIsInside(
  target: EventTarget | null,
  container: HTMLElement,
): boolean {
  return target instanceof Node && container.contains(target);
}

function isInteractiveScrollTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(INTERACTIVE_SCROLL_TARGET_SELECTOR) !== null
  );
}

function loadSessionThinkingVisible(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(UI_KEYS.sessionThinkingVisible) !==
      "false"
    );
  } catch {
    return true;
  }
}

function saveSessionThinkingVisible(visible: boolean) {
  try {
    globalThis.localStorage?.setItem(
      UI_KEYS.sessionThinkingVisible,
      visible ? "true" : "false",
    );
  } catch {
    // localStorage is only a display preference; in-memory state still applies.
  }
}

// Auto-expand policy for thinking blocks. Off (default): every newly-arriving
// block stays expanded ("all-new"). On: only the most-recent block is
// auto-open; it auto-collapses once a newer block appears ("latest-only").
// Manual per-block toggles win over either policy. See
// topics/thinking-expand-latest-only.md.
function loadSessionThinkingLatestOnly(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(UI_KEYS.sessionThinkingLatestOnly) ===
      "true"
    );
  } catch {
    return false;
  }
}

function saveSessionThinkingLatestOnly(latestOnly: boolean) {
  try {
    globalThis.localStorage?.setItem(
      UI_KEYS.sessionThinkingLatestOnly,
      latestOnly ? "true" : "false",
    );
  } catch {
    // localStorage is only a display preference; in-memory state still applies.
  }
}

function providerExpandsHistoricalThinking(provider: string | undefined) {
  return provider === "pi";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}\u202fb`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}\u202fkb`;
  if (bytes < 1024 * 1024 * 1024)
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}\u202fmb`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10}\u202fgb`;
}

/** Pending message waiting for server confirmation */
interface PendingMessage {
  tempId: string;
  content: string;
  timestamp: string;
  clientOrder?: number;
  status?: string;
  attachments?: UploadedFile[];
}

/** Deferred message queued server-side */
type DeferredMessage = SessionQueuedMessageSummary;

interface InlineProjectQueueMessage {
  id: string;
  content: string;
  timestamp: string;
  status: ProjectQueueItemStatus;
  projectPosition: number;
  attachmentCount?: number;
  attachments?: UploadedFile[];
  lastError?: string;
  isMutating?: boolean;
}

function formatQueuedAge(timestampMs: number, nowMs: number): string {
  const label = formatCompactRelativeAge(timestampMs, nowMs);
  return label === "now" ? "now" : `${label} ago`;
}

function getDeferredMessageStatus({
  isPatient,
  lanePosition,
  timestampMs,
  nowMs,
}: {
  isPatient: boolean;
  lanePosition: ComposerTailLanePosition | undefined;
  timestampMs: number | null;
  nowMs: number;
}): string {
  if (isPatient) {
    const age =
      timestampMs !== null ? formatQueuedAge(timestampMs, nowMs) : null;
    const position =
      lanePosition?.patientIndex === undefined
        ? ""
        : lanePosition.patientIndex === 0
          ? "waiting"
          : `#${lanePosition.patientIndex + 1}`;
    const detail = [position, age].filter(Boolean).join(", ");
    return detail ? `Patient (${detail})` : "Patient queued";
  }

  const regularIndex = lanePosition?.regularIndex ?? 0;
  return regularIndex === 0
    ? "Queued (next regular)"
    : `Queued regular (#${regularIndex + 1})`;
}

interface BtwAsideTimelineItem {
  id: string;
  request: string;
  followUps: string[];
  status: "draft" | "starting" | "running" | "complete" | "failed" | "stopped";
  createdAt: string;
  updatedAt: string;
  historyAt?: string;
  preview?: string;
  error?: string;
  responses: string[];
  turns?: BtwAsideTranscriptTurn[];
  expanded?: boolean;
  isFocused?: boolean;
  canStop?: boolean;
}

interface Props {
  messages: Message[];
  transcriptDisplayObjects?: readonly TranscriptDisplayObject[];
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
  /** Project Queue items targeting this session (shown below local queue). */
  projectQueueMessages?: InlineProjectQueueMessage[];
  /** YA-owned /btw cards that have entered the scrollback timeline. */
  btwAsides?: BtwAsideTimelineItem[];
  /** Focus this /btw aside for follow-up turns. */
  onFocusBtwAside?: (asideId: string) => void;
  /** Exit focused /btw follow-up mode. */
  onDoneBtwAside?: () => void;
  /** Interrupt/abort a running /btw aside. */
  onStopBtwAside?: (asideId: string) => void;
  /** Toggle the inline /btw transcript preview. */
  onToggleBtwAsideExpanded?: (asideId: string) => void;
  /** Insert a /btw transcript turn into the Mother composer. */
  onTransferBtwAsideTurn?: (text: string) => void;
  /** Append quoted assistant output to the composer. */
  onQuoteSelection?: (quotedText: string) => string | null;
  /** Read current composer draft for quote tint reconciliation. */
  getComposerDraft?: () => string;
  composerDraft?: string;
  composerDraftChange?: DraftTextChangeMetadata;
  /** Clear all comment anchors after the quoted turn is sent. */
  quoteClearSignal?: number;
  /** Callback to cancel a deferred message */
  onCancelDeferred?: (tempId: string) => void;
  /** Callback to resume a restart-paused recovered queue entry */
  onResumeRecoveredDeferred?: (queueId: string) => void;
  /** Callback to delete a restart-paused recovered queue entry */
  onDeleteRecoveredDeferred?: (queueId: string) => void;
  /** Callback to cancel a Project Queue item */
  onCancelProjectQueueMessage?: (itemId: string) => void;
  /** Callback to correct the latest actually-sent user message */
  onCorrectLatestUserMessage?: (messageId: string, content: string) => void;
  /** Callback to aggressively reload the client transcript from a user turn */
  onTrimBeforeUserMessage?: (messageId: string) => void;
  /** Fork the session from just before the given user message (real prefix fork only). */
  onForkBeforeUserMessage?: (messageId: string) => void;
  /** Fork after the completed turn for this user message, optionally with a summary. */
  onForkAfterUserMessage?: (messageId: string) => void;
  /** Copy the given user turn's text (turn-notch context menu). */
  onCopyUserMessage?: (messageId: string) => void;
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
  /** Whether the client transcript is intentionally loaded from a recent tail */
  clientTailActive?: boolean;
  /** Render the recent transcript tail first, then hydrate older rows in batches. */
  progressiveRenderEnabled?: boolean;
  /** Show detailed progressive render text and progress bar while hydrating. */
  progressiveRenderStatusVisible?: boolean;
  /** Stable identity for one progressive initial-render cycle. */
  progressiveRenderKey?: string;
  initialScrollSnapshot?: SessionRouteScrollSnapshot | null;
  onScrollSnapshotChange?: (snapshot: SessionRouteScrollSnapshot) => void;
  interactionDisabled?: boolean;
  onTranscriptPositionTimestampChange?: (timestampMs: number | null) => void;
  getForkSummaryTargetHref?: (targetSessionId: string) => string;
  onCancelForkSummary?: (objectId: string) => void;
  onToggleForkSummaryAutoOpen?: (objectId: string, value: boolean) => void;
  onFollowForkSummary?: (objectId: string) => void;
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

function PlayIcon({ size = 14 }: { size?: number }) {
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
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

function BtwAsideTimelineCard({
  aside,
  onFocus,
  onDone,
  onStop,
  onToggleExpanded,
  onTransferTurn,
}: {
  aside: BtwAsideTimelineItem;
  onFocus?: (asideId: string) => void;
  onDone?: () => void;
  onStop?: (asideId: string) => void;
  onToggleExpanded?: (asideId: string) => void;
  onTransferTurn?: (text: string) => void;
}) {
  const { t } = useI18n();
  const canExpand = Boolean(
    aside.request ||
      aside.followUps.length > 0 ||
      aside.responses.length > 0 ||
      (aside.turns?.length ?? 0) > 0,
  );

  return (
    <div
      className={`btw-aside-card btw-aside-card-history is-${aside.status} ${
        aside.isFocused ? "is-focused" : ""
      }`}
      data-render-id={`btw-${aside.id}`}
    >
      <button
        type="button"
        className="btw-aside-main"
        onClick={() => onFocus?.(aside.id)}
      >
        <span className="btw-aside-meta">/btw {aside.status}</span>
        <span className="btw-aside-request">
          {aside.request || "New aside"}
        </span>
        {aside.followUps.length > 0 && (
          <span className="btw-aside-followups">
            +{aside.followUps.length} follow-up
            {aside.followUps.length === 1 ? "" : "s"}
          </span>
        )}
        {aside.preview && (
          <span className="btw-aside-preview">{aside.preview}</span>
        )}
        {aside.error && <span className="btw-aside-error">{aside.error}</span>}
      </button>
      {aside.expanded && canExpand && (
        <BtwAsideTranscript
          aside={aside}
          autoScrollLatest
          onTransferToComposer={onTransferTurn}
        />
      )}
      <div className="btw-aside-actions">
        {canExpand && (
          <button
            type="button"
            className="btw-aside-action"
            onClick={() => onToggleExpanded?.(aside.id)}
          >
            {aside.expanded ? "Less" : "Show"}
          </button>
        )}
        {aside.isFocused ? (
          <button
            type="button"
            className="btw-aside-action"
            onClick={onDone}
            title={t("btwAsideReturnComposerTitle")}
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            className="btw-aside-action"
            onClick={() => onFocus?.(aside.id)}
          >
            Focus
          </button>
        )}
        {aside.canStop && (
          <button
            type="button"
            className="btw-aside-action btw-aside-action-stop"
            onClick={() => onStop?.(aside.id)}
            title={
              aside.isFocused
                ? "Stop this /btw aside and return to the main session"
                : "Stop this /btw aside"
            }
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

export const MessageList = memo(function MessageList({
  messages,
  transcriptDisplayObjects = EMPTY_TRANSCRIPT_DISPLAY_OBJECTS,
  provider,
  isStreaming = false,
  isProcessing = false,
  isCompacting = false,
  scrollTrigger = 0,
  pendingMessages = [],
  deferredMessages = [],
  projectQueueMessages = [],
  btwAsides = [],
  onFocusBtwAside,
  onDoneBtwAside,
  onStopBtwAside,
  onToggleBtwAsideExpanded,
  onTransferBtwAsideTurn,
  onQuoteSelection,
  getComposerDraft,
  composerDraft = "",
  composerDraftChange,
  quoteClearSignal = 0,
  onCancelDeferred,
  onResumeRecoveredDeferred,
  onDeleteRecoveredDeferred,
  onCancelProjectQueueMessage,
  onCorrectLatestUserMessage,
  onTrimBeforeUserMessage,
  onForkBeforeUserMessage,
  onForkAfterUserMessage,
  onCopyUserMessage,
  markdownAugments,
  activeToolApproval,
  hasOlderMessages = false,
  loadingOlder = false,
  onLoadOlderMessages,
  clientTailActive = false,
  progressiveRenderEnabled = false,
  progressiveRenderStatusVisible = true,
  progressiveRenderKey,
  initialScrollSnapshot = null,
  onScrollSnapshotChange,
  interactionDisabled = false,
  onTranscriptPositionTimestampChange,
  getForkSummaryTargetHref,
  onCancelForkSummary,
  onToggleForkSummaryAutoOpen,
  onFollowForkSummary,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousInteractionDisabledRef = useRef(interactionDisabled);
  const isInitialLoadRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const lastHeightRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const followUpScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forcedCurrentScrollTimersRef = useRef<ReturnType<typeof setTimeout>[]>(
    [],
  );
  const programmaticScrollReleaseRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const progressiveActiveRenderKeyRef = useRef<string | null>(null);
  const progressiveCompletedRenderKeyRef = useRef<string | null>(null);
  const previousRenderItemsRef = useRef<RenderItem[]>([]);
  const previousThinkingTextLengthsRef = useRef<Map<string, number> | null>(
    null,
  );
  const observedThinkingItemIdsRef = useRef<ReadonlySet<string> | null>(null);
  const autoExpandedHistoricalThinkingProviderRef = useRef<string | null>(null);
  const thinkingDeltaFollowAllowedRef = useRef(false);
  const navMotionCueTokenRef = useRef(0);
  const navMotionCueClearTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const previousProgressiveRevealActiveRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRestoreFocusRef = useRef<HTMLElement | null>(null);
  const searchOriginalScrollTopRef = useRef<number | null>(null);
  const selectedSearchTargetIdRef = useRef<string | null>(null);
  const searchArrowRepeatTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const searchArrowRepeatIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const searchArrowRepeatDirectionRef = useRef<"previous" | "next" | null>(
    null,
  );
  const selectionPointerStartRef = useRef<{ clientY: number } | null>(null);
  const quoteInsertionDraftRef = useRef<string | null>(null);
  const [thinkingItemsVisible, setThinkingItemsVisible] = useState(() => {
    // "Show thinking" preference seeds the render gate's default; "default"
    // falls back to the live eye-toggle value. The eye icon still overrides
    // within a view.
    const showThinking = getShowThinkingSetting();
    if (showThinking === "on") return true;
    if (showThinking === "off") return false;
    return loadSessionThinkingVisible();
  });
  const [thinkingExpansionOverrides, setThinkingExpansionOverrides] = useState<
    Record<string, boolean>
  >({});
  const [thinkingLatestOnly, setThinkingLatestOnly] = useState(
    loadSessionThinkingLatestOnly,
  );
  const [autoExpandedThinkingItemIds, setAutoExpandedThinkingItemIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [navMotionCue, setNavMotionCue] = useState<UserTurnNavMotionCue | null>(
    null,
  );
  const [hoveredMarkerTimestampMs, setHoveredMarkerTimestampMs] = useState<
    number | null
  >(null);
  const [scrollPositionTimestampMs, setScrollPositionTimestampMs] = useState<
    number | null
  >(null);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [userTurnSearch, setUserTurnSearch] = useState<UserTurnSearchSession>({
    active: false,
    scope: "user",
    query: "",
    caseSensitive: false,
    selectedId: null,
    originalScrollTop: null,
  });
  const [commentAnchors, setCommentAnchors] = useState<
    readonly CommentAnchor[]
  >([]);
  const [floatingQuoteButton, setFloatingQuoteButton] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const { alwaysShowQuoteCircles } = useAlwaysShowQuoteCircles();
  const { t } = useI18n();
  const nowMs = useRelativeNow();

  const applyQuoteAnchors = useCallback(
    (anchors: readonly CommentAnchor[], typedPrefix = "") => {
      if (!onQuoteSelection || anchors.length === 0) {
        return false;
      }
      const quotedText = anchors
        .map((anchor) => anchor.quotedText)
        .join("\n\n");
      const nextDraft = onQuoteSelection(
        typedPrefix ? `${quotedText}\n${typedPrefix}` : `${quotedText}\n`,
      );
      if (nextDraft === null) {
        return false;
      }
      quoteInsertionDraftRef.current = nextDraft;
      setCommentAnchors((previous) => [...previous, ...anchors]);
      containerRef.current?.ownerDocument.getSelection()?.removeAllRanges();
      setFloatingQuoteButton(null);
      return true;
    },
    [onQuoteSelection],
  );

  const applyQuoteFromSelection = useCallback(
    (typedPrefix = "") => {
      const root = containerRef.current;
      if (!root) {
        return false;
      }
      const anchors =
        extractMarkdownSnippetsFromSelection(root).map(createCommentAnchor);
      return applyQuoteAnchors(anchors, typedPrefix);
    },
    [applyQuoteAnchors],
  );

  const handleQuoteTextBlock = useCallback(
    (anchor: CommentAnchor) => {
      applyQuoteAnchors([anchor]);
    },
    [applyQuoteAnchors],
  );

  useEffect(() => {
    if (commentAnchors.length === 0) {
      return;
    }
    const insertionDraft = quoteInsertionDraftRef.current;
    if (
      insertionDraft === null &&
      composerDraftChange?.mayAffectQuoteAnchors === false
    ) {
      return;
    }
    const draft = insertionDraft ?? getComposerDraft?.() ?? composerDraft;
    quoteInsertionDraftRef.current = null;
    const draftSignatures = getDraftQuoteLineSignatures(draft);
    setCommentAnchors((previous) => {
      const next = previous.filter((anchor) =>
        draftQuoteSignaturesContainAnchor(draftSignatures, anchor),
      );
      return next.length === previous.length ? previous : next;
    });
  }, [
    commentAnchors.length,
    composerDraft,
    composerDraftChange,
    getComposerDraft,
  ]);

  useEffect(() => {
    if (quoteClearSignal > 0) {
      setCommentAnchors([]);
    }
  }, [quoteClearSignal]);

  useEffect(() => {
    if (
      typeof CSS === "undefined" ||
      !("highlights" in CSS) ||
      typeof Highlight === "undefined"
    ) {
      return;
    }

    if (commentAnchors.length === 0) {
      CSS.highlights.delete("comment-tint");
      return;
    }

    const ranges = commentAnchors
      .map(getCommentAnchorRange)
      .filter((range): range is Range => range !== null);
    if (ranges.length === 0) {
      CSS.highlights.delete("comment-tint");
      return;
    }

    const highlight = new Highlight(...ranges);
    CSS.highlights.set("comment-tint", highlight);
    return () => {
      CSS.highlights.delete("comment-tint");
    };
  }, [commentAnchors]);

  // Scroll to bottom, marking it as programmatic so scroll handler ignores it
  const scrollToBottom = useCallback(
    (container: HTMLElement, behavior: ScrollBehavior = "auto") => {
      isProgrammaticScrollRef.current = true;
      if (programmaticScrollReleaseRef.current !== null) {
        clearTimeout(programmaticScrollReleaseRef.current);
        programmaticScrollReleaseRef.current = null;
      }
      const top = Math.max(0, container.scrollHeight - container.clientHeight);
      if (behavior === "auto") {
        container.scrollTop = top;
      } else {
        container.scrollTo({ top, behavior });
      }
      lastHeightRef.current = container.scrollHeight;
      setIsScrolledToBottom(true);
      setScrollPositionTimestampMs(null);

      // Clear programmatic flag after scroll events have fired
      const releaseProgrammaticScroll = () => {
        isProgrammaticScrollRef.current = false;
        programmaticScrollReleaseRef.current = null;
        if (isNearScrollBottom(container)) {
          shouldAutoScrollRef.current = true;
          setIsScrolledToBottom(true);
        }
      };
      if (behavior === "smooth") {
        programmaticScrollReleaseRef.current = setTimeout(
          releaseProgrammaticScroll,
          520,
        );
      } else {
        requestAnimationFrame(releaseProgrammaticScroll);
      }

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
          setIsScrolledToBottom(true);
          if (programmaticScrollReleaseRef.current === null) {
            requestAnimationFrame(() => {
              isProgrammaticScrollRef.current = false;
            });
          }
        }
      }, 50);
    },
    [],
  );

  const clearForcedCurrentScrollTimers = useCallback(() => {
    for (const timer of forcedCurrentScrollTimersRef.current) {
      clearTimeout(timer);
    }
    forcedCurrentScrollTimersRef.current = [];
  }, []);

  const clearFollowUpScrollTimer = useCallback(() => {
    if (followUpScrollRef.current !== null) {
      clearTimeout(followUpScrollRef.current);
      followUpScrollRef.current = null;
    }
  }, []);

  const stopFollowingForUserScroll = useCallback(
    (container: HTMLElement | null | undefined) => {
      shouldAutoScrollRef.current = false;
      thinkingDeltaFollowAllowedRef.current = false;
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollReleaseRef.current !== null) {
        clearTimeout(programmaticScrollReleaseRef.current);
        programmaticScrollReleaseRef.current = null;
      }
      clearFollowUpScrollTimer();
      clearForcedCurrentScrollTimers();
      if (container) {
        lastHeightRef.current = container.scrollHeight;
      }
      setIsScrolledToBottom(false);
    },
    [clearFollowUpScrollTimer, clearForcedCurrentScrollTimers],
  );

  const forceScrollToCurrent = useCallback(
    (
      delays: readonly number[] = FOLLOW_CATCH_UP_DELAYS_MS,
      options: { allowThinkingDeltas?: boolean } = {},
    ) => {
      shouldAutoScrollRef.current = true;
      if (options.allowThinkingDeltas) {
        thinkingDeltaFollowAllowedRef.current = true;
      }
      const container = containerRef.current?.parentElement;
      if (container) {
        scrollToBottom(container);
      }

      clearForcedCurrentScrollTimers();
      forcedCurrentScrollTimersRef.current = delays.map((delay) =>
        setTimeout(() => {
          if (!shouldAutoScrollRef.current) {
            return;
          }
          const currentContainer = containerRef.current?.parentElement;
          if (currentContainer) {
            scrollToBottom(currentContainer);
          }
        }, delay),
      );
    },
    [clearForcedCurrentScrollTimers, scrollToBottom],
  );

  // Preprocess messages into render items and group into turns
  const renderItems = useMemo(() => {
    const startedAt = highResolutionNowMs();
    markReloadPerfPhase("message_list_preprocess_start", {
      messages: messages.length,
      markdownAugments: Object.keys(markdownAugments ?? {}).length,
      hasActiveToolApproval: !!activeToolApproval,
    });
    const nextRenderItems = buildSessionDetailRenderItems({
      messages,
      markdownAugments,
      activeToolApproval,
      transcriptDisplayObjects,
      previousRenderItems: previousRenderItemsRef.current,
    });
    markReloadPerfPhase("message_list_preprocess_end", {
      messages: messages.length,
      renderItems: nextRenderItems.length,
      durationMs: highResolutionNowMs() - startedAt,
    });
    return nextRenderItems;
  }, [
    messages,
    markdownAugments,
    activeToolApproval,
    transcriptDisplayObjects,
  ]);
  useEffect(() => {
    previousRenderItemsRef.current = renderItems;
  }, [renderItems]);
  const thinkingItemCount = useMemo(
    () => countThinkingItems(renderItems),
    [renderItems],
  );
  const hasThinkingItems = thinkingItemCount > 0;
  const isThinkingItemAutoExpanded = useCallback(
    (itemId: string) => autoExpandedThinkingItemIds.has(itemId),
    [autoExpandedThinkingItemIds],
  );
  // Most-recent thinking item; only meaningful in latest-only mode, where its
  // auto-openness is recomputed each render rather than stored, so the prior
  // block collapses with no mutation as soon as a newer one arrives.
  const lastThinkingItemId = useMemo(
    () => getLatestThinkingItemId(renderItems),
    [renderItems],
  );
  // Single source of truth for "is this thinking block expanded": an explicit
  // user toggle (tri-state: open / collapsed / absent) always wins; otherwise
  // the active auto policy decides. A manual expand is a permanent pin — the
  // override is never cleared — so it never auto-hides. See
  // topics/thinking-expand-latest-only.md.
  const resolveThinkingItemExpanded = useCallback(
    (itemId: string) => {
      const override = thinkingExpansionOverrides[itemId];
      if (override !== undefined) return override;
      return thinkingLatestOnly
        ? itemId === lastThinkingItemId
        : isThinkingItemAutoExpanded(itemId);
    },
    [
      isThinkingItemAutoExpanded,
      lastThinkingItemId,
      thinkingExpansionOverrides,
      thinkingLatestOnly,
    ],
  );
  const displayRenderItems = useMemo(
    () => getDisplayRenderItems(renderItems, { thinkingItemsVisible }),
    [renderItems, thinkingItemsVisible],
  );
  useLayoutEffect(() => {
    const previousThinkingTextLengths = previousThinkingTextLengthsRef.current;
    const nextThinkingTextLengths = getThinkingTextLengths(renderItems);
    const visibleThinkingDelta = hasVisibleThinkingTextDelta({
      isThinkingItemExpanded: resolveThinkingItemExpanded,
      nextTextLengths: nextThinkingTextLengths,
      previousTextLengths: previousThinkingTextLengths,
      thinkingItemsVisible,
    });

    previousThinkingTextLengthsRef.current = nextThinkingTextLengths;

    if (visibleThinkingDelta && !thinkingDeltaFollowAllowedRef.current) {
      stopFollowingForUserScroll(containerRef.current?.parentElement);
    }
  }, [
    renderItems,
    resolveThinkingItemExpanded,
    stopFollowingForUserScroll,
    thinkingItemsVisible,
  ]);
  useLayoutEffect(() => {
    const previouslyObservedThinkingIds = observedThinkingItemIdsRef.current;
    const existingThinkingIds = getThinkingItemIds(renderItems);
    observedThinkingItemIdsRef.current = existingThinkingIds;
    const seedHistoricalThinking =
      existingThinkingIds.size > 0 &&
      providerExpandsHistoricalThinking(provider) &&
      autoExpandedHistoricalThinkingProviderRef.current !== provider;
    if (seedHistoricalThinking) {
      autoExpandedHistoricalThinkingProviderRef.current = provider ?? null;
    }

    setAutoExpandedThinkingItemIds((previous) => {
      return reconcileAutoExpandedThinkingItemIds({
        currentThinkingIds: existingThinkingIds,
        previouslyObservedThinkingIds,
        previousExpandedIds: previous,
        seedHistoricalThinking,
      });
    });
  }, [provider, renderItems]);
  const turnGroups = useMemo(() => {
    const startedAt = highResolutionNowMs();
    const grouped = groupRenderItemsIntoTurns(displayRenderItems);
    markReloadPerfPhase("message_list_group_end", {
      renderItems: displayRenderItems.length,
      turnGroups: grouped.length,
      durationMs: highResolutionNowMs() - startedAt,
    });
    return grouped;
  }, [displayRenderItems]);
  useEffect(() => {
    markReloadPerfPhase("message_list_commit_effect", {
      messages: messages.length,
      renderItems: displayRenderItems.length,
      turnGroups: turnGroups.length,
    });
  }, [messages.length, displayRenderItems.length, turnGroups.length]);
  const hasUserSearchableTurn = useMemo(
    () => displayRenderItems.some((item) => getSearchableUserTurnPreview(item)),
    [displayRenderItems],
  );
  const getUserTurnNavAnchorList = useCallback(
    (): UserTurnNavAnchor[] => getUserTurnNavAnchors(displayRenderItems),
    [displayRenderItems],
  );
  const searchReady =
    userTurnSearch.active &&
    normalizeSearchText(userTurnSearch.query).length >= 2;
  const includeUserTurnSearchAnchors =
    searchReady && userTurnSearch.scope === "user";
  const userTurnSearchAnchors = useMemo<UserTurnNavAnchor[]>(() => {
    if (!includeUserTurnSearchAnchors) {
      return [];
    }
    return getUserTurnSearchAnchors(displayRenderItems);
  }, [includeUserTurnSearchAnchors, displayRenderItems]);
  const includeAllTurnSearchAnchors =
    searchReady && userTurnSearch.scope === "all";
  const sessionTurnNavAnchors = useMemo<UserTurnNavAnchor[]>(() => {
    if (!includeAllTurnSearchAnchors) {
      return [];
    }
    return getAllTurnSearchAnchors(displayRenderItems);
  }, [includeAllTurnSearchAnchors, displayRenderItems]);
  const includeFullSessionSearchAnchors =
    searchReady && userTurnSearch.scope === "full";
  const fullSessionSearchAnchors = useMemo<UserTurnNavAnchor[]>(() => {
    if (!includeFullSessionSearchAnchors) {
      return [];
    }
    return getFullSessionSearchAnchors(turnGroups);
  }, [includeFullSessionSearchAnchors, turnGroups]);
  const activeSearchAnchors =
    userTurnSearch.scope === "full"
      ? fullSessionSearchAnchors
      : userTurnSearch.scope === "all"
        ? sessionTurnNavAnchors
        : userTurnSearchAnchors;
  const userTurnSearchProjection = useMemo(
    () =>
      getSearchMatchProjection({
        anchors: activeSearchAnchors,
        caseSensitive: userTurnSearch.caseSensitive,
        query: userTurnSearch.query,
        searchReady,
      }),
    [
      activeSearchAnchors,
      searchReady,
      userTurnSearch.caseSensitive,
      userTurnSearch.query,
    ],
  );
  const userTurnSearchMatches = userTurnSearchProjection.matches;
  const userTurnSearchMatchIds = userTurnSearchProjection.matchIds;
  const userTurnSearchMatchTargetIds = userTurnSearchProjection.matchTargetIds;
  const userTurnSearchPreviewsById = userTurnSearchProjection.previewsById;
  const userTurnSearchSelectionProjection = useMemo(
    () =>
      getSearchSelectionProjection({
        anchors: activeSearchAnchors,
        previewsById: userTurnSearchPreviewsById,
        searchReady,
        selectedId: userTurnSearch.selectedId,
      }),
    [
      activeSearchAnchors,
      searchReady,
      userTurnSearch.selectedId,
      userTurnSearchPreviewsById,
    ],
  );
  const selectedSearchAnchor = userTurnSearchSelectionProjection.selectedAnchor;
  const selectedSearchTargetId =
    userTurnSearchSelectionProjection.selectedTargetId;
  selectedSearchTargetIdRef.current = selectedSearchTargetId;
  const userTurnSearchPreview =
    userTurnSearchSelectionProjection.selectedPreview;
  const getNavigatorAnchors = useCallback(
    () =>
      searchReady
        ? userTurnSearchMatches
        : userTurnSearch.active
          ? []
          : getUserTurnNavAnchorList(),
    [
      getUserTurnNavAnchorList,
      searchReady,
      userTurnSearch.active,
      userTurnSearchMatches,
    ],
  );
  const userTurnNavSearchState = useMemo<UserTurnNavSearchState | null>(
    () =>
      searchReady
        ? {
            activeId: selectedSearchAnchor?.id ?? null,
            caseSensitive: userTurnSearch.caseSensitive,
            matchIds: userTurnSearchMatchIds,
            preview: userTurnSearchPreview,
            previewsById: userTurnSearchPreviewsById,
            query: userTurnSearch.query,
          }
        : null,
    [
      searchReady,
      selectedSearchAnchor?.id,
      userTurnSearch.caseSensitive,
      userTurnSearch.query,
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
  const updateScrollPositionTimestamp = useCallback(
    (options: { atBottom?: boolean } = {}) => {
      const content = containerRef.current;
      const container = content?.parentElement;
      if (!content || !container || options.atBottom) {
        setScrollPositionTimestampMs(null);
        return;
      }
      setScrollPositionTimestampMs(
        getTranscriptPositionTimestampMs(
          content,
          container,
          turnGroups,
          displayRenderItems,
        ),
      );
    },
    [displayRenderItems, turnGroups],
  );

  const captureScrollSnapshot = useCallback(
    (container: HTMLElement, content: HTMLDivElement) => {
      const atBottom = isAtScrollBottom(container, content);
      const anchor = atBottom
        ? undefined
        : (getFirstVisibleRenderAnchor(content, container) ?? undefined);
      return {
        atBottom,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        ...(anchor ? { anchor } : {}),
        updatedAtMs: Date.now(),
      };
    },
    [],
  );

  const publishScrollSnapshot = useCallback(() => {
    if (!onScrollSnapshotChange) return;
    const content = containerRef.current;
    const container = content?.parentElement;
    if (!content || !container) return;
    onScrollSnapshotChange(captureScrollSnapshot(container, content));
  }, [captureScrollSnapshot, onScrollSnapshotChange]);

  useEffect(() => {
    updateScrollPositionTimestamp({ atBottom: isScrolledToBottom });
  }, [isScrolledToBottom, updateScrollPositionTimestamp]);

  useEffect(() => {
    const contextualTimestampMs =
      hoveredMarkerTimestampMs ??
      (isScrolledToBottom ? null : scrollPositionTimestampMs);
    onTranscriptPositionTimestampChange?.(contextualTimestampMs);
  }, [
    hoveredMarkerTimestampMs,
    isScrolledToBottom,
    onTranscriptPositionTimestampChange,
    scrollPositionTimestampMs,
  ]);

  useEffect(
    () => () => {
      onTranscriptPositionTimestampChange?.(null);
    },
    [onTranscriptPositionTimestampChange],
  );
  useEffect(() => {
    if (interactionDisabled) {
      return;
    }
    const handleCopy = (event: ClipboardEvent) => {
      const root = containerRef.current;
      if (!root) {
        return;
      }

      copyMarkdownSelectionToClipboard(event, root);
    };

    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [interactionDisabled]);

  useEffect(() => {
    if (interactionDisabled || !onQuoteSelection) {
      setFloatingQuoteButton(null);
      return;
    }

    const updateFloatingQuoteButton = (pointerEnd?: {
      clientX: number;
      clientY: number;
      placeBelow?: boolean;
    }) => {
      const root = containerRef.current;
      const selection = root?.ownerDocument.getSelection();
      if (
        !root ||
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        extractMarkdownSnippetsFromSelection(root).length === 0
      ) {
        setFloatingQuoteButton(null);
        return;
      }

      const range = selection.getRangeAt(selection.rangeCount - 1);
      const rect = pointerEnd ? null : range.getBoundingClientRect();
      if (!pointerEnd && rect && rect.width === 0 && rect.height === 0) {
        setFloatingQuoteButton(null);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const clientX = pointerEnd?.clientX ?? rect?.right ?? rootRect.left;
      const clientY = pointerEnd?.clientY ?? rect?.top ?? rootRect.top;
      const maxTop = Math.max(
        0,
        root.scrollHeight - SELECTION_QUOTE_BUTTON_SIZE_PX,
      );
      const maxLeft = Math.max(
        0,
        root.clientWidth - SELECTION_QUOTE_BUTTON_SIZE_PX,
      );
      setFloatingQuoteButton({
        top: clampNumber(
          pointerEnd?.placeBelow
            ? clientY - rootRect.top + SELECTION_QUOTE_BUTTON_GAP_PX
            : clientY -
                rootRect.top -
                SELECTION_QUOTE_BUTTON_SIZE_PX -
                SELECTION_QUOTE_BUTTON_GAP_PX,
          0,
          maxTop,
        ),
        left: clampNumber(
          clientX - rootRect.left + SELECTION_QUOTE_BUTTON_GAP_PX,
          0,
          maxLeft,
        ),
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const root = containerRef.current;
      if (!root?.contains(event.target as Node | null)) {
        selectionPointerStartRef.current = null;
        return;
      }
      selectionPointerStartRef.current = { clientY: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      const start = selectionPointerStartRef.current;
      selectionPointerStartRef.current = null;
      window.setTimeout(() => {
        updateFloatingQuoteButton({
          clientX: event.clientX,
          clientY: event.clientY,
          placeBelow: start ? event.clientY > start.clientY : false,
        });
      }, 0);
    };
    const updateFromSelectionRange = () => updateFloatingQuoteButton();

    document.addEventListener("selectionchange", updateFromSelectionRange);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("resize", updateFromSelectionRange);
    window.addEventListener("scroll", updateFromSelectionRange, true);
    return () => {
      document.removeEventListener("selectionchange", updateFromSelectionRange);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("resize", updateFromSelectionRange);
      window.removeEventListener("scroll", updateFromSelectionRange, true);
    };
  }, [interactionDisabled, onQuoteSelection]);

  useEffect(() => {
    if (interactionDisabled || !onQuoteSelection) {
      return;
    }
    const handleSelectionTyping = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1 ||
        isInteractiveScrollTarget(event.target)
      ) {
        return;
      }
      if (!applyQuoteFromSelection(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleSelectionTyping, true);
    return () =>
      window.removeEventListener("keydown", handleSelectionTyping, true);
  }, [applyQuoteFromSelection, interactionDisabled, onQuoteSelection]);
  const latestVisibleTimestampMs = useMemo(
    () =>
      getLatestVisibleTimestampMs({
        asides: btwAsides,
        deferredMessages,
        displayRenderItems,
        pendingMessages,
        projectQueueMessages,
      }),
    [
      displayRenderItems,
      pendingMessages,
      deferredMessages,
      projectQueueMessages,
      btwAsides,
    ],
  );
  const composerTailRows = useMemo(
    () =>
      buildComposerTailDisplayRows({
        deferredMessages,
        latestVisibleTimestampMs,
        nowMs,
        pendingMessages,
        projectQueueMessages,
        staleThresholdMs: MESSAGE_STALE_THRESHOLD_MS,
      }),
    [
      pendingMessages,
      deferredMessages,
      projectQueueMessages,
      latestVisibleTimestampMs,
      nowMs,
    ],
  );
  const latestCorrectablePrompt = useMemo(() => {
    if (!onCorrectLatestUserMessage) return null;
    return selectLatestCorrectablePrompt(renderItems);
  }, [renderItems, onCorrectLatestUserMessage]);
  const visibleTurnGroups = useMemo(() => {
    return getSearchVisibleTurnGroups({
      matchIds: userTurnSearchMatchIds,
      matchTargetIds: userTurnSearchMatchTargetIds,
      scope: userTurnSearch.scope,
      searchReady,
      turnGroups,
    });
  }, [
    searchReady,
    turnGroups,
    userTurnSearch.scope,
    userTurnSearchMatchIds,
    userTurnSearchMatchTargetIds,
  ]);
  const visibleTimelineEntries = useMemo(() => {
    return buildVisibleTimelineEntries({
      asides: btwAsides,
      turnGroups: visibleTurnGroups,
    });
  }, [btwAsides, visibleTurnGroups]);
  const progressiveRenderAllowed =
    progressiveRenderEnabled &&
    !userTurnSearch.active &&
    visibleTimelineEntries.length > 0;
  const progressiveRenderCycleKey = progressiveRenderKey ?? "default";
  const progressiveInitialEntryCount = useMemo(
    () =>
      progressiveRenderAllowed
        ? getTailEntryCountForRenderItemTarget(
            visibleTimelineEntries,
            PROGRESSIVE_INITIAL_RENDER_ITEM_TARGET,
          )
        : visibleTimelineEntries.length,
    [progressiveRenderAllowed, visibleTimelineEntries],
  );
  const [progressiveEntryCount, setProgressiveEntryCount] = useState<
    number | null
  >(null);
  const [progressiveRenderStateKey, setProgressiveRenderStateKey] = useState<
    string | null
  >(null);
  const [progressiveRenderRevealed, setProgressiveRenderRevealed] =
    useState(false);
  const progressiveEntryCountForCycle =
    progressiveRenderStateKey === progressiveRenderCycleKey
      ? progressiveEntryCount
      : null;
  const progressiveRenderRevealedForCycle =
    progressiveRenderStateKey === progressiveRenderCycleKey
      ? progressiveRenderRevealed
      : false;
  const progressiveRenderAlreadyCompleted =
    progressiveRenderAllowed &&
    progressiveCompletedRenderKeyRef.current === progressiveRenderCycleKey;
  const progressiveRevealActive =
    progressiveRenderAllowed &&
    !progressiveRenderAlreadyCompleted &&
    !progressiveRenderRevealedForCycle;
  const {
    effectiveEntryCount: effectiveProgressiveEntryCount,
    entries: progressiveTimelineEntries,
    percent: progressiveRenderPercent,
  } = useMemo(() => {
    return getProgressiveTimelineVisibility({
      entries: visibleTimelineEntries,
      entryCount: progressiveEntryCountForCycle,
      initialEntryCount: progressiveInitialEntryCount,
      revealActive: progressiveRevealActive,
    });
  }, [
    progressiveEntryCountForCycle,
    progressiveInitialEntryCount,
    progressiveRevealActive,
    visibleTimelineEntries,
  ]);
  const timelineEntryRows = useMemo(
    () =>
      buildTimelineEntryDisplayRows({
        entries: progressiveTimelineEntries,
        latestCorrectablePromptId: latestCorrectablePrompt?.id ?? null,
        latestVisibleTimestampMs,
        nowMs,
      }),
    [
      progressiveTimelineEntries,
      latestCorrectablePrompt?.id,
      latestVisibleTimestampMs,
      nowMs,
    ],
  );
  useEffect(() => {
    if (!progressiveRenderAllowed) {
      progressiveActiveRenderKeyRef.current = null;
      setProgressiveRenderStateKey(null);
      setProgressiveEntryCount(null);
      setProgressiveRenderRevealed(true);
      return;
    }

    if (
      progressiveCompletedRenderKeyRef.current === progressiveRenderCycleKey
    ) {
      progressiveActiveRenderKeyRef.current = null;
      setProgressiveRenderStateKey(progressiveRenderCycleKey);
      setProgressiveEntryCount(visibleTimelineEntries.length);
      setProgressiveRenderRevealed(true);
      return;
    }

    if (progressiveActiveRenderKeyRef.current === progressiveRenderCycleKey) {
      return;
    }

    progressiveActiveRenderKeyRef.current = progressiveRenderCycleKey;
    setProgressiveRenderStateKey(progressiveRenderCycleKey);
    setProgressiveEntryCount(progressiveInitialEntryCount);
    setProgressiveRenderRevealed(false);
  }, [
    progressiveInitialEntryCount,
    progressiveRenderAllowed,
    progressiveRenderCycleKey,
    visibleTimelineEntries.length,
  ]);
  useEffect(() => {
    if (
      !progressiveRevealActive ||
      effectiveProgressiveEntryCount >= visibleTimelineEntries.length
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setProgressiveEntryCount((current) =>
        getNextProgressiveEntryCount(
          visibleTimelineEntries,
          current ?? progressiveInitialEntryCount,
          PROGRESSIVE_RENDER_ITEM_BATCH_TARGET,
        ),
      );
    }, PROGRESSIVE_RENDER_BATCH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    effectiveProgressiveEntryCount,
    progressiveInitialEntryCount,
    progressiveRevealActive,
    visibleTimelineEntries,
  ]);
  useEffect(() => {
    if (
      !progressiveRevealActive ||
      effectiveProgressiveEntryCount < visibleTimelineEntries.length
    ) {
      return;
    }

    const timer = setTimeout(() => {
      progressiveCompletedRenderKeyRef.current = progressiveRenderCycleKey;
      progressiveActiveRenderKeyRef.current = null;
      setProgressiveRenderStateKey(progressiveRenderCycleKey);
      setProgressiveEntryCount(visibleTimelineEntries.length);
      setProgressiveRenderRevealed(true);
    }, PROGRESSIVE_RENDER_REVEAL_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    effectiveProgressiveEntryCount,
    progressiveRevealActive,
    progressiveRenderCycleKey,
    visibleTimelineEntries.length,
  ]);
  useLayoutEffect(() => {
    const wasProgressiveRevealActive =
      previousProgressiveRevealActiveRef.current;
    previousProgressiveRevealActiveRef.current = progressiveRevealActive;

    if (
      !wasProgressiveRevealActive ||
      progressiveRevealActive ||
      !shouldAutoScrollRef.current
    ) {
      return;
    }

    const container = containerRef.current?.parentElement;
    if (container) {
      scrollToBottom(container);
    }
  }, [progressiveRevealActive, scrollToBottom]);

  const getThinkingItemExpanded = useCallback(
    (item: RenderItem) =>
      item.type === "thinking" && resolveThinkingItemExpanded(item.id),
    [resolveThinkingItemExpanded],
  );

  const toggleThinkingItemExpanded = useCallback(
    (item: RenderItem) => {
      if (item.type !== "thinking") {
        return;
      }
      // Absolute write against the currently-resolved state, never cleared:
      // toggling open from the auto state pins it open permanently.
      const next = !resolveThinkingItemExpanded(item.id);
      setThinkingExpansionOverrides((previous) => ({
        ...previous,
        [item.id]: next,
      }));
    },
    [resolveThinkingItemExpanded],
  );

  const noopToggleThinkingExpanded = useCallback(() => {}, []);

  const preserveScrollAfterTranscriptHeightChange = useCallback(
    (mutate: () => void) => {
      const messageList = containerRef.current;
      const scrollContainer = messageList?.parentElement;
      if (!messageList || !scrollContainer) {
        mutate();
        return;
      }

      const wasAtBottom = isNearScrollBottom(scrollContainer);
      const scrollTopBefore = scrollContainer.scrollTop;
      const scrollHeightBefore = scrollContainer.scrollHeight;
      const anchorBefore = wasAtBottom
        ? null
        : getFirstVisibleRenderAnchor(messageList, scrollContainer);

      mutate();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const nextMessageList = containerRef.current;
          const nextScrollContainer =
            nextMessageList?.parentElement ?? scrollContainer;
          isProgrammaticScrollRef.current = true;

          if (wasAtBottom) {
            scrollToBottom(nextScrollContainer);
            return;
          }

          let restoredFromAnchor = false;
          if (anchorBefore && nextMessageList) {
            const row = findRenderRow(nextMessageList, anchorBefore.id);
            if (row) {
              const containerRect = nextScrollContainer.getBoundingClientRect();
              const rowRect = row.getBoundingClientRect();
              nextScrollContainer.scrollTop = Math.max(
                0,
                nextScrollContainer.scrollTop +
                  rowRect.top -
                  containerRect.top -
                  anchorBefore.topOffset,
              );
              restoredFromAnchor = true;
            }
          }

          if (!restoredFromAnchor) {
            const heightDelta =
              nextScrollContainer.scrollHeight - scrollHeightBefore;
            nextScrollContainer.scrollTop = Math.max(
              0,
              scrollTopBefore + heightDelta,
            );
          }
          lastHeightRef.current = nextScrollContainer.scrollHeight;
          requestAnimationFrame(() => {
            isProgrammaticScrollRef.current = false;
          });
        });
      });
    },
    [scrollToBottom],
  );

  const toggleThinkingItemsVisible = useCallback(() => {
    preserveScrollAfterTranscriptHeightChange(() => {
      setThinkingItemsVisible((previous) => {
        const next = !previous;
        saveSessionThinkingVisible(next);
        return next;
      });
    });
  }, [preserveScrollAfterTranscriptHeightChange]);

  const toggleThinkingLatestOnly = useCallback(() => {
    preserveScrollAfterTranscriptHeightChange(() => {
      setThinkingLatestOnly((previous) => {
        const next = !previous;
        saveSessionThinkingLatestOnly(next);
        return next;
      });
    });
  }, [preserveScrollAfterTranscriptHeightChange]);

  const showNavMotionCue = useCallback((direction: "up" | "down") => {
    if (navMotionCueClearTimerRef.current !== null) {
      clearTimeout(navMotionCueClearTimerRef.current);
    }
    navMotionCueTokenRef.current += 1;
    setNavMotionCue({
      direction,
      token: navMotionCueTokenRef.current,
    });
    navMotionCueClearTimerRef.current = setTimeout(() => {
      setNavMotionCue(null);
      navMotionCueClearTimerRef.current = null;
    }, NAV_MOTION_CUE_CLEAR_MS);
  }, []);

  const moveUserTurnSearchSelection = useCallback(
    (direction: "previous" | "next") => {
      setUserTurnSearch((previous) => {
        if (!previous.active || userTurnSearchMatches.length === 0) {
          return previous;
        }
        const currentIndex = previous.selectedId
          ? userTurnSearchMatches.findIndex(
              (anchor) => anchor.id === previous.selectedId,
            )
          : -1;
        const step = direction === "previous" ? -1 : 1;
        const fallbackIndex =
          direction === "previous" ? userTurnSearchMatches.length - 1 : 0;
        const nextIndex =
          currentIndex >= 0
            ? (currentIndex + step + userTurnSearchMatches.length) %
              userTurnSearchMatches.length
            : fallbackIndex;
        const nextSelectedId = userTurnSearchMatches[nextIndex]?.id ?? null;
        return { ...previous, selectedId: nextSelectedId };
      });
    },
    [userTurnSearchMatches],
  );
  const stopUserTurnSearchArrowRepeat = useCallback(() => {
    if (searchArrowRepeatTimeoutRef.current !== null) {
      clearTimeout(searchArrowRepeatTimeoutRef.current);
      searchArrowRepeatTimeoutRef.current = null;
    }
    if (searchArrowRepeatIntervalRef.current !== null) {
      clearInterval(searchArrowRepeatIntervalRef.current);
      searchArrowRepeatIntervalRef.current = null;
    }
    searchArrowRepeatDirectionRef.current = null;
  }, []);
  const startUserTurnSearchArrowRepeat = useCallback(
    (direction: "previous" | "next") => {
      if (
        searchArrowRepeatDirectionRef.current === direction &&
        (searchArrowRepeatTimeoutRef.current !== null ||
          searchArrowRepeatIntervalRef.current !== null)
      ) {
        return;
      }
      stopUserTurnSearchArrowRepeat();
      searchArrowRepeatDirectionRef.current = direction;
      searchArrowRepeatTimeoutRef.current = setTimeout(() => {
        searchArrowRepeatTimeoutRef.current = null;
        moveUserTurnSearchSelection(direction);
        searchArrowRepeatIntervalRef.current = setInterval(() => {
          moveUserTurnSearchSelection(direction);
        }, SEARCH_ARROW_REPEAT_INTERVAL_MS);
      }, SEARCH_ARROW_REPEAT_DELAY_MS);
    },
    [moveUserTurnSearchSelection, stopUserTurnSearchArrowRepeat],
  );
  const selectUserTurnSearchMatch = useCallback((id: string) => {
    setUserTurnSearch((previous) =>
      previous.active ? { ...previous, selectedId: id } : previous,
    );
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const scrollToRenderId = useCallback(
    (
      id: string,
      behavior: ScrollBehavior,
      align: "start" | "center" = "start",
      showMotionCue = false,
    ) => {
      const messageList = containerRef.current;
      const scrollContainer = messageList?.parentElement;
      const row = findRenderRow(messageList, id);
      if (!scrollContainer || !row) return;
      shouldAutoScrollRef.current = false;
      setIsScrolledToBottom(false);
      const scrollRect = scrollContainer.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const offset =
        align === "center"
          ? Math.max(0, (scrollContainer.clientHeight - rowRect.height) / 2)
          : 12;
      const nextTop = Math.max(
        0,
        scrollContainer.scrollTop + rowRect.top - scrollRect.top - offset,
      );
      if (showMotionCue) {
        showNavMotionCue(nextTop < scrollContainer.scrollTop ? "up" : "down");
      }
      scrollContainer.scrollTo({
        top: nextTop,
        behavior,
      });
    },
    [showNavMotionCue],
  );

  const scrollToCurrent = useCallback(() => {
    forceScrollToCurrent(FOLLOW_CATCH_UP_DELAYS_MS, {
      allowThinkingDeltas: true,
    });
  }, [forceScrollToCurrent]);

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
        caseSensitive: false,
        selectedId: null,
        originalScrollTop: null,
      };
    });
  }, []);

  const openUserTurnSearch = useCallback(
    (scope: SessionIsearchScope) => {
      const canSearch =
        scope === "user"
          ? hasUserSearchableTurn
          : displayRenderItems.length > 0;
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
        caseSensitive: false,
        selectedId: null,
        originalScrollTop: searchOriginalScrollTopRef.current,
      });
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    },
    [hasUserSearchableTurn, displayRenderItems.length],
  );

  const handleUserTurnSearchQueryChange = useCallback((query: string) => {
    setUserTurnSearch((previous) => ({
      ...previous,
      query,
      selectedId: null,
    }));
  }, []);

  const toggleUserTurnSearchCaseSensitive = useCallback(() => {
    setUserTurnSearch((previous) =>
      previous.active
        ? {
            ...previous,
            caseSensitive: !previous.caseSensitive,
            selectedId: null,
          }
        : previous,
    );
  }, []);

  useEffect(() => {
    if (!userTurnSearch.active) {
      stopUserTurnSearchArrowRepeat();
      return;
    }
    setUserTurnSearch((previous) => {
      if (!previous.active) {
        return previous;
      }
      let nextSelectedId: string | null = null;
      if (searchReady && userTurnSearchMatches.length > 0) {
        nextSelectedId =
          previous.selectedId && userTurnSearchMatchIds.has(previous.selectedId)
            ? previous.selectedId
            : (userTurnSearchMatches[userTurnSearchMatches.length - 1]?.id ??
              null);
      }
      if (previous.selectedId === nextSelectedId) {
        return previous;
      }
      return { ...previous, selectedId: nextSelectedId };
    });
  }, [
    searchReady,
    stopUserTurnSearchArrowRepeat,
    userTurnSearch.active,
    userTurnSearchMatches,
    userTurnSearchMatchIds,
  ]);

  useEffect(() => {
    if (interactionDisabled) {
      stopUserTurnSearchArrowRepeat();
      return;
    }
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
      if (isCtrlKeyShortcut(event, "o", "KeyO")) {
        event.preventDefault();
        event.stopPropagation();
        toggleThinkingItemsVisible();
        return;
      }
      const requestedScope = getSessionIsearchShortcutScope(event);
      if (requestedScope) {
        event.preventDefault();
        event.stopPropagation();
        if (userTurnSearch.active && userTurnSearch.scope === requestedScope) {
          moveUserTurnSearchSelection("previous");
        } else {
          openUserTurnSearch(requestedScope);
        }
        return;
      }
      if (!userTurnSearch.active) {
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowUp" ? "previous" : "next";
        if (
          !event.repeat ||
          searchArrowRepeatDirectionRef.current !== direction
        ) {
          moveUserTurnSearchSelection(direction);
          startUserTurnSearchArrowRepeat(direction);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stopUserTurnSearchArrowRepeat();
        closeUserTurnSearch(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const selectedId = selectedSearchTargetIdRef.current;
        stopUserTurnSearchArrowRepeat();
        closeUserTurnSearch(false);
        if (selectedId) {
          requestAnimationFrame(() =>
            scrollToRenderId(selectedId, "auto", "center", true),
          );
        }
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        stopUserTurnSearchArrowRepeat();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      stopUserTurnSearchArrowRepeat();
    };
  }, [
    closeUserTurnSearch,
    moveUserTurnSearchSelection,
    openUserTurnSearch,
    scrollToCurrent,
    scrollToRenderId,
    startUserTurnSearchArrowRepeat,
    stopUserTurnSearchArrowRepeat,
    toggleThinkingItemsVisible,
    interactionDisabled,
    userTurnSearch.active,
    userTurnSearch.scope,
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

    const content = containerRef.current;
    const container = content?.parentElement;
    if (!content || !container) return;

    const atBottom = isAtScrollBottom(container, content);
    shouldAutoScrollRef.current = atBottom;
    thinkingDeltaFollowAllowedRef.current = atBottom;
    if (!atBottom) {
      clearForcedCurrentScrollTimers();
    }
    setIsScrolledToBottom(atBottom);
    updateScrollPositionTimestamp({ atBottom });
    onScrollSnapshotChange?.(captureScrollSnapshot(container, content));
  }, [
    captureScrollSnapshot,
    clearForcedCurrentScrollTimers,
    onScrollSnapshotChange,
    updateScrollPositionTimestamp,
  ]);

  // Attach scroll listener to parent container
  useEffect(() => {
    if (interactionDisabled) {
      return;
    }
    const container = containerRef.current?.parentElement;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);

    return () => {
      publishScrollSnapshot();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll, publishScrollSnapshot]);

  // Cancel follow before browser scroll events when the user clearly tries to
  // move away from the live tail. Programmatic scroll bursts can otherwise keep
  // the scroll handler muted long enough to rubber-band the viewport back down.
  useEffect(() => {
    if (interactionDisabled) {
      return;
    }
    const container = containerRef.current?.parentElement;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !isInteractiveScrollTarget(event.target)) {
        stopFollowingForUserScroll(container);
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (
        startY !== null &&
        currentY !== undefined &&
        currentY - startY > TOUCH_SCROLL_CANCEL_THRESHOLD_PX &&
        !isInteractiveScrollTarget(event.target)
      ) {
        stopFollowingForUserScroll(container);
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveScrollTarget(event.target)) {
        return;
      }
      const scrollbarWidth = container.offsetWidth - container.clientWidth;
      if (scrollbarWidth <= 0) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (event.clientX >= rect.right - scrollbarWidth) {
        stopFollowingForUserScroll(container);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isInteractiveScrollTarget(event.target)
      ) {
        return;
      }
      const target = event.target;
      const scrollTargetActive =
        target === document.body ||
        target === document ||
        eventTargetIsInside(target, container);
      if (!scrollTargetActive) {
        return;
      }
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey)
      ) {
        stopFollowingForUserScroll(container);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: true,
    });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, {
      passive: true,
    });
    container.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
      container.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [interactionDisabled, stopFollowingForUserScroll]);

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
        // A size change must never *start* following — only continue it (the
        // branch above). Re-arming here from proximity is what trapped the
        // reading area near the bottom. Just track the new height.
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
      clearFollowUpScrollTimer();
      if (programmaticScrollReleaseRef.current !== null) {
        clearTimeout(programmaticScrollReleaseRef.current);
      }
      clearForcedCurrentScrollTimers();
      if (navMotionCueClearTimerRef.current !== null) {
        clearTimeout(navMotionCueClearTimerRef.current);
      }
    };
  }, [
    clearFollowUpScrollTimer,
    clearForcedCurrentScrollTimers,
    scrollToBottom,
  ]);

  // Preserve relative scroll position when the viewport is resized.
  useEffect(() => {
    let pendingFrame = 0;
    let anchorFromBottom = 0;
    let preserveAutoScroll = true;

    const handleResize = () => {
      const container = containerRef.current?.parentElement;
      if (!container || isProgrammaticScrollRef.current) return;

      preserveAutoScroll = shouldAutoScrollRef.current;
      anchorFromBottom = preserveAutoScroll
        ? 0
        : Math.max(
            0,
            container.scrollHeight -
              container.scrollTop -
              container.clientHeight,
          );

      if (pendingFrame !== 0) {
        cancelAnimationFrame(pendingFrame);
      }

      pendingFrame = requestAnimationFrame(() => {
        const resizeContainer = containerRef.current?.parentElement;
        if (!resizeContainer) return;

        if (preserveAutoScroll) {
          scrollToBottom(resizeContainer);
          return;
        }

        const targetScrollTop = Math.max(
          0,
          resizeContainer.scrollHeight -
            resizeContainer.clientHeight -
            anchorFromBottom,
        );

        isProgrammaticScrollRef.current = true;
        resizeContainer.scrollTop = targetScrollTop;
        lastHeightRef.current = resizeContainer.scrollHeight;
        const nearBottom = isNearScrollBottom(resizeContainer);
        shouldAutoScrollRef.current = nearBottom;
        setIsScrolledToBottom(nearBottom);

        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false;
        });
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (pendingFrame !== 0) {
        cancelAnimationFrame(pendingFrame);
      }
    };
  }, [scrollToBottom]);

  // Force scroll to bottom when scrollTrigger changes (user sent a message)
  useEffect(() => {
    if (scrollTrigger > 0) {
      forceScrollToCurrent(SEND_CATCH_UP_DELAYS_MS);
    }
  }, [forceScrollToCurrent, scrollTrigger]);

  useLayoutEffect(() => {
    const wasInteractionDisabled = previousInteractionDisabledRef.current;
    previousInteractionDisabledRef.current = interactionDisabled;
    if (
      wasInteractionDisabled &&
      !interactionDisabled &&
      shouldAutoScrollRef.current
    ) {
      forceScrollToCurrent(SEND_CATCH_UP_DELAYS_MS);
    }
  }, [forceScrollToCurrent, interactionDisabled]);

  // Restore same-tab route scroll before the default first-load follow behavior
  // moves the viewport to the tail.
  useEffect(() => {
    if (
      !isInitialLoadRef.current ||
      !initialScrollSnapshot ||
      !shouldRestoreInitialScrollSnapshot(initialScrollSnapshot) ||
      displayRenderItems.length === 0
    ) {
      return;
    }
    const content = containerRef.current;
    const container = content?.parentElement;
    if (!content || !container) return;

    isProgrammaticScrollRef.current = true;
    if (initialScrollSnapshot.atBottom) {
      scrollToBottom(container);
      shouldAutoScrollRef.current = true;
      setIsScrolledToBottom(true);
    } else {
      let restored = false;
      const anchor = initialScrollSnapshot.anchor;
      if (anchor) {
        const row = findRenderRow(content, anchor.id);
        if (row) {
          const containerRect = container.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          container.scrollTop = Math.max(
            0,
            container.scrollTop +
              rowRect.top -
              containerRect.top -
              anchor.topOffset,
          );
          restored = true;
        }
      }
      if (!restored) {
        const maxScrollTop = Math.max(
          0,
          container.scrollHeight - container.clientHeight,
        );
        container.scrollTop = Math.min(
          initialScrollSnapshot.scrollTop,
          maxScrollTop,
        );
      }
      shouldAutoScrollRef.current = false;
      setIsScrolledToBottom(false);
      updateScrollPositionTimestamp({ atBottom: false });
    }
    lastHeightRef.current = container.scrollHeight;
    isInitialLoadRef.current = false;
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      publishScrollSnapshot();
    });
  }, [
    displayRenderItems.length,
    initialScrollSnapshot,
    publishScrollSnapshot,
    scrollToBottom,
    updateScrollPositionTimestamp,
  ]);

  // Initial scroll to bottom on first render
  useEffect(() => {
    if (isInitialLoadRef.current && displayRenderItems.length > 0) {
      const container = containerRef.current?.parentElement;
      if (container) {
        scrollToBottom(container);
      }
      isInitialLoadRef.current = false;
    }
  }, [displayRenderItems.length, scrollToBottom]);

  const searchPanelTarget =
    userTurnSearch.active && typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(".session-input-inner")
      : null;
  const followButtonTarget =
    !isScrolledToBottom && typeof document !== "undefined"
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
      <div className="user-turn-search-main">
        <span className="user-turn-search-label">
          {getSearchScopeLabel(userTurnSearch.scope)}
        </span>
        <input
          ref={searchInputRef}
          className="user-turn-search-input"
          value={userTurnSearch.query}
          onChange={(event) =>
            handleUserTurnSearchQueryChange(event.target.value)
          }
          placeholder="reverse search"
          aria-label={getSearchScopeAriaLabel(userTurnSearch.scope)}
        />
        <button
          type="button"
          className={[
            "user-turn-search-case-toggle",
            userTurnSearch.caseSensitive ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Case-sensitive search"
          aria-pressed={userTurnSearch.caseSensitive}
          title={
            userTurnSearch.caseSensitive
              ? "Case-sensitive search on"
              : "Case-sensitive search off"
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleUserTurnSearchCaseSensitive}
        >
          Aa
        </button>
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
      </div>
      <div className="user-turn-search-help">
        <span>
          {getSearchScopeKeys(userTurnSearch.scope)} prev · ↑↓ matches · click
          selects
        </span>
        <span>Enter jump+close · Esc cancel · Aa case</span>
      </div>
    </div>
  ) : null;
  const followButton = !isScrolledToBottom ? (
    <button
      type="button"
      className="message-follow-toggle"
      onClick={scrollToCurrent}
      aria-label="Follow latest session output"
      title="Follow latest session output"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
      <span>Follow</span>
    </button>
  ) : null;
  return (
    <>
      <UserTurnNavigator
        getAnchors={getNavigatorAnchors}
        messageListRef={containerRef}
        motionCue={navMotionCue}
        onNavigateStart={() => {
          shouldAutoScrollRef.current = false;
          setIsScrolledToBottom(false);
          updateScrollPositionTimestamp({ atBottom: false });
        }}
        onSearchMatchSelect={selectUserTurnSearchMatch}
        onTrimAnchor={onTrimBeforeUserMessage}
        onForkBeforeAnchor={onForkBeforeUserMessage}
        onForkAfterAnchor={onForkAfterUserMessage}
        onCopyAnchor={onCopyUserMessage}
        onPreviewTimestampChange={setHoveredMarkerTimestampMs}
        searchState={userTurnNavSearchState}
      />
      {searchPanelTarget && searchPanel
        ? createPortal(searchPanel, searchPanelTarget)
        : searchPanel}
      {followButtonTarget && followButton
        ? createPortal(followButton, followButtonTarget)
        : followButton}
      <div
        className={`message-list${
          progressiveRevealActive ? " message-list-progressive-hydrating" : ""
        }`}
        ref={containerRef}
        aria-busy={progressiveRevealActive ? true : undefined}
      >
        {floatingQuoteButton && (
          <button
            type="button"
            className="selection-quote-button"
            style={{
              top: `${floatingQuoteButton.top}px`,
              left: `${floatingQuoteButton.left}px`,
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyQuoteFromSelection()}
            aria-label={t("sessionQuoteSelection")}
            title={t("sessionQuoteSelection")}
          >
            &gt;
          </button>
        )}
        {progressiveRevealActive && (
          <div className="session-render-progress loading" role="status">
            <div>{t("sessionLoading")}</div>
            {progressiveRenderStatusVisible && (
              <>
                <div className="loading-detail session-render-progress-label">
                  {t("sessionProgressiveRenderingStatus", {
                    percent: progressiveRenderPercent,
                  })}
                </div>
                <div
                  className="session-render-progress-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressiveRenderPercent}
                  aria-label={t("sessionProgressiveRenderingAriaLabel")}
                >
                  <div
                    className="session-render-progress-fill"
                    style={{ width: `${progressiveRenderPercent}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {(hasOlderMessages || clientTailActive) && (
          <div className="load-older-messages">
            {clientTailActive && (
              <span className="load-older-status">
                Recent transcript loaded
              </span>
            )}
            {hasOlderMessages && (
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
            )}
          </div>
        )}
        {timelineEntryRows.map((timelineRow) => {
          if (timelineRow.kind === "btw") {
            return (
              <BtwAsideTimelineCard
                key={timelineRow.key}
                aside={timelineRow.aside}
                onFocus={onFocusBtwAside}
                onDone={onDoneBtwAside}
                onStop={onStopBtwAside}
                onToggleExpanded={onToggleBtwAsideExpanded}
                onTransferTurn={onTransferBtwAsideTurn}
              />
            );
          }

          if (timelineRow.kind === "empty") {
            return null;
          }

          if (timelineRow.kind === "standalone") {
            const { item } = timelineRow;
            return (
              <RenderItemComponent
                key={timelineRow.key}
                item={item}
                isStreaming={isStreaming}
                thinkingExpanded={false}
                toggleThinkingExpanded={noopToggleThinkingExpanded}
                sessionProvider={provider}
                getForkSummaryTargetHref={getForkSummaryTargetHref}
                onCancelForkSummary={onCancelForkSummary}
                onToggleForkSummaryAutoOpen={onToggleForkSummaryAutoOpen}
                onFollowForkSummary={onFollowForkSummary}
              />
            );
          }

          if (timelineRow.kind === "user") {
            const { item } = timelineRow;
            return (
              <RenderItemComponent
                key={timelineRow.key}
                item={item}
                isStreaming={isStreaming}
                thinkingExpanded={getThinkingItemExpanded(item)}
                toggleThinkingExpanded={noopToggleThinkingExpanded}
                sessionProvider={provider}
                onCorrectUserPrompt={
                  timelineRow.isLatestCorrectable && latestCorrectablePrompt
                    ? () =>
                        onCorrectLatestUserMessage?.(
                          latestCorrectablePrompt.id,
                          latestCorrectablePrompt.content,
                        )
                    : undefined
                }
                onTrimBeforeUserPrompt={
                  onTrimBeforeUserMessage && timelineRow.allowsPromptActions
                    ? () => onTrimBeforeUserMessage(item.id)
                    : undefined
                }
                onForkBeforeUserPrompt={
                  onForkBeforeUserMessage && timelineRow.allowsPromptActions
                    ? () => onForkBeforeUserMessage(item.id)
                    : undefined
                }
                staleNowMs={timelineRow.staleNowMs}
                latestVisibleTimestampMs={latestVisibleTimestampMs}
              />
            );
          }

          return (
            <div key={timelineRow.key} className="assistant-turn">
              {timelineRow.rows.map((assistantRow) => {
                if (assistantRow.kind === "explored") {
                  return (
                    <ExploredToolGroup
                      key={assistantRow.id}
                      id={assistantRow.id}
                      items={assistantRow.items}
                      sessionProvider={provider}
                      staleNowMs={assistantRow.staleNowMs}
                      latestVisibleTimestampMs={latestVisibleTimestampMs}
                    />
                  );
                }

                const { item } = assistantRow;
                return (
                  <RenderItemComponent
                    key={item.id}
                    item={item}
                    isStreaming={isStreaming}
                    thinkingExpanded={getThinkingItemExpanded(item)}
                    toggleThinkingExpanded={
                      assistantRow.allowsThinkingToggle
                        ? () => toggleThinkingItemExpanded(item)
                        : noopToggleThinkingExpanded
                    }
                    sessionProvider={provider}
                    onTrimBeforeUserPrompt={
                      onTrimBeforeUserMessage &&
                      assistantRow.allowsPromptActions
                        ? () => onTrimBeforeUserMessage(item.id)
                        : undefined
                    }
                    onForkBeforeUserPrompt={
                      onForkBeforeUserMessage &&
                      assistantRow.allowsPromptActions
                        ? () => onForkBeforeUserMessage(item.id)
                        : undefined
                    }
                    onQuoteTextBlock={
                      assistantRow.allowsTextQuote
                        ? handleQuoteTextBlock
                        : undefined
                    }
                    alwaysShowQuoteCircle={alwaysShowQuoteCircles}
                    staleNowMs={assistantRow.staleNowMs}
                    latestVisibleTimestampMs={latestVisibleTimestampMs}
                    thinkingDurationMs={assistantRow.thinkingDurationMs}
                  />
                );
              })}
            </div>
          );
        })}
        {composerTailRows.map((tailRow) => {
          const { hasMessageAge, showAgeByDefault, timestampMs } = tailRow;

          if (tailRow.kind === "pending") {
            const pending = tailRow.message;
            return (
              <div
                key={tailRow.key}
                className={`pending-message message-render-row ${
                  hasMessageAge ? "has-message-age" : ""
                } ${showAgeByDefault ? "is-message-age-visible" : ""}`}
              >
                <div className="message-render-content">
                  <div className="message-user-prompt pending-message-bubble">
                    {pending.content}
                  </div>
                  {pending.attachments?.length ? (
                    <div className="attachment-list pending-message-attachments">
                      {pending.attachments.map((file) => (
                        <AttachmentChip
                          key={file.id}
                          attachmentId={file.id}
                          originalName={file.originalName}
                          path={file.path}
                          mimeType={file.mimeType}
                          sizeLabel={formatSize(file.size)}
                          imageWidth={file.width}
                          imageHeight={file.height}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="pending-message-footer">
                    <div className="pending-message-status">
                      {pending.status || "Sending..."}
                    </div>
                    <div className="deferred-message-actions">
                      <CopyTextButton
                        text={pending.content}
                        label="Copy message text"
                        className="deferred-message-action deferred-message-action-copy"
                        showTextLabel
                        onClick={(event) => event.stopPropagation()}
                      />
                    </div>
                  </div>
                </div>
                <MessageAge timestampMs={timestampMs} nowMs={nowMs} />
              </div>
            );
          }

          if (tailRow.kind === "project-queue") {
            const projectQueue = tailRow.message;
            const projectQueueStatus =
              tailRow.projectQueueStatusKind === "dispatching"
                ? t("projectQueueInlineStatusDispatching", {
                    position: projectQueue.projectPosition,
                  })
                : tailRow.projectQueueStatusKind === "failed"
                  ? t("projectQueueInlineStatusFailed", {
                      position: projectQueue.projectPosition,
                    })
                  : t("projectQueueInlineStatusQueued", {
                      position: projectQueue.projectPosition,
                    });
            return (
              <div
                key={tailRow.key}
                className={`deferred-message project-queue-inline-message message-render-row ${
                  hasMessageAge ? "has-message-age" : ""
                } ${showAgeByDefault ? "is-message-age-visible" : ""}`}
              >
                <div className="message-render-content">
                  <div className="message-user-prompt deferred-message-bubble project-queue-inline-message-bubble">
                    {projectQueue.content}
                  </div>
                  {projectQueue.attachments?.length ? (
                    <div className="attachment-list deferred-message-attachments-list">
                      {projectQueue.attachments.map((file) => (
                        <AttachmentChip
                          key={file.id}
                          attachmentId={file.id}
                          originalName={file.originalName}
                          path={file.path}
                          mimeType={file.mimeType}
                          sizeLabel={formatSize(file.size)}
                          imageWidth={file.width}
                          imageHeight={file.height}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="deferred-message-footer">
                    <span className="deferred-message-status project-queue-inline-message-status">
                      {projectQueueStatus}
                    </span>
                    {tailRow.showAttachmentCountBadge ? (
                      <span
                        className="deferred-message-attachments"
                        title={`${projectQueue.attachmentCount} attachment${
                          projectQueue.attachmentCount === 1 ? "" : "s"
                        } queued`}
                        role="img"
                        aria-label={`${projectQueue.attachmentCount} attachment${
                          projectQueue.attachmentCount === 1 ? "" : "s"
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
                        <span>{projectQueue.attachmentCount}</span>
                      </span>
                    ) : null}
                    {projectQueue.lastError && (
                      <span className="project-queue-inline-message-error">
                        {projectQueue.lastError}
                      </span>
                    )}
                    <div className="deferred-message-actions">
                      <CopyTextButton
                        text={projectQueue.content}
                        label={t("projectQueueInlineCopy")}
                        className="deferred-message-action deferred-message-action-copy"
                        showTextLabel
                        onClick={(event) => event.stopPropagation()}
                      />
                      {projectQueue.status !== "dispatching" &&
                        onCancelProjectQueueMessage && (
                          <button
                            type="button"
                            className="deferred-message-action deferred-message-action-cancel project-queue-inline-message-cancel"
                            disabled={projectQueue.isMutating}
                            onClick={() =>
                              onCancelProjectQueueMessage(projectQueue.id)
                            }
                            aria-label={t("projectQueueInlineCancel")}
                            title={t("projectQueueInlineCancel")}
                          >
                            <XIcon />
                            <span>{t("projectQueueDelete")}</span>
                          </button>
                        )}
                    </div>
                  </div>
                </div>
                <MessageAge timestampMs={timestampMs} nowMs={nowMs} />
              </div>
            );
          }

          const deferred = tailRow.message;
          const recoveredQueueId = tailRow.recoveredQueueId;
          const deferredStatus = tailRow.isRecovered
            ? t("sessionRecoveredQueuedPaused")
            : getDeferredMessageStatus({
                isPatient: tailRow.isPatient,
                lanePosition: tailRow.lanePosition,
                timestampMs,
                nowMs,
              });
          return (
            <div
              key={tailRow.key}
              className={`deferred-message message-render-row ${
                hasMessageAge ? "has-message-age" : ""
              } ${showAgeByDefault ? "is-message-age-visible" : ""}`}
            >
              <div className="message-render-content">
                <div className="message-user-prompt deferred-message-bubble">
                  {deferred.content}
                </div>
                {deferred.attachments?.length ? (
                  <div className="attachment-list deferred-message-attachments-list">
                    {deferred.attachments.map((file) => (
                      <AttachmentChip
                        key={file.id}
                        attachmentId={file.id}
                        originalName={file.originalName}
                        path={file.path}
                        mimeType={file.mimeType}
                        sizeLabel={formatSize(file.size)}
                        imageWidth={file.width}
                        imageHeight={file.height}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="deferred-message-footer">
                  <span
                    className="deferred-message-status"
                    title={
                      tailRow.isRecovered
                        ? t("sessionRecoveredQueuedPausedTitle")
                        : tailRow.isPatient
                          ? "Patient queue waits for verified quiet. Regular queued messages may pass it."
                          : undefined
                    }
                  >
                    {deferredStatus}
                  </span>
                  {tailRow.showAttachmentCountBadge ? (
                    <span
                      className="deferred-message-attachments"
                      title={`${deferred.attachmentCount} attachment${
                        deferred.attachmentCount === 1 ? "" : "s"
                      } queued`}
                      role="img"
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
                  <div className="deferred-message-actions">
                    <CopyTextButton
                      text={deferred.content}
                      label="Copy queued message"
                      className="deferred-message-action deferred-message-action-copy"
                      showTextLabel
                      onClick={(event) => event.stopPropagation()}
                    />
                    {recoveredQueueId && onResumeRecoveredDeferred ? (
                      <button
                        type="button"
                        className="deferred-message-action deferred-message-action-resume"
                        onClick={() =>
                          onResumeRecoveredDeferred(recoveredQueueId)
                        }
                        aria-label={t("sessionRecoveredQueuedResume")}
                        title={t("sessionRecoveredQueuedResume")}
                      >
                        <PlayIcon />
                        <span>{t("sessionRecoveredQueuedResumeShort")}</span>
                      </button>
                    ) : null}
                    {recoveredQueueId && onDeleteRecoveredDeferred ? (
                      <button
                        type="button"
                        className="deferred-message-action deferred-message-action-cancel"
                        onClick={() =>
                          onDeleteRecoveredDeferred(recoveredQueueId)
                        }
                        aria-label={t("sessionRecoveredQueuedDelete")}
                        title={t("sessionRecoveredQueuedDelete")}
                      >
                        <XIcon />
                        <span>{t("sessionRecoveredQueuedDeleteShort")}</span>
                      </button>
                    ) : deferred.tempId && onCancelDeferred ? (
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
                    ) : null}
                  </div>
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
        <ProcessingIndicator
          isProcessing={isProcessing}
          thinkingItemsVisible={thinkingItemsVisible}
          hasThinkingItems={hasThinkingItems}
          onToggleThinkingItemsVisible={toggleThinkingItemsVisible}
          thinkingLatestOnly={thinkingLatestOnly}
          onToggleThinkingLatestOnly={toggleThinkingLatestOnly}
        />
      </div>
    </>
  );
});
