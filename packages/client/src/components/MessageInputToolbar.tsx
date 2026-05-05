import { useEffect, useRef, useState } from "react";
import type { MouseEvent, RefObject, TouchEvent } from "react";
import { useOptionalRenderModeContext } from "../contexts/RenderModeContext";
import { useModelSettings } from "../hooks/useModelSettings";
import { useRelativeNow } from "../hooks/useRelativeNow";
import { useI18n } from "../i18n";
import { isStaleTimestamp, parseTimestampMs } from "../lib/messageAge";
import type { ModelIndicatorTone } from "../lib/modelConfigIndicator";
import {
  SESSION_ISEARCH_GUIDE_EVENT,
  type SessionIsearchGuideState,
  type SessionIsearchScope,
} from "../lib/sessionIsearchGuide";
import type { ContextUsage, PermissionMode } from "../types";
import { MessageAge } from "./MessageAge";
import { RenderModeGlyph } from "./ui/RenderModeGlyph";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { ModeSelector } from "./ModeSelector";
import { SlashCommandButton } from "./SlashCommandButton";
import { VoiceInputButton, type VoiceInputButtonRef } from "./VoiceInputButton";

export interface MessageInputToolbarProps {
  // Mode selector
  mode?: PermissionMode;
  onModeChange?: (mode: PermissionMode) => void;
  isHeld?: boolean;
  onHoldChange?: (held: boolean) => void;
  modeChangesApplyNextTurn?: boolean;

  // Provider capability flags (default to true for backwards compatibility)
  supportsPermissionMode?: boolean;
  supportsThinkingToggle?: boolean;

  // Attachments
  canAttach?: boolean;
  attachmentCount?: number;
  onAttachClick?: () => void;

  // Voice input
  voiceButtonRef?: RefObject<VoiceInputButtonRef | null>;
  onVoiceTranscript?: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
  onListeningStart?: () => void;
  voiceDisabled?: boolean;

  // Slash commands
  slashCommands?: string[];
  onSelectSlashCommand?: (command: string) => void;
  modelIndicatorTone?: ModelIndicatorTone;
  modelIndicatorTitle?: string;

  // Session heartbeat
  heartbeatEnabled?: boolean;
  onToggleHeartbeat?: () => void;
  onConfigureHeartbeat?: () => void;

  // Context usage
  contextUsage?: ContextUsage;
  /** Last session activity timestamp for stale composer liveness display. */
  lastActivityAt?: string | null;

  // Actions
  isRunning?: boolean;
  isThinking?: boolean;
  onStop?: () => void;
  onSend?: () => void;
  /** Queue a deferred message. Only provided when agent is running. */
  onQueue?: () => void;
  canSend?: boolean;
  disabled?: boolean;

  // Pending approval indicator
  pendingApproval?: {
    type: "tool-approval" | "user-question";
    onExpand: () => void;
  };
}

