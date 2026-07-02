import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import { toolRegistry } from "../../components/renderers/tools";
import { getToolSummary } from "../../components/tools/summaries";
import { getLatestMessageTimestampMs } from "../messageAge";
import { parseUserPrompt } from "../parseUserPrompt";
import { getPathBasename, makeDisplayPath } from "../text";
import type { ContentBlock, Message } from "../../types";
import type {
  RenderItem,
  ToolCallItem,
  UserPromptItem,
} from "../../types/renderItems";
import {
  type ActiveToolApproval,
  preprocessMessages,
} from "../preprocessMessages";
import { stabilizeRenderItems } from "../stableRenderItems";
import { insertTranscriptDisplayObjects } from "../transcriptDisplayObjects";
import type { MarkdownAugmentMap, SessionDetailState } from "./types";

export interface SessionDetailRenderItemInput {
  messages: Message[];
  markdownAugments?: MarkdownAugmentMap;
  activeToolApproval?: ActiveToolApproval;
  transcriptDisplayObjects?: readonly TranscriptDisplayObject[];
  previousRenderItems?: readonly RenderItem[];
}

export interface RenderTurnGroup {
  isUserPrompt: boolean;
  isStandalone?: boolean;
  items: RenderItem[];
}

export interface RenderNavAnchor {
  id: string;
  preview: string;
  searchText?: string;
  targetId?: string;
  timestampMs?: number | null;
}

const SESSION_SETUP_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
];

const EXPLORATION_GROUP_MAX_GAP_MS = 5 * 60 * 1000;

type ExplorationKind = "read" | "search" | "list";

export type AssistantRenderSegment =
  | { kind: "item"; item: RenderItem }
  | { kind: "explored"; id: string; items: ToolCallItem[] };

export function buildSessionDetailRenderItems({
  messages,
  markdownAugments,
  activeToolApproval,
  transcriptDisplayObjects = [],
  previousRenderItems = [],
}: SessionDetailRenderItemInput): RenderItem[] {
  const preprocessed = preprocessMessages(messages, {
    markdown: markdownAugments,
    activeToolApproval,
  });
  const inserted = insertTranscriptDisplayObjects(
    preprocessed,
    transcriptDisplayObjects,
  );
  return stabilizeRenderItems(previousRenderItems, inserted);
}

export function selectSessionDetailRenderItems(
  state: SessionDetailState,
  options: Omit<
    SessionDetailRenderItemInput,
    "messages" | "markdownAugments"
  > = {},
): RenderItem[] {
  return buildSessionDetailRenderItems({
    ...options,
    messages: state.messages,
    markdownAugments: state.markdownAugments,
  });
}

export function groupRenderItemsIntoTurns(
  items: readonly RenderItem[],
): RenderTurnGroup[] {
  const groups: RenderTurnGroup[] = [];
  let currentAssistantGroup: RenderItem[] = [];

  for (const item of items) {
    if (item.type === "transcript_display_object") {
      if (currentAssistantGroup.length > 0) {
        groups.push({ isUserPrompt: false, items: currentAssistantGroup });
        currentAssistantGroup = [];
      }
      groups.push({
        isUserPrompt: false,
        isStandalone: true,
        items: [item],
      });
    } else if (item.type === "user_prompt" || item.type === "session_setup") {
      if (currentAssistantGroup.length > 0) {
        groups.push({ isUserPrompt: false, items: currentAssistantGroup });
        currentAssistantGroup = [];
      }
      groups.push({ isUserPrompt: true, items: [item] });
    } else {
      currentAssistantGroup.push(item);
    }
  }

  if (currentAssistantGroup.length > 0) {
    groups.push({ isUserPrompt: false, items: currentAssistantGroup });
  }

  return groups;
}

export function getLatestRenderItemsTimestampMs(
  items: readonly RenderItem[],
): number | null {
  let latest: number | null = null;
  for (const item of items) {
    const timestampMs = getLatestMessageTimestampMs(item.sourceMessages);
    if (timestampMs === null) {
      continue;
    }
    latest = latest === null ? timestampMs : Math.max(latest, timestampMs);
  }
  return latest;
}

export function getExplorationKind(toolName: string): ExplorationKind | null {
  const normalized = toolName.toLowerCase();
  const canonical = toolRegistry.get(toolName).tool;

  if (canonical === "Read" || normalized === "read") {
    return "read";
  }
  if (
    canonical === "Grep" ||
    normalized === "grep" ||
    normalized === "search" ||
    normalized === "grepsearch" ||
    normalized === "grep_search"
  ) {
    return "search";
  }
  if (
    canonical === "Glob" ||
    normalized === "glob" ||
    normalized === "ls" ||
    normalized === "list" ||
    normalized === "listdir" ||
    normalized === "list_dir" ||
    normalized === "list-dir"
  ) {
    return "list";
  }
  return null;
}

