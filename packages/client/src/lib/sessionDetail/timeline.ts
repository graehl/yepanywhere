import { getLatestMessageTimestampMs, parseTimestampMs } from "../messageAge";
import type { RenderItem, ToolCallItem } from "../../types/renderItems";
import { buildAssistantRenderSegments } from "./exploration";
import type { ExplorationProjection } from "./explorationProjection";
import {
  getLatestRenderItemsTimestampMs,
  type RenderTurnGroup,
} from "./renderItems";
import { getThinkingDurationMs } from "./thinking";

export interface RenderTimelineAside {
  id: string;
  historyAt?: string | null;
  updatedAt?: string | null;
}

export type RenderTimelineEntry<
  TTurnGroup extends RenderTurnGroup = RenderTurnGroup,
  TAside extends RenderTimelineAside = RenderTimelineAside,
> =
  | {
      kind: "turn";
      key: string;
      timestampMs: number | null;
      ordinal: number;
      group: TTurnGroup;
    }
  | {
      kind: "btw";
      key: string;
      timestampMs: number | null;
      ordinal: number;
      aside: TAside;
    };

export interface VisibleTimelineEntriesInput<
  TTurnGroup extends RenderTurnGroup = RenderTurnGroup,
  TAside extends RenderTimelineAside = RenderTimelineAside,
> {
  asides?: readonly TAside[];
  turnGroups: readonly TTurnGroup[];
}

export type ProgressiveTimelineEntry =
  | { kind: "turn"; group: { items: readonly unknown[] } }
  | { kind: "btw" };

export interface ProgressiveTimelineVisibilityInput<
  TEntry extends ProgressiveTimelineEntry = ProgressiveTimelineEntry,
> {
  entries: readonly TEntry[];
  revealActive: boolean;
  entryCount?: number | null;
  initialEntryCount: number;
}

export interface ProgressiveTimelineVisibility<
  TEntry extends ProgressiveTimelineEntry = ProgressiveTimelineEntry,
> {
  entries: readonly TEntry[];
  effectiveEntryCount: number;
  percent: number;
}

export interface AssistantTimelineRowsInput {
  items: readonly RenderItem[];
  latestVisibleTimestampMs: number | null;
  nowMs: number;
}

export type AssistantTimelineRow =
  | {
      kind: "explored";
      id: string;
      items: ToolCallItem[];
      projection: ExplorationProjection;
      segmentTimestampMs: number | null;
      staleNowMs?: number;
    }
  | {
      kind: "item";
      item: RenderItem;
      itemIndex: number;
      allowsPromptActions: boolean;
      allowsTextQuote: boolean;
      allowsThinkingToggle: boolean;
      staleNowMs?: number;
      thinkingDurationMs?: number;
    };

export interface TimelineEntryDisplayRowsInput<
  TTurnGroup extends RenderTurnGroup = RenderTurnGroup,
  TAside extends RenderTimelineAside = RenderTimelineAside,
> {
  entries: readonly RenderTimelineEntry<TTurnGroup, TAside>[];
  latestCorrectablePromptId?: string | null;
  latestVisibleTimestampMs: number | null;
  nowMs: number;
}

export type TimelineEntryDisplayRow<
  TTurnGroup extends RenderTurnGroup = RenderTurnGroup,
  TAside extends RenderTimelineAside = RenderTimelineAside,
> =
  | {
      kind: "btw";
      key: string;
      aside: TAside;
    }
  | {
      kind: "empty";
      key: string;
      group: TTurnGroup;
    }
  | {
      kind: "standalone";
      key: string;
      group: TTurnGroup;
      item: RenderItem;
    }
  | {
      kind: "user";
      key: string;
      group: TTurnGroup;
      item: RenderItem;
      allowsPromptActions: boolean;
      isLatestCorrectable: boolean;
      staleNowMs?: number;
    }
  | {
      kind: "assistant";
      key: string;
      group: TTurnGroup;
      rows: AssistantTimelineRow[];
    };

export function buildVisibleTimelineEntries<
  TTurnGroup extends RenderTurnGroup = RenderTurnGroup,
  TAside extends RenderTimelineAside = RenderTimelineAside,
>({
  asides = [],
  turnGroups,
}: VisibleTimelineEntriesInput<TTurnGroup, TAside>): Array<
  RenderTimelineEntry<TTurnGroup, TAside>
> {
  const entries: Array<RenderTimelineEntry<TTurnGroup, TAside>> = [];

  turnGroups.forEach((group, index) => {
    const firstItem = group.items[0];
    entries.push({
      kind: "turn",
      key: firstItem ? `turn-${firstItem.id}` : `turn-${index}`,
      timestampMs: getLatestRenderItemsTimestampMs(group.items),
      ordinal: index,
      group,
    });
  });

  asides.forEach((aside, index) => {
    entries.push({
      kind: "btw",
      key: `btw-${aside.id}`,
      timestampMs: parseTimestampMs(aside.historyAt ?? aside.updatedAt),
      ordinal: turnGroups.length + index,
      aside,
    });
  });

  return entries.sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null) {
      return (
        left.timestampMs - right.timestampMs || left.ordinal - right.ordinal
      );
    }
    if (left.timestampMs !== null) return -1;
    if (right.timestampMs !== null) return 1;
    return left.ordinal - right.ordinal;
  });
}