export function MessageInputToolbar({
  mode = "default",
  onModeChange,
  isHeld,
  onHoldChange,
  modeChangesApplyNextTurn,
  supportsPermissionMode = true,
  supportsThinkingToggle = true,
  canAttach,
  attachmentCount = 0,
  onAttachClick,
  voiceButtonRef,
  onVoiceTranscript,
  onInterimTranscript,
  onListeningStart,
  voiceDisabled,
  slashCommands = [],
  onSelectSlashCommand,
  modelIndicatorTone,
  modelIndicatorTitle,
  heartbeatEnabled = false,
  onToggleHeartbeat,
  onConfigureHeartbeat,
  contextUsage,
  lastActivityAt,
  isRunning,
  isThinking,
  onStop,
  onSend,
  onQueue,
  canSend,
  disabled,
  pendingApproval,
}: MessageInputToolbarProps) {
  const { t } = useI18n();
  const { thinkingMode, cycleThinkingMode, thinkingLevel } = useModelSettings();
  const renderMode = useOptionalRenderModeContext();
  const nowMs = useRelativeNow();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isearchScope, setIsearchScope] =
    useState<SessionIsearchScope | null>(null);
  const lastActivityMs = parseTimestampMs(lastActivityAt);
  const showLastActivityAge = isStaleTimestamp(lastActivityMs, nowMs);
  const heartbeatLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const suppressHeartbeatClickRef = useRef(false);
  const renderModeTitle =
    renderMode?.state === "rendered"
      ? t("toolbarRenderModeRendered")
      : renderMode?.state === "source"
        ? t("toolbarRenderModeSource")
        : t("toolbarRenderModeMixed");
  const hasDualActions = !!(onSend && onQueue);
  const sendTooltip = hasDualActions
    ? t("toolbarSteerTooltip")
    : t("toolbarSendTooltip");
  const queueTooltip = t("toolbarQueueTooltip");
  const shortcutsPopoverOpen = shortcutsOpen || isearchScope !== null;

  useEffect(() => {
    const handleIsearchGuide = (event: Event) => {
      const detail = (event as CustomEvent<SessionIsearchGuideState>).detail;
      if (detail?.active) {
        setIsearchScope(detail.scope);
        return;
      }
      setIsearchScope(null);
      setShortcutsOpen(false);
    };

    window.addEventListener(SESSION_ISEARCH_GUIDE_EVENT, handleIsearchGuide);
    return () =>
      window.removeEventListener(
        SESSION_ISEARCH_GUIDE_EVENT,
        handleIsearchGuide,
      );
  }, []);
  const stopTitle = `${t("toolbarStop")} (Esc)`;
  const showStopButton = !!(isRunning && onStop && isThinking);
  const showSendButton = !!(onSend && (!showStopButton || canSend));

  const clearHeartbeatLongPress = () => {
    if (heartbeatLongPressTimerRef.current) {
      clearTimeout(heartbeatLongPressTimerRef.current);
      heartbeatLongPressTimerRef.current = null;
    }
  };

  const handleHeartbeatClick = () => {
    if (suppressHeartbeatClickRef.current) {
      suppressHeartbeatClickRef.current = false;
      return;
    }
    onToggleHeartbeat?.();
  };

  const handleHeartbeatContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!onConfigureHeartbeat) return;
    e.preventDefault();
    clearHeartbeatLongPress();
    suppressHeartbeatClickRef.current = false;
    onConfigureHeartbeat();
  };

  const handleHeartbeatTouchStart = () => {
    if (!onConfigureHeartbeat) return;
    clearHeartbeatLongPress();
    suppressHeartbeatClickRef.current = false;
    heartbeatLongPressTimerRef.current = setTimeout(() => {
      suppressHeartbeatClickRef.current = true;
      heartbeatLongPressTimerRef.current = null;
      onConfigureHeartbeat();
    }, 450);
  };

  const handleHeartbeatTouchEnd = (e: TouchEvent<HTMLButtonElement>) => {
    if (suppressHeartbeatClickRef.current) {
      e.preventDefault();
    }
    clearHeartbeatLongPress();
  };

  const heartbeatTitle = t("sessionHeartbeatTitle");

  return (
    <div className="message-input-toolbar">
      <div className="message-input-left">
        {onModeChange && supportsPermissionMode && (
          <ModeSelector
            mode={mode}
            onModeChange={onModeChange}
            changesApplyNextTurn={modeChangesApplyNextTurn}
            isHeld={isHeld}
            onHoldChange={onHoldChange}
          />
        )}
        <button
          type="button"
          className="attach-button"
          onClick={onAttachClick}
          disabled={!canAttach}
          title={
            canAttach ? t("toolbarAttachFiles") : t("toolbarAttachDisabled")
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          {attachmentCount > 0 && (
            <span className="attach-count">{attachmentCount}</span>
          )}
        </button>
        {supportsThinkingToggle && (
          <button
            type="button"
            className={`thinking-toggle-button ${thinkingMode !== "off" ? `active ${thinkingMode}` : ""}`}
            onClick={cycleThinkingMode}
            title={
              thinkingMode === "off"
                ? t("newSessionThinkingOff")
                : thinkingMode === "auto"
                  ? t("newSessionThinkingAuto")
                  : t("newSessionThinkingOn", { level: thinkingLevel })
            }
            aria-label={t("newSessionThinkingMode", { mode: thinkingMode })}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
              {thinkingMode === "auto" && (
                <g>
                  <circle
                    cx="19"
                    cy="5"
                    r="5.5"
                    fill="currentColor"
                    stroke="none"
                  />
                  <text
                    x="19"
                    y="5"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--bg-primary, #1a1a2e)"
                    fontSize="8"
                    fontWeight="700"
                    fontFamily="system-ui, sans-serif"
                    stroke="none"
                  >
                    A
                  </text>
                </g>
              )}
            </svg>
          </button>
        )}
        {renderMode && (
          <button
            type="button"
            className={`render-mode-toolbar-button ${
              renderMode.state === "rendered"
                ? "is-rendered"
                : renderMode.state === "mixed"
                  ? "is-mixed"
                  : ""
            }`}
            onClick={renderMode.toggleGlobalMode}
            title={renderModeTitle}
            aria-label={renderModeTitle}
            aria-pressed={
              renderMode.state === "mixed"
                ? "mixed"
                : renderMode.state === "rendered"
            }
          >
            <RenderModeGlyph />
          </button>
        )}
        {onToggleHeartbeat && (
          <button
            type="button"
            className={`heartbeat-toolbar-button ${heartbeatEnabled ? "active" : ""}`}
            onClick={handleHeartbeatClick}
            onContextMenu={handleHeartbeatContextMenu}
            onTouchStart={handleHeartbeatTouchStart}
            onTouchEnd={handleHeartbeatTouchEnd}
            onTouchCancel={clearHeartbeatLongPress}
            onTouchMove={clearHeartbeatLongPress}
            title={heartbeatTitle}
            aria-label={heartbeatTitle}
            aria-pressed={heartbeatEnabled}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2v3" />
              <path d="M12 19v3" />
              <path d="m4.93 4.93 2.12 2.12" />
              <path d="m16.95 16.95 2.12 2.12" />
              <path d="M2 12h3" />
              <path d="M19 12h3" />
              <path d="m4.93 19.07 2.12-2.12" />
              <path d="m16.95 7.05 2.12-2.12" />
              <circle
                cx="12"
                cy="12"
                r="3.5"
                fill={heartbeatEnabled ? "currentColor" : "none"}
              />
            </svg>
          </button>
        )}
        {voiceButtonRef && onVoiceTranscript && onInterimTranscript && (
          <VoiceInputButton
            ref={voiceButtonRef}
            onTranscript={onVoiceTranscript}
            onInterimTranscript={onInterimTranscript}
            onListeningStart={onListeningStart}
            disabled={voiceDisabled}
          />
        )}
        {onSelectSlashCommand && (
          <SlashCommandButton
            commands={slashCommands}
            onSelectCommand={onSelectSlashCommand}
            disabled={voiceDisabled}
            modelIndicatorTone={
              slashCommands.includes("model") ? modelIndicatorTone : undefined
            }
            modelIndicatorTitle={modelIndicatorTitle}
          />
        )}
      </div>
      {showLastActivityAge && (
        <div
          className="composer-activity-age"
          aria-label="Session last activity"
        >
          <MessageAge
            timestampMs={lastActivityMs}
            nowMs={nowMs}
            className="composer-activity-age-time"
            prefix="Last activity"
          />
        </div>
      )}
      <div className="message-input-actions">
        {/* Pending approval indicator */}
        {pendingApproval && (
          <button
            type="button"
            className={`pending-approval-indicator ${pendingApproval.type}`}
            onClick={pendingApproval.onExpand}
            title={
              pendingApproval.type === "tool-approval"
                ? t("toolbarPendingApprovalExpand")
                : t("toolbarPendingQuestionExpand")
            }
          >
            <span className="pending-approval-dot" />
            <span className="pending-approval-text">
              {pendingApproval.type === "tool-approval"
                ? t("toolbarApproval")
                : t("toolbarQuestion")}
            </span>
          </button>
        )}
        <div
          className="session-shortcuts-help"
          onMouseLeave={() => {
            if (isearchScope === null) {
              setShortcutsOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="session-shortcuts-help-button"
            aria-label="Session keyboard shortcuts"
            aria-expanded={shortcutsPopoverOpen}
            onClick={() => setShortcutsOpen((open) => !open)}
            onFocus={() => setShortcutsOpen(true)}
            onBlur={(event) => {
              if (
                isearchScope === null &&
                !event.currentTarget.parentElement?.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                setShortcutsOpen(false);
              }
            }}
            onMouseEnter={() => setShortcutsOpen(true)}
          >
            ?
          </button>
          {shortcutsPopoverOpen && (
            <div
              className={`session-shortcuts-popover ${
                isearchScope !== null ? "is-isearch-guide" : ""
              }`}
              role="tooltip"
            >
              {isearchScope !== null ? (
                <>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd>
                      <kbd>{isearchScope === "all" ? "S" : "R"}</kbd>
                    </span>
                    <span>Previous match</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Enter</kbd>
                    </span>
                    <span>Jump</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Esc</kbd>
                    </span>
                    <span>Cancel / restore focus</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>End</kbd>
                    </span>
                    <span>Scroll to current</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd>
                      <kbd>{isearchScope === "all" ? "R" : "S"}</kbd>
                    </span>
                    <span>
                      {isearchScope === "all" ? "User turns" : "All turns"}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>R</kbd>
                    </span>
                    <span>User-turn reverse search</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>S</kbd>
                    </span>
                    <span>All-turn reverse search</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Enter</kbd>
                    </span>
                    <span>{hasDualActions ? "Steer current turn" : "Send"}</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Shift</kbd><kbd>Enter</kbd>
                    </span>
                    <span>New line</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>Enter</kbd>
                    </span>
                    <span>Queue while agent runs</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Esc</kbd>
                    </span>
                    <span>Stop agent / cancel overlay</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>P</kbd>
                    </span>
                    <span>Recall last sent text</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>K</kbd>
                    </span>
                    <span>Cancel latest queued message</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>End</kbd>
                    </span>
                    <span>Scroll to current</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>G</kbd>
                    </span>
                    <span>Clear composer</span>
                  </div>
                  <div className="session-shortcuts-row">
                    <span className="session-shortcuts-keys">
                      <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd>
                    </span>
                    <span>Rendered/source mode</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <ContextUsageIndicator usage={contextUsage} size={16} />
        {showStopButton && (
          <button
            type="button"
            onClick={onStop}
            className="stop-button"
            aria-label={t("toolbarStop")}
            title={stopTitle}
          >
            <span className="stop-icon" />
          </button>
        )}
        {showSendButton ? (
          <>
            {hasDualActions && onQueue && (
              <button
                type="button"
                onClick={onQueue}
                disabled={disabled || !canSend}
                className="send-button queue-button"
                aria-label={t("toolbarQueueLabel")}
                title={queueTooltip}
              >
                <span className="send-icon queue-icon">⏱</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSend}
              disabled={disabled || !canSend}
              className="send-button send-button-with-help"
              aria-label={hasDualActions ? t("toolbarSteerTooltip") : t("toolbarSend")}
              title={sendTooltip}
            >
              <span className="send-icon">{hasDualActions ? "↗" : "↑"}</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
