import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import { getLatestMessageTimestampMs } from "../messageAge";
import { parseUserPrompt } from "../parseUserPrompt";
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
