import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import { useFabVisibility } from "../hooks/useFabVisibility";
import { useFloatingActionButtonEnabled } from "../hooks/useFloatingActionButtonEnabled";
import { setRecentProjectId } from "../hooks/useRecentProject";
import { setNewSessionPrefill } from "../lib/newSessionPrefill";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import { generateUUID } from "../lib/uuid";
import {
  clearSpeechInsertionRangeReplacement,
  createSpeechInsertionRange,
  getSpeechSelectionFinalDelayMs,
  getSpeechTranscriptInsertionParts,
  getSpeechTranscriptReplacementParts,
  mapSpeechInsertionRangeThroughEdit,
  mapSpeechInsertionRangeThroughReplacement,
  removeLatestSpeechChunkFromRange,
  retargetSpeechInsertionRangeReplacement,
  replaceSpeechTranscriptBefore,
  replaceSpeechTranscriptInRange,
  type SpeechInsertionRange,
} from "../lib/speechRecognition";
import {
  captureTextareaAppendSelection,
  restoreTextareaReplacementSelection,
} from "../lib/textareaSelection";
import type {
  SpeechTranscriptionContext,
  SpeechTranscriptionResultMetadata,
} from "../lib/speechProviders/SpeechProvider";
import { VoiceInputButton, type VoiceInputButtonRef } from "./VoiceInputButton";

const FAB_DRAFT_KEY = "fab-draft";

function createSpeechTargetId(): string {
  return `speech-target-${generateUUID()}`;
}

interface PendingTextareaSelectionRestore {
  value: string;
  restore: (textarea: HTMLTextAreaElement) => void;
}

interface PendingSpeechFinal {
  timer: ReturnType<typeof setTimeout>;
  transcript: string;
  metadata?: SpeechTranscriptionResultMetadata;
}

/**
 * Floating Action Button for quick session creation.
 * Desktop-only feature that appears in the right margin when there's room.
 */
