import { memo, useRef, useState } from "react";
import { useOptionalSessionMetadata } from "../../contexts/SessionMetadataContext";
import { MESSAGE_STALE_THRESHOLD_MS } from "../../lib/messageAge";
import {
  getExplorationKind,
  getExploredEntryDisplayLabel,
  getExploredEntryFallbackSummary,
  getLatestRenderItemsTimestampMs,
} from "../../lib/sessionDetail/renderSelectors";
import type { ToolCallItem } from "../../types/renderItems";
import { MessageAge } from "../MessageAge";
import { toolRegistry } from "../renderers/tools";
import type { RenderContext } from "../renderers/types";
import { getToolSummary } from "../tools/summaries";

interface Props {
  id: string;
  items: ToolCallItem[];
  sessionProvider?: string;
  staleNowMs?: number;
  latestVisibleTimestampMs?: number | null;
}

function statusGlyph(status: ToolCallItem["status"]): string {
  switch (status) {
    case "pending":
      return ".";
    case "error":
      return "!";
    case "aborted":
      return "x";
    case "incomplete":
      return "?";
    case "complete":
      return "";
  }
}

function renderEntrySummary(
  item: ToolCallItem,
  sessionProvider: string | undefined,
  projectPath: string | null | undefined,
) {
  const kind = getExplorationKind(item.toolName);
  const result = item.toolResult?.structured ?? item.toolResult?.content;
  const isComplete = item.status === "complete";
  const isError = item.toolResult?.isError ?? item.status === "error";
  const context: RenderContext = {
    isStreaming: item.status === "pending",
    theme: "dark",
    toolUseId: item.id,
    provider: sessionProvider,
    projectPath,
  };

  if (
    (kind === "read" || kind === "search") &&
    isComplete &&
    toolRegistry.hasInteractiveSummary(item.toolName)
  ) {
    const summary = toolRegistry.renderInteractiveSummary(
      item.toolName,
      item.toolInput,
      result,
      isError,
      context,
    );
    if (summary) {
      return summary;
    }
  }

  if (isComplete && (kind === "search" || kind === "list")) {
    return getToolSummary(
      item.toolName,
      item.toolInput,
      item.toolResult,
      item.status,
      { projectPath },
    );
  }

  return getExploredEntryFallbackSummary(item, projectPath);
}

export const ExploredToolGroup = memo(function ExploredToolGroup({
  id,
  items,
  sessionProvider,
  staleNowMs,
  latestVisibleTimestampMs,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const sessionMetadata = useOptionalSessionMetadata();
  const projectPath = sessionMetadata?.projectPath ?? null;
  const staticAgeNowMsRef = useRef(Date.now());
  const timestampMs = getLatestRenderItemsTimestampMs(items);
  const hasTimestamp = timestampMs !== null;
  const isLatestVisibleTimestamp =
    hasTimestamp && latestVisibleTimestampMs === timestampMs;
  const ageNowMs = isLatestVisibleTimestamp
    ? (staleNowMs ?? Date.now())
    : staticAgeNowMsRef.current;
  const showAgeByDefault =
    isLatestVisibleTimestamp &&
    ageNowMs !== null &&
    timestampMs !== null &&
    ageNowMs - timestampMs >= MESSAGE_STALE_THRESHOLD_MS;
  const toggleLabel = expanded
    ? "Collapse explored tools"
    : "Expand explored tools";

  return (
    <div
      className={[
        "message-render-row",
        "explored-message-row",
        hasTimestamp ? "has-message-age" : "",
        showAgeByDefault ? "is-message-age-visible" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-render-type="explored"
      data-render-id={id}
    >
      <div className="message-render-content">
        <div className="explored-group timeline-item">
          <button
            type="button"
            className="timeline-dot-btn"
            onClick={() => setExpanded((value) => !value)}
            aria-label={toggleLabel}
            title={toggleLabel}
          />
          <button
            type="button"
            className="explored-group-header"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <span className="explored-group-title">Explored</span>
            <span className="explored-group-count">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
            <span className="expand-chevron" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          </button>
          {expanded && (
            <div className="explored-group-body" role="list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`explored-entry status-${item.status}`}
                  data-render-id={item.id}
                  data-render-type={item.type}
                  role="listitem"
                >
                  <span className="explored-entry-status" aria-hidden="true">
                    {statusGlyph(item.status)}
                  </span>
                  <span className="explored-entry-tool">
                    {getExploredEntryDisplayLabel(item.toolName)}
                  </span>
                  <span className="explored-entry-summary">
                    {renderEntrySummary(item, sessionProvider, projectPath)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <MessageAge timestampMs={timestampMs} nowMs={ageNowMs ?? Date.now()} />
    </div>
  );
});