export function getProgressiveTimelineEntryWeight(
  entry: ProgressiveTimelineEntry,
): number {
  return entry.kind === "turn" ? Math.max(1, entry.group.items.length) : 1;
}

export function getTailEntryCountForRenderItemTarget(
  entries: readonly ProgressiveTimelineEntry[],
  targetItems: number,
): number {
  if (entries.length === 0) {
    return 0;
  }

  let count = 0;
  let itemCount = 0;
  for (
    let index = entries.length - 1;
    index >= 0 && itemCount < targetItems;
    index -= 1
  ) {
    const entry = entries[index];
    if (!entry) break;
    count += 1;
    itemCount += getProgressiveTimelineEntryWeight(entry);
  }
  return Math.max(1, count);
}

export function getNextProgressiveEntryCount(
  entries: readonly ProgressiveTimelineEntry[],
  currentCount: number,
  targetItems: number,
): number {
  let count = Math.min(entries.length, Math.max(0, currentCount));
  let itemCount = 0;
  for (
    let index = entries.length - count - 1;
    index >= 0 && itemCount < targetItems;
    index -= 1
  ) {
    const entry = entries[index];
    if (!entry) break;
    count += 1;
    itemCount += getProgressiveTimelineEntryWeight(entry);
  }
  return Math.min(entries.length, Math.max(1, count));
}

export function getProgressiveTimelineVisibility<
  TEntry extends ProgressiveTimelineEntry = ProgressiveTimelineEntry,
>({
  entries,
  entryCount,
  initialEntryCount,
  revealActive,
}: ProgressiveTimelineVisibilityInput<TEntry>): ProgressiveTimelineVisibility<TEntry> {
  if (!revealActive || entries.length === 0) {
    return {
      entries,
      effectiveEntryCount: entries.length,
      percent: 100,
    };
  }

  const effectiveEntryCount = Math.min(
    entries.length,
    entryCount ?? initialEntryCount,
  );
  return {
    entries: entries.slice(-effectiveEntryCount),
    effectiveEntryCount,
    percent: Math.max(
      1,
      Math.min(100, Math.round((effectiveEntryCount / entries.length) * 100)),
    ),
  };
}

export function getRenderItemStaleNowMs(
  item: RenderItem,
  latestVisibleTimestampMs: number | null,
  nowMs: number,
): number | undefined {
  return getLatestMessageTimestampMs(item.sourceMessages) ===
    latestVisibleTimestampMs
    ? nowMs
    : undefined;
}

export function buildAssistantTimelineRows({
  items,
  latestVisibleTimestampMs,
  nowMs,
}: AssistantTimelineRowsInput): AssistantTimelineRow[] {
  return buildAssistantRenderSegments(items).map((segment) => {
    if (segment.kind === "explored") {
      const segmentTimestampMs = getLatestRenderItemsTimestampMs(segment.items);
      return {
        kind: "explored",
        id: segment.id,
        items: segment.items,
        projection: segment.projection,
        segmentTimestampMs,
        staleNowMs:
          segmentTimestampMs === latestVisibleTimestampMs ? nowMs : undefined,
      };
    }

    const itemIndex = items.indexOf(segment.item);
    return {
      kind: "item",
      item: segment.item,
      itemIndex,
      allowsPromptActions:
        segment.item.type === "user_prompt" && !segment.item.isSubagent,
      allowsTextQuote: segment.item.type === "text",
      allowsThinkingToggle: segment.item.type === "thinking",
      staleNowMs: getRenderItemStaleNowMs(
        segment.item,
        latestVisibleTimestampMs,
        nowMs,
      ),
      thinkingDurationMs:
        itemIndex >= 0
          ? getThinkingDurationMs(segment.item, items, itemIndex, nowMs)
          : undefined,
    };
  });
}

export function buildTimelineEntryDisplayRows<
  TTurnGroup extends RenderTurnGroup = RenderTurnGroup,
  TAside extends RenderTimelineAside = RenderTimelineAside,
>({
  entries,
  latestCorrectablePromptId,
  latestVisibleTimestampMs,
  nowMs,
}: TimelineEntryDisplayRowsInput<TTurnGroup, TAside>): Array<
  TimelineEntryDisplayRow<TTurnGroup, TAside>
> {
  return entries.map((entry) => {
    if (entry.kind === "btw") {
      return {
        kind: "btw",
        key: entry.key,
        aside: entry.aside,
      };
    }

    const { group } = entry;
    const firstItem = group.items[0];
    if (!firstItem) {
      return {
        kind: "empty",
        key: entry.key,
        group,
      };
    }

    if (group.isStandalone) {
      return {
        kind: "standalone",
        key: firstItem.id,
        group,
        item: firstItem,
      };
    }

    if (group.isUserPrompt) {
      return {
        kind: "user",
        key: firstItem.id,
        group,
        item: firstItem,
        allowsPromptActions: !firstItem.isSubagent,
        isLatestCorrectable: latestCorrectablePromptId === firstItem.id,
        staleNowMs: getRenderItemStaleNowMs(
          firstItem,
          latestVisibleTimestampMs,
          nowMs,
        ),
      };
    }

    return {
      kind: "assistant",
      key: entry.key,
      group,
      rows: buildAssistantTimelineRows({
        items: group.items,
        latestVisibleTimestampMs,
        nowMs,
      }),
    };
  });
}
