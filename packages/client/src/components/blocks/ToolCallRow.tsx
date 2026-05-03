import {
  memo,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getDisplayBashCommandFromInput,
  isCodexLikeBashInput,
} from "../../lib/bashCommand";
import { parseShellToolOutput } from "../../lib/shellToolOutput";
import type { ToolCallItem, ToolResultData } from "../../types/renderItems";
import { toolRegistry } from "../renderers/tools";
import type { RenderContext } from "../renderers/types";
import { getToolSummary } from "../tools/summaries";
import { mayHaveFixedFontRichContent } from "../ui/FixedFontMathToggle";

interface Props {
  id: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResultData;
  status: ToolCallItem["status"];
  sessionProvider?: string;
}

const TOOL_ROW_HYDRATION_ROOT_MARGIN = "1600px 0px";

function canDeferRichToolRow(status: ToolCallItem["status"]): boolean {
  return status === "complete" || status === "error";
}

function useNearViewportHydration(status: ToolCallItem["status"]): {
  rowRef: RefObject<HTMLDivElement | null>;
  shouldHydrate: boolean;
  hydrateNow: () => void;
} {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [shouldHydrate, setShouldHydrate] = useState(
    () =>
      !canDeferRichToolRow(status) ||
      typeof window === "undefined" ||
      typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (!canDeferRichToolRow(status)) {
      setShouldHydrate(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setShouldHydrate(true);
      return;
    }
    setShouldHydrate(false);
  }, [status]);

  useEffect(() => {
    if (shouldHydrate || !canDeferRichToolRow(status)) {
      return;
    }

    const node = rowRef.current;
    if (!node) {
      setShouldHydrate(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldHydrate(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: TOOL_ROW_HYDRATION_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldHydrate, status]);

  return {
    rowRef,
    shouldHydrate,
    hydrateNow: () => setShouldHydrate(true),
  };
}

export const ToolCallRow = memo(function ToolCallRow({
  id,
  toolName,
  toolInput,
  toolResult,
  status,
  sessionProvider,
}: Props) {
  // Create a minimal render context for tool renderers
  const renderContext: RenderContext = useMemo(
    () => ({
      isStreaming: status === "pending",
      theme: "dark",
      toolUseId: id,
      provider: sessionProvider,
    }),
    [status, id, sessionProvider],
  );

  // Get structured result for interactive summary
  const structuredResult = toolResult?.structured ?? toolResult?.content;
  const {
    rowRef,
    shouldHydrate: shouldHydrateRichContent,
    hydrateNow,
  } = useNearViewportHydration(status);

  // Check if this tool renders inline (bypasses entire tool-row structure)
  const hasInlineRenderer = toolRegistry.hasInlineRenderer(toolName);
  const suppressCollapsedPreview = shouldSuppressBashCollapsedPreview(
    toolName,
    toolInput,
    structuredResult,
    sessionProvider,
    status,
  );

  const interactiveSummaryContent = useMemo(() => {
    if (status !== "complete" || !shouldHydrateRichContent) {
      return null;
    }
    return toolRegistry.renderInteractiveSummary(
      toolName,
      toolInput,
      structuredResult,
      toolResult?.isError ?? false,
      renderContext,
    );
  }, [
    status,
    toolName,
    toolInput,
    structuredResult,
    toolResult,
    renderContext,
    shouldHydrateRichContent,
  ]);

  const hasInteractiveSummary =
    interactiveSummaryContent !== null &&
    interactiveSummaryContent !== undefined &&
    interactiveSummaryContent !== false;

  const collapsedPreviewContent = useMemo(() => {
    if (suppressCollapsedPreview || !shouldHydrateRichContent) {
      return null;
    }
    return toolRegistry.renderCollapsedPreview(
      toolName,
      toolInput,
      structuredResult,
      toolResult?.isError ?? false,
      renderContext,
    );
  }, [
    suppressCollapsedPreview,
    toolName,
    toolInput,
    structuredResult,
    toolResult,
    renderContext,
    shouldHydrateRichContent,
  ]);

  const hasCollapsedPreview =
    collapsedPreviewContent !== null &&
    collapsedPreviewContent !== undefined &&
    collapsedPreviewContent !== false;
  const hideSummaryWhenPreviewVisible =
    toolName === "Bash" &&
    status === "pending" &&
    hasCollapsedPreview &&
    isCodexLikeBashInput(toolInput, sessionProvider);
  // Tools with collapsed preview or interactive summary don't expand
  const isNonExpandable = hasInteractiveSummary || hasCollapsedPreview;

  // Edit and TodoWrite tools are expanded by default
  const [expanded, setExpanded] = useState(
    !isNonExpandable && (toolName === "Edit" || toolName === "TodoWrite"),
  );

  const summary = useMemo(() => {
    return getToolSummary(toolName, toolInput, toolResult, status);
  }, [toolName, toolInput, toolResult, status]);

  const handleToggle = () => {
    hydrateNow();
    if (!isNonExpandable) {
      setExpanded(!expanded);
    }
  };

  // Inline renderers bypass the entire tool-row structure
  if (hasInlineRenderer) {
    return (
      <div className="tool-inline timeline-item">
        {toolRegistry.renderInline(
          toolName,
          toolInput,
          structuredResult,
          toolResult?.isError ?? false,
          status,
          renderContext,
        )}
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      onPointerEnter={hydrateNow}
      onFocus={hydrateNow}
      className={`tool-row timeline-item ${expanded ? "expanded" : "collapsed"} status-${status} ${isNonExpandable ? "interactive" : ""} ${shouldHydrateRichContent ? "" : "rich-deferred"}`}
    >
      <div
        className={`tool-row-header ${isNonExpandable ? "non-expandable" : ""}`}
        onClick={isNonExpandable ? undefined : handleToggle}
        onKeyDown={
          isNonExpandable
            ? undefined
            : (e) => e.key === "Enter" && handleToggle()
        }
        role={isNonExpandable ? "presentation" : "button"}
        tabIndex={isNonExpandable ? undefined : 0}
      >
        {status === "pending" && (
          <span className="tool-spinner" aria-label="Running">
            <Spinner />
          </span>
        )}
        {status === "aborted" && (
          <span className="tool-aborted-icon" aria-label="Interrupted">
            ⨯
          </span>
        )}
        {status === "incomplete" && (
          <span className="tool-incomplete-icon" aria-label="Result unavailable">
            ?
          </span>
        )}

        <span className="tool-name">
          {toolRegistry.getDisplayName(toolName)}
        </span>

        {hasInteractiveSummary && status === "complete" ? (
          <span className="tool-summary interactive-summary">
            {interactiveSummaryContent}
          </span>
        ) : !hideSummaryWhenPreviewVisible ? (
          <span className="tool-summary">
            {summary}
            {status === "aborted" && (
              <span className="tool-aborted-label"> (interrupted)</span>
            )}
            {status === "incomplete" && (
              <span className="tool-incomplete-label">
                {" "}
                (result unavailable)
              </span>
            )}
          </span>
        ) : null}

        {!isNonExpandable && (
          <span className="expand-chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </div>

      {/* Collapsed preview - shown when tool supports it (non-expandable) */}
      {hasCollapsedPreview && (
        <div className="tool-row-collapsed-preview">
          {collapsedPreviewContent}
        </div>
      )}

      {expanded && !isNonExpandable && (
        <div className="tool-row-content">
          {status === "pending" ||
          status === "aborted" ||
          status === "incomplete" ? (
            <ToolUseExpanded
              toolName={toolName}
              toolInput={toolInput}
              context={renderContext}
            />
          ) : (
            <ToolResultExpanded
              toolName={toolName}
              toolInput={toolInput}
              toolResult={toolResult}
              context={renderContext}
            />
          )}
        </div>
      )}
    </div>
  );
});

function shouldSuppressBashCollapsedPreview(
  toolName: string,
  toolInput: unknown,
  result: unknown,
  sessionProvider?: string,
  status?: ToolCallItem["status"],
): boolean {
  if (toolName !== "Bash") {
    return false;
  }

  if (!isCodexLikeBashInput(toolInput, sessionProvider)) {
    return false;
  }

  // Keep Codex bash rows compact by default (header + expandable details) for
  // ordinary commands, but surface markdown-like output so the render toggle is
  // reachable from the row instead of requiring an expansion first.
  if (status === "pending") {
    return true;
  }
  if (
    status === "complete" ||
    status === "error" ||
    status === "aborted" ||
    status === "incomplete"
  ) {
    const output = getBashResultOutputForRichPreview(result);
    return !output || !mayHaveFixedFontRichContent(output);
  }

  const command = getDisplayBashCommandFromInput(toolInput);
  if (!command) {
    return false;
  }

  return /^(rg|grep|sed|nl|cat)\b/.test(command.trimStart());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getBashResultOutputForRichPreview(result: unknown): string {
  if (typeof result === "string") {
    const parsed = parseShellToolOutput(result);
    return parsed.hasEnvelope ? parsed.output : result;
  }

  if (!isRecord(result)) {
    return "";
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (stdout || stderr) {
    return [stdout, stderr].filter(Boolean).join("\n");
  }

  if (typeof result.content === "string") {
    const parsed = parseShellToolOutput(result.content);
    return parsed.hasEnvelope ? parsed.output : result.content;
  }

  return "";
}

function ToolUseExpanded({
  toolName,
  toolInput,
  context,
}: {
  toolName: string;
  toolInput: unknown;
  context: RenderContext;
}) {
  return (
    <div className="tool-use-expanded">
      {toolRegistry.renderToolUse(toolName, toolInput, context)}
    </div>
  );
}

function ToolResultExpanded({
  toolName,
  toolInput,
  toolResult,
  context,
}: {
  toolName: string;
  toolInput: unknown;
  toolResult: ToolResultData | undefined;
  context: RenderContext;
}) {
  if (!toolResult) {
    return <div className="tool-no-result">No result data</div>;
  }

  // Use structured result if available, otherwise fall back to content
  const result = toolResult.structured ?? toolResult.content;

  return (
    <div className="tool-result-expanded">
      {toolRegistry.renderToolResult(
        toolName,
        result,
        toolResult.isError,
        context,
        toolInput,
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="spinner"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="24"
        strokeDashoffset="8"
      />
    </svg>
  );
}
