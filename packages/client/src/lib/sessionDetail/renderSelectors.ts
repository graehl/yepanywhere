import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import type { Message } from "../../types";
import type { RenderItem } from "../../types/renderItems";
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
