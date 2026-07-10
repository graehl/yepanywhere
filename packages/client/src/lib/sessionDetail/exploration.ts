import {
  getExplorationKind,
  toolRegistry,
} from "../../components/renderers/tools";
import { getToolSummary } from "../../components/tools/summaries";
import { getLatestMessageTimestampMs } from "../messageAge";
import { getPathBasename, makeDisplayPath } from "../text";
import type { RenderItem, ToolCallItem } from "../../types/renderItems";
import {
  createExplorationProjection,
  EXPLORATION_GROUP_MAX_GAP_MS,
  type ExplorationProjection,
  projectExplorationParent,
} from "./explorationProjection";

export { getExplorationKind };

export type AssistantRenderSegment =
  | { kind: "item"; item: RenderItem }
  | {
      kind: "explored";
      id: string;
      items: ToolCallItem[];
      projection: ExplorationProjection;
    };

export function isExplorationToolCall(item: RenderItem): item is ToolCallItem {
  return (
    item.type === "tool_call" && getExplorationKind(item.toolName) !== null
  );
}

function renderItemTimestampsAreTooFarApart(
  previous: ToolCallItem,
  next: ToolCallItem,
): boolean {
  const previousTimestampMs = getLatestMessageTimestampMs(
    previous.sourceMessages,
  );
  const nextTimestampMs = getLatestMessageTimestampMs(next.sourceMessages);
  if (previousTimestampMs === null || nextTimestampMs === null) {
    return false;
  }
  return (
    Math.abs(nextTimestampMs - previousTimestampMs) >
    EXPLORATION_GROUP_MAX_GAP_MS
  );
}

function makeExploredSegment(items: ToolCallItem[]): AssistantRenderSegment {
  const parents = items.flatMap((item) => {
    const parent = projectExplorationParent(item);
    return parent ? [parent] : [];
  });
  const projection = createExplorationProjection(parents);
  return {
    kind: "explored",
    id: projection.id,
    items,
    projection,
  };
}

export function buildAssistantRenderSegments(
  items: readonly RenderItem[],
): AssistantRenderSegment[] {
  const segments: AssistantRenderSegment[] = [];
  let run: ToolCallItem[] = [];

  const flushRun = () => {
    if (run.length >= 2) {
      segments.push(makeExploredSegment(run));
    } else if (run[0]) {
      segments.push({ kind: "item", item: run[0] });
    }
    run = [];
  };

  for (const item of items) {
    if (!isExplorationToolCall(item)) {
      flushRun();
      segments.push({ kind: "item", item });
      continue;
    }

    const previous = run[run.length - 1];
    if (previous && renderItemTimestampsAreTooFarApart(previous, item)) {
      flushRun();
    }
    run.push(item);
  }

  flushRun();
  return segments;
}

export function getExploredEntryDisplayLabel(toolName: string): string {
  const kind = getExplorationKind(toolName);
  if (kind === "search") {
    if (toolRegistry.get(toolName).tool === "Grep") {
      return "Grep";
    }
    return "Search";
  }
  if (kind === "list") {
    return "List";
  }
  return "Read";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(input: unknown, field: string): string {
  if (!isRecord(input)) {
    return "";
  }
  const value = input[field];
  return typeof value === "string" ? value.trim() : "";
}

function compactPath(
  path: string,
  projectPath: string | null | undefined,
): string {
  return makeDisplayPath(path, projectPath);
}

function getSearchSummary(
  input: unknown,
  projectPath: string | null | undefined,
): string {
  const pattern = stringField(input, "pattern") || stringField(input, "query");
  const path =
    stringField(input, "path") ||
    stringField(input, "target_directory") ||
    stringField(input, "directory");
  const glob = stringField(input, "glob");
  const scope = path || glob;
  if (pattern && scope) {
    return `${pattern} in ${path ? compactPath(path, projectPath) : glob}`;
  }
  return pattern || scope || "search";
}

function getListSummary(
  input: unknown,
  projectPath: string | null | undefined,
): string {
  const pattern = stringField(input, "pattern");
  const path =
    stringField(input, "path") ||
    stringField(input, "target_directory") ||
    stringField(input, "directory");
  if (pattern && path) {
    return `${pattern} in ${compactPath(path, projectPath)}`;
  }
  return path ? compactPath(path, projectPath) : pattern || "files";
}

export function getExploredEntryFallbackSummary(
  item: ToolCallItem,
  projectPath?: string | null,
): string {
  const kind = getExplorationKind(item.toolName);
  if (kind === "search") {
    return getSearchSummary(item.toolInput, projectPath);
  }
  if (kind === "list") {
    return getListSummary(item.toolInput, projectPath);
  }
  const filePath =
    stringField(item.toolInput, "file_path") ||
    stringField(item.toolInput, "target_file");
  return filePath
    ? getPathBasename(makeDisplayPath(filePath, projectPath))
    : "file";
}

export function getExploredEntrySearchPreview(
  item: ToolCallItem,
  projectPath?: string | null,
): string {
  const summary = getExploredEntryFallbackSummary(item, projectPath);
  return summary
    ? `${getExploredEntryDisplayLabel(item.toolName)}: ${summary}`
    : getExploredEntryDisplayLabel(item.toolName);
}

export function getExploredEntrySearchText(
  item: ToolCallItem,
  projectPath?: string | null,
): string {
  const parts = [
    getExploredEntryDisplayLabel(item.toolName),
    getExploredEntryFallbackSummary(item, projectPath),
    getToolSummary(
      item.toolName,
      item.toolInput,
      item.toolResult,
      item.status,
      {
        projectPath,
      },
    ),
  ];
  return Array.from(
    new Set(parts.map((part) => part.trim()).filter(Boolean)),
  ).join("\n");
}