export function FloatingActionButton() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = useRemoteBasePath();
  const fabVisibility = useFabVisibility();
  const { floatingActionButtonEnabled } = useFloatingActionButtonEnabled();
  const [isExpanded, setIsExpanded] = useState(false);
  const [message, setMessage, draftControls] =
    useDraftPersistence(FAB_DRAFT_KEY);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechProcessing, setSpeechProcessing] = useState(false);
  const [, setSpeechPreviewRevision] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceButtonRef = useRef<VoiceInputButtonRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const speechInsertionRangeRef = useRef<SpeechInsertionRange | null>(null);
  const activeSpeechTargetIdRef = useRef<string | null>(null);
  const speechInsertionRangesRef = useRef<Map<string, SpeechInsertionRange>>(
    new Map(),
  );
  const pendingSpeechFinalRef = useRef<PendingSpeechFinal | null>(null);
  const pendingTextareaSelectionRef =
    useRef<PendingTextareaSelectionRestore | null>(null);
  const interimDisplayTranscript = interimTranscript.trim();
  const speechInlineTranscript =
    interimDisplayTranscript ||
    (speechProcessing ? t("speechTranscribingPlaceholder" as never) : "");
  const speechInsertionRange = speechInsertionRangeRef.current;
  const interimInsertion = speechInsertionRange
    ? getSpeechTranscriptReplacementParts(
        message,
        speechInlineTranscript,
        speechInsertionRange.end,
        speechInsertionRange.replaceEnd ?? speechInsertionRange.end,
      )
    : getSpeechTranscriptInsertionParts(
        message,
        speechInlineTranscript,
        message.length,
      );

  // Extract projectId from current URL if we're in a project context
  const projectIdFromUrl = extractProjectIdFromPath(location.pathname);

  // Update recent project when navigating to a project page
  useEffect(() => {
    if (projectIdFromUrl) {
      setRecentProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl]);

  // Focus textarea when expanded
  useEffect(() => {
    if (isExpanded) {
      textareaRef.current?.focus();
    }
  }, [isExpanded]);

  useLayoutEffect(() => {
    const pending = pendingTextareaSelectionRef.current;
    const textarea = textareaRef.current;
    if (!pending || !textarea || textarea.value !== pending.value) return;
    pendingTextareaSelectionRef.current = null;
    pending.restore(textarea);
  }, [message]);

  // Close on click outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  const handleSubmit = useCallback(
    (messageOverride?: unknown) => {
      const trimmed = (
        typeof messageOverride === "string" ? messageOverride : message
      ).trim();
      if (!trimmed) return;

      // Store the message for NewSessionForm to pick up
      setNewSessionPrefill(trimmed);
      draftControls.clearDraft();
      setIsExpanded(false);

      // Navigate to new session page
      if (projectIdFromUrl) {
        navigate(
          `${basePath}/new-session?projectId=${encodeURIComponent(projectIdFromUrl)}`,
        );
        return;
      }

      navigate(`${basePath}/new-session`);
    },
    [message, projectIdFromUrl, navigate, draftControls, basePath],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip Enter during IME composition (e.g. Chinese/Japanese/Korean input)
    if (e.key === "Enter" && e.nativeEvent.isComposing) return;

    if (
      e.key === "Escape" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      !e.altKey &&
      voiceButtonRef.current?.isListening
    ) {
      e.preventDefault();
      e.stopPropagation();
      handleListeningStop();
      voiceButtonRef.current.stopAndFinalize();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      setIsExpanded(false);
    }
    // Shift+Enter naturally adds newline (default behavior)
  };

  const handleButtonClick = useCallback(() => {
    setIsExpanded(true);
  }, []);

  // Voice input handlers
  const handleListeningStart = useCallback(() => {
    const textarea = textareaRef.current;
    const current = draftControls.getDraft();
    const selectionStart = Math.max(
      0,
      Math.min(textarea?.selectionStart ?? current.length, current.length),
    );
    const selectionEnd = Math.max(
      selectionStart,
      Math.min(textarea?.selectionEnd ?? selectionStart, current.length),
    );
    const targetId = createSpeechTargetId();
    const range = createSpeechInsertionRange(selectionStart, selectionEnd);
    activeSpeechTargetIdRef.current = targetId;
    speechInsertionRangeRef.current = range;
    speechInsertionRangesRef.current.set(targetId, range);
    pendingTextareaSelectionRef.current = null;
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    }
    setInterimTranscript("");
  }, [draftControls]);

  const clearPendingSpeechFinal = useCallback(() => {
    const pending = pendingSpeechFinalRef.current;
    if (pending === null) return;
    clearTimeout(pending.timer);
    pendingSpeechFinalRef.current = null;
  }, []);

  useEffect(() => clearPendingSpeechFinal, [clearPendingSpeechFinal]);

  const handleSpeechSelectionTarget = useCallback(() => {
    const textarea = textareaRef.current;
    const range = speechInsertionRangeRef.current;
    if (!textarea || !range) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    if (selectionStart === selectionEnd) {
      clearPendingSpeechFinal();
      const nextRange = clearSpeechInsertionRangeReplacement(range);
      speechInsertionRangeRef.current = nextRange;
      if (activeSpeechTargetIdRef.current) {
        speechInsertionRangesRef.current.set(
          activeSpeechTargetIdRef.current,
          nextRange,
        );
      }
      setSpeechPreviewRevision((revision) => revision + 1);
      return;
    }
    if (
      range.replaceSelectedAtMs === undefined &&
      range.end === selectionStart &&
      range.replaceEnd === selectionEnd
    ) {
      return;
    }
    const nextRange = retargetSpeechInsertionRangeReplacement(
      range,
      selectionStart,
      selectionEnd,
    );
    speechInsertionRangeRef.current = nextRange;
    if (activeSpeechTargetIdRef.current) {
      speechInsertionRangesRef.current.set(
        activeSpeechTargetIdRef.current,
        nextRange,
      );
    }
    setSpeechPreviewRevision((revision) => revision + 1);
  }, [clearPendingSpeechFinal]);

  const clearSpeechSelectionTarget = useCallback(() => {
    clearPendingSpeechFinal();
    if (!speechInsertionRangeRef.current) return;
    const nextRange = clearSpeechInsertionRangeReplacement(
      speechInsertionRangeRef.current,
    );
    speechInsertionRangeRef.current = nextRange;
    if (activeSpeechTargetIdRef.current) {
      speechInsertionRangesRef.current.set(
        activeSpeechTargetIdRef.current,
        nextRange,
      );
    }
    setSpeechPreviewRevision((revision) => revision + 1);
  }, [clearPendingSpeechFinal]);

  const commitVoiceTranscript = useCallback(
    (
      transcript: string,
      metadata?: SpeechTranscriptionResultMetadata,
    ) => {
      const targetId = metadata?.speechTargetId;
      const getSpeechRange = () =>
        targetId
          ? (speechInsertionRangesRef.current.get(targetId) ?? null)
          : speechInsertionRangeRef.current;
      const updateSpeechRange = (range: SpeechInsertionRange | null) => {
        if (targetId) {
          if (range) {
            speechInsertionRangesRef.current.set(targetId, range);
          } else {
            speechInsertionRangesRef.current.delete(targetId);
          }
          if (activeSpeechTargetIdRef.current === targetId) {
            speechInsertionRangeRef.current = range;
          }
          return;
        }
        speechInsertionRangeRef.current = range;
        if (activeSpeechTargetIdRef.current) {
          if (range) {
            speechInsertionRangesRef.current.set(
              activeSpeechTargetIdRef.current,
              range,
            );
          } else {
            speechInsertionRangesRef.current.delete(
              activeSpeechTargetIdRef.current,
            );
          }
        }
      };
      const mapOtherSpeechRangesThroughReplacement = (
        replacementStart: number,
        replacementEnd: number,
        insertedLength: number,
        committedRange: SpeechInsertionRange | null,
      ) => {
        if (speechInsertionRangesRef.current.size === 0) return;
        const committedTargetId =
          targetId ?? activeSpeechTargetIdRef.current;
        const nextRanges = new Map<string, SpeechInsertionRange>();
        for (const [rangeTargetId, range] of speechInsertionRangesRef.current) {
          if (rangeTargetId === committedTargetId) {
            if (committedRange) nextRanges.set(rangeTargetId, committedRange);
            continue;
          }
          nextRanges.set(
            rangeTargetId,
            mapSpeechInsertionRangeThroughReplacement(
              range,
              replacementStart,
              replacementEnd,
              insertedLength,
            ),
          );
        }
        speechInsertionRangesRef.current = nextRanges;
        speechInsertionRangeRef.current =
          activeSpeechTargetIdRef.current !== null
            ? (nextRanges.get(activeSpeechTargetIdRef.current) ?? null)
            : null;
      };
      if (metadata?.smartTurnCommand === "cancel") {
        const current = draftControls.getDraft();
        const range = getSpeechRange();
        const removal = range
          ? removeLatestSpeechChunkFromRange(current, range)
          : null;
        if (removal) {
          if (removal.text !== current) {
            const selection = captureTextareaAppendSelection(
              textareaRef.current,
              current,
            );
            pendingTextareaSelectionRef.current = {
              value: removal.text,
              restore: (textarea) => {
                restoreTextareaReplacementSelection(
                  textarea,
                  selection,
                  removal.text,
                  removal.replacementStart,
                  removal.replacementEnd,
                  0,
                );
              },
            };
            draftControls.setDraft(removal.text);
            mapOtherSpeechRangesThroughReplacement(
              removal.replacementStart,
              removal.replacementEnd,
              removal.insertedLength,
              removal.range,
            );
            updateSpeechRange(removal.range);
          } else {
            pendingTextareaSelectionRef.current = null;
          }
        } else {
          pendingTextareaSelectionRef.current = null;
          if (targetId) updateSpeechRange(null);
        }
        setInterimTranscript("");
        return;
      }

      const current = draftControls.getDraft();
      const trimmedTranscript = transcript.trim();
      const speechRange = getSpeechRange();
      let nextSpeechRange: SpeechInsertionRange | null = null;
      const replacement = speechRange
        ? (() => {
            const rangeReplacement = replaceSpeechTranscriptInRange(
              current,
              trimmedTranscript,
              speechRange,
              metadata?.replacePreviousTranscriptChars ?? 0,
            );
            nextSpeechRange = rangeReplacement.range;
            return rangeReplacement;
          })()
        : replaceSpeechTranscriptBefore(
            current,
            trimmedTranscript,
            current.length,
            0,
          );
      const nextMessage =
        trimmedTranscript || metadata?.replacePreviousTranscriptChars
          ? replacement.text
          : current;
      if (nextMessage !== current) {
        const selection = captureTextareaAppendSelection(
          textareaRef.current,
          current,
        );
        pendingTextareaSelectionRef.current = {
          value: nextMessage,
          restore: (textarea) => {
            restoreTextareaReplacementSelection(
              textarea,
              selection,
              nextMessage,
              replacement.replacementStart,
              replacement.replacementEnd,
              replacement.insertedLength,
            );
          },
        };
        draftControls.setDraft(nextMessage);
        mapOtherSpeechRangesThroughReplacement(
          replacement.replacementStart,
          replacement.replacementEnd,
          replacement.insertedLength,
          nextSpeechRange,
        );
        if (nextSpeechRange) {
          updateSpeechRange(nextSpeechRange);
        }
      }
      setInterimTranscript("");
      if (metadata?.smartTurnCommand) {
        updateSpeechRange(null);
      }
      if (metadata?.smartTurnCommand === "send") {
        handleSubmit(nextMessage);
      }
    },
    [draftControls, handleSubmit],
  );

  const handleVoiceTranscript = useCallback(
    (transcript: string, metadata?: SpeechTranscriptionResultMetadata) => {
      const speechRange = metadata?.speechTargetId
        ? (speechInsertionRangesRef.current.get(metadata.speechTargetId) ?? null)
        : speechInsertionRangeRef.current;
      const delayMs = metadata?.smartTurnCommand
        ? 0
        : getSpeechSelectionFinalDelayMs(speechRange);
      if (delayMs > 0) {
        clearPendingSpeechFinal();
        const timer = setTimeout(() => {
          const pending = pendingSpeechFinalRef.current;
          if (!pending || pending.timer !== timer) return;
          pendingSpeechFinalRef.current = null;
          commitVoiceTranscript(pending.transcript, pending.metadata);
        }, delayMs);
        pendingSpeechFinalRef.current = { timer, transcript, metadata };
        return;
      }

      clearPendingSpeechFinal();
      commitVoiceTranscript(transcript, metadata);
    },
    [clearPendingSpeechFinal, commitVoiceTranscript],
  );

  const flushPendingSpeechFinal = useCallback(() => {
    const pending = pendingSpeechFinalRef.current;
    if (pending === null) return;
    clearTimeout(pending.timer);
    pendingSpeechFinalRef.current = null;
    commitVoiceTranscript(pending.transcript, pending.metadata);
  }, [commitVoiceTranscript]);

  const handleListeningStop = useCallback(() => {
    flushPendingSpeechFinal();
    setInterimTranscript("");
  }, [flushPendingSpeechFinal]);

  const handleInterimTranscript = useCallback((transcript: string) => {
    setInterimTranscript(transcript);
  }, []);

  const handleSpeechProcessingChange = useCallback((processing: boolean) => {
    setSpeechProcessing(processing);
  }, []);

  const getTranscriptionContext =
    useCallback((): SpeechTranscriptionContext => {
      return {
        draftKey: FAB_DRAFT_KEY,
        speechTargetId: activeSpeechTargetIdRef.current ?? undefined,
      };
    }, []);

  // Hide (but don't unmount) when not visible, on new-session page, or while
  // supervising an active session. On session pages it duplicates the sidebar
  // new-session affordance and competes with the real composer.
  // This preserves expanded state and draft across navigation
  const isSessionPage = /\/sessions\/[^/]+/.test(location.pathname);
  const isHidden =
    !floatingActionButtonEnabled ||
    !fabVisibility ||
    location.pathname.endsWith("/new-session") ||
    isSessionPage;

  const { right, bottom, maxWidth } = fabVisibility ?? {
    right: 24,
    bottom: 80,
    maxWidth: 200,
  };

  return (
    <div
      ref={containerRef}
      className={`fab-container ${isExpanded ? "fab-expanded" : "fab-collapsed"}`}
      style={{
        right: `${right}px`,
        bottom: `${bottom}px`,
        width: `${maxWidth}px`, // Always use maxWidth so button stays centered
        display: isHidden ? "none" : undefined,
      }}
    >
      {/* Input panel appears above the button */}
      {isExpanded && (
        <div className="fab-input-panel">
          <div
            className={`speech-draft-field ${speechInlineTranscript ? "has-interim" : ""}`}
          >
            <div className="speech-draft-inline">
              {speechInlineTranscript && (
                <div className="speech-draft-mirror" aria-hidden="true">
                  <span>{interimInsertion.before}</span>
                  {interimInsertion.separatorBefore}
                  <span
                    className={
                      interimDisplayTranscript
                        ? "speech-interim-inline"
                        : "speech-processing-inline"
                    }
                  >
                    {interimInsertion.transcript}
                  </span>
                  {interimInsertion.separatorAfter}
                  <span>{interimInsertion.after}</span>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => {
                  const nextMessage = e.target.value;
                  clearPendingSpeechFinal();
                  if (speechInsertionRangesRef.current.size > 0) {
                    const nextRanges = new Map<string, SpeechInsertionRange>();
                    for (const [targetId, range] of speechInsertionRangesRef
                      .current) {
                      nextRanges.set(
                        targetId,
                        clearSpeechInsertionRangeReplacement(
                          mapSpeechInsertionRangeThroughEdit(
                            message,
                            nextMessage,
                            range,
                          ),
                        ),
                      );
                    }
                    speechInsertionRangesRef.current = nextRanges;
                    speechInsertionRangeRef.current =
                      activeSpeechTargetIdRef.current !== null
                        ? (nextRanges.get(activeSpeechTargetIdRef.current) ??
                          null)
                        : null;
                  }
                  setMessage(nextMessage);
                }}
                onKeyDown={handleKeyDown}
                onSelect={handleSpeechSelectionTarget}
                onPointerUp={handleSpeechSelectionTarget}
                onKeyUp={handleSpeechSelectionTarget}
                onCut={clearSpeechSelectionTarget}
                onCopy={clearSpeechSelectionTarget}
                onPaste={clearSpeechSelectionTarget}
                placeholder={t("fabPlaceholder")}
                className="fab-textarea"
                rows={3}
              />
            </div>
            {interimTranscript && (
              <div
                className="speech-interim-status"
                role="status"
                aria-live="polite"
                aria-label="Tentative speech transcript"
              >
                {interimTranscript}
              </div>
            )}
          </div>
          <div className="fab-input-toolbar">
            <VoiceInputButton
              ref={voiceButtonRef}
              onTranscript={handleVoiceTranscript}
              onInterimTranscript={handleInterimTranscript}
              onListeningStart={handleListeningStart}
              onListeningStop={handleListeningStop}
              onProcessingChange={handleSpeechProcessingChange}
              getTranscriptionContext={getTranscriptionContext}
              className="toolbar-button"
            />
            <button
              type="button"
              className="fab-submit"
              onClick={handleSubmit}
              disabled={!message.trim()}
              aria-label={t("fabGoToNewSession")}
            >
              ↵
            </button>
          </div>
        </div>
      )}
      {/* FAB button always at the bottom */}
      <button
        type="button"
        className={`fab-button ${isExpanded ? "fab-button-active" : ""}`}
        onClick={isExpanded ? () => setIsExpanded(false) : handleButtonClick}
        aria-label={isExpanded ? t("fabClose") : t("fabNewSession")}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={isExpanded ? "fab-icon-rotated" : ""}
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Extract projectId from URL path.
 * Matches: /projects/:projectId, /projects/:projectId/sessions/:sessionId,
 * and relay mode paths like /remote/:username/projects/:projectId
 */
function extractProjectIdFromPath(pathname: string): string | null {
  // Match both direct paths and relay mode paths
  const match = pathname.match(/\/projects\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