export function isExplorationToolCall(
  item: RenderItem,
): item is ToolCallItem {
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
  const first = items[0];
  const last = items[items.length - 1];
  return {
    kind: "explored",
    id: `explored-${first?.id ?? "start"}-${last?.id ?? "end"}`,
    items,
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

export function getPromptTextForCorrection(
  content: string | ContentBlock[],
): string {
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

export function getSearchPreviewFallback(text: string): string {
  const compactText = text.replace(/\s+/g, " ").trim();
  if (compactText.length <= 180) {
    return compactText;
  }
  return `${compactText.slice(0, 177).trimEnd()}...`;
}

export function normalizeSearchText(
  text: string,
  caseSensitive = false,
): string {
  const compactText = text.replace(/\s+/g, " ").trim();
  return caseSensitive ? compactText : compactText.toLowerCase();
}

export function isSessionSetupText(text: string): boolean {
  const trimmed = text.trimStart();
  return SESSION_SETUP_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function getSearchableUserTurnPreview(
  item: RenderItem,
): string | null {
  if (item.type !== "user_prompt" || item.isSubagent) {
    return null;
  }
  const preview = getUserTurnPreview(item.content);
  return preview && !isSessionSetupText(preview) ? preview : null;
}

function stringifySearchValue(value: unknown): string {
  const seen = new WeakSet<object>();

  const stringify = (nestedValue: unknown): string => {
    if (nestedValue === null || nestedValue === undefined) {
      return "";
    }
    if (typeof nestedValue === "string") {
      return nestedValue;
    }
    if (
      typeof nestedValue === "number" ||
      typeof nestedValue === "boolean" ||
      typeof nestedValue === "bigint"
    ) {
      return String(nestedValue);
    }
    if (typeof nestedValue !== "object") {
      return String(nestedValue);
    }
    if (seen.has(nestedValue)) {
      return "[Circular]";
    }
    seen.add(nestedValue);
    if (Array.isArray(nestedValue)) {
      return nestedValue.map(stringify).filter(Boolean).join("\n");
    }
    return Object.entries(nestedValue as Record<string, unknown>)
      .map(([key, entryValue]) => {
        const text = stringify(entryValue);
        return text ? `${key}: ${text}` : key;
      })
      .filter(Boolean)
      .join("\n");
  };

  return stringify(value);
}

export function getContentBlocksText(
  content: string | ContentBlock[],
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if (block.type === "thinking" && typeof block.thinking === "string") {
        return block.thinking;
      }
      if (block.type === "tool_use") {
        return [block.name, block.id, stringifySearchValue(block.input)].join(
          "\n",
        );
      }
      if (block.type === "tool_result") {
        return [
          block.tool_use_id,
          typeof block.content === "string"
            ? block.content
            : stringifySearchValue(block.content),
        ].join("\n");
      }
      return stringifySearchValue(block);
    })
    .filter(Boolean)
    .join("\n");
}

export function joinSearchParts(
  parts: Array<string | null | undefined>,
): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

export function getToolSearchText(item: RenderItem): string {
  if (item.type !== "tool_call") {
    return "";
  }
  return joinSearchParts([
    item.toolName,
    item.id,
    item.status,
    stringifySearchValue(item.toolInput),
    item.toolResult?.isError ? "error" : null,
    item.toolResult?.content,
    stringifySearchValue(item.toolResult?.structured),
  ]);
}

export function getToolSearchPreview(item: ToolCallItem): string {
  const input = stringifySearchValue(item.toolInput).replace(/\s+/g, " ");
  const detail = input ? `: ${getSearchPreviewFallback(input)}` : "";
  return `${item.toolName}${detail}`;
}

export function getSystemSearchText(item: RenderItem): string {
  if (item.type !== "system") {
    return "";
  }
  return joinSearchParts([
    item.content,
    ...(item.details ?? []).map(getContentBlocksText),
  ]);
}

function getUserSearchAnchor(item: UserPromptItem): RenderNavAnchor | null {
  const text = getPromptTextForCorrection(item.content);
  const preview = getSearchPreviewFallback(text);
  if (!preview || isSessionSetupText(preview)) {
    return null;
  }
  return {
    id: item.id,
    preview,
    searchText: text,
    timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
  };
}

export function getUserTurnNavAnchors(
  items: readonly RenderItem[],
): RenderNavAnchor[] {
  const anchors: RenderNavAnchor[] = [];
  for (const item of items) {
    const preview = getSearchableUserTurnPreview(item);
    if (!preview) {
      continue;
    }
    anchors.push({
      id: item.id,
      preview,
      timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
    });
  }
  return anchors;
}

export function getUserTurnSearchAnchors(
  items: readonly RenderItem[],
): RenderNavAnchor[] {
  const anchors: RenderNavAnchor[] = [];
  for (const item of items) {
    if (item.type !== "user_prompt" || item.isSubagent) {
      continue;
    }
    const anchor = getUserSearchAnchor(item);
    if (anchor) {
      anchors.push(anchor);
    }
  }
  return anchors;
}

export function getAllTurnSearchAnchors(
  items: readonly RenderItem[],
): RenderNavAnchor[] {
  const anchors: RenderNavAnchor[] = [];
  for (const item of items) {
    if (item.type === "user_prompt") {
      const anchor = getUserSearchAnchor(item);
      if (anchor) {
        anchors.push(anchor);
      }
      continue;
    }
    if (item.type === "text") {
      const preview = getSearchPreviewFallback(item.text);
      if (preview) {
        anchors.push({
          id: item.id,
          preview,
          searchText: item.text,
          timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
        });
      }
      continue;
    }
    if (item.type === "system") {
      const systemSearchText = getSystemSearchText(item);
      const preview = getSearchPreviewFallback(systemSearchText);
      if (preview) {
        anchors.push({
          id: item.id,
          preview,
          searchText: systemSearchText,
          timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
        });
      }
    }
  }
  return anchors;
}

export function getFullSessionSearchAnchorForItem(
  item: RenderItem,
): RenderNavAnchor | null {
  switch (item.type) {
    case "user_prompt": {
      const text = getPromptTextForCorrection(item.content);
      const preview = getSearchPreviewFallback(text);
      return preview
        ? {
            id: item.id,
            preview,
            searchText: text,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    }
    case "session_setup": {
      const text = joinSearchParts([
        item.title,
        ...item.prompts.map(getContentBlocksText),
      ]);
      return text
        ? {
            id: item.id,
            preview: item.title || getSearchPreviewFallback(text),
            searchText: text,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    }
    case "transcript_display_object": {
      const searchText = joinSearchParts([
        item.object.title,
        item.object.status,
        item.object.error,
      ]);
      return searchText
        ? {
            id: item.id,
            preview:
              item.object.title ??
              getSearchPreviewFallback(item.object.error ?? item.object.status),
            searchText,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    }
    case "text":
      return item.text
        ? {
            id: item.id,
            preview: getSearchPreviewFallback(item.text),
            searchText: item.text,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    case "thinking":
      return item.thinking
        ? {
            id: item.id,
            preview: `Thinking: ${getSearchPreviewFallback(item.thinking)}`,
            searchText: joinSearchParts(["Thinking", item.thinking]),
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    case "system": {
      const systemSearchText = getSystemSearchText(item);
      return systemSearchText
        ? {
            id: item.id,
            preview: getSearchPreviewFallback(systemSearchText),
            searchText: systemSearchText,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    }
    case "task_notification": {
      const searchText = item.summary ?? item.raw;
      return searchText
        ? {
            id: item.id,
            preview: getSearchPreviewFallback(searchText),
            searchText,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    }
    case "tool_call": {
      const searchText = getToolSearchText(item);
      return searchText
        ? {
            id: item.id,
            preview: getToolSearchPreview(item),
            searchText,
            timestampMs: getLatestMessageTimestampMs(item.sourceMessages),
          }
        : null;
    }
  }
}

export function getFullSessionSearchAnchorsForSegment(
  segment: AssistantRenderSegment,
): RenderNavAnchor[] {
  if (segment.kind === "item") {
    const anchor = getFullSessionSearchAnchorForItem(segment.item);
    return anchor ? [anchor] : [];
  }

  const anchors: RenderNavAnchor[] = [
    {
      id: segment.id,
      preview: `Explored: ${segment.items.length} ${
        segment.items.length === 1 ? "item" : "items"
      }`,
      searchText: joinSearchParts([
        "Explored",
        `${segment.items.length} items`,
      ]),
      timestampMs: getLatestRenderItemsTimestampMs(segment.items),
    },
  ];

  for (const item of segment.items) {
    const anchor = getFullSessionSearchAnchorForItem(item);
    if (anchor) {
      const exploredPreview = getExploredEntrySearchPreview(item);
      const exploredSearchText = getExploredEntrySearchText(item);
      anchors.push({
        ...anchor,
        id: `${segment.id}:${item.id}`,
        preview: `Explored / ${exploredPreview || anchor.preview}`,
        searchText: joinSearchParts([exploredSearchText, anchor.searchText]),
        targetId: segment.id,
      });
    }
  }

  return anchors;
}

export function getFullSessionSearchAnchors(
  turnGroups: readonly RenderTurnGroup[],
): RenderNavAnchor[] {
  const anchors: RenderNavAnchor[] = [];
  for (const group of turnGroups) {
    if (group.isUserPrompt) {
      const item = group.items[0];
      const anchor = item ? getFullSessionSearchAnchorForItem(item) : null;
      if (anchor) {
        anchors.push(anchor);
      }
      continue;
    }

    for (const segment of buildAssistantRenderSegments(group.items)) {
      anchors.push(...getFullSessionSearchAnchorsForSegment(segment));
    }
  }
  return anchors;
}
