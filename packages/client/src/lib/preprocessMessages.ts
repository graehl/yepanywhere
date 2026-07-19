import type { Message } from "../types";
import type { RenderItem } from "../types/renderItems";
import { getCachedTranscriptProjection } from "./transcriptProjection/cache";
import { coalesceCompactBoundaryItems } from "./transcriptProjection/compactBoundaries";
import {
  type MessageProjectionDiagnostics,
  projectTranscriptMessages,
} from "./transcriptProjection/messageProjection";
import { collapseSessionSetupRuns } from "./transcriptProjection/sessionSetup";
import { coalesceSlashCommandSkillBodies } from "./transcriptProjection/slashCommandBodies";
import {
  annotateBackgroundCommands,
  coalesceDetachedPollContinuations,
  enrichWriteStdinWithCommand,
  hideContextFreeEmptyShellPolls,
} from "./transcriptProjection/shellFolding";
import type { PreprocessAugments } from "./transcriptProjection/types";

export {
  parseAgentResultFromText,
  stripAwaySummaryHintSuffix,
} from "./transcriptProjection/messageProjection";
export type {
  ActiveToolApproval,
  PreprocessAugments,
} from "./transcriptProjection/types";

const webProjectionDiagnostics: MessageProjectionDiagnostics = {
  onAssistantMessage(details) {
    console.log("[preprocessMessages] Processing assistant message:", details);
  },
};

/**
 * Preprocess messages into render items, pairing tool_use with tool_result.
 *
 * Results are cached by input identity so a remounted view whose messages
 * array survived in the session-detail cache reuses the previous computation.
 * Message arrays must be replaced on change, and returned items are immutable.
 */
export function preprocessMessages(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  return getCachedTranscriptProjection(
    messages,
    augments,
    compileWebTranscriptProjection,
  );
}

/**
 * Compile normalized transcript messages into the current semantic render
 * model without applying identity caching or web reference stabilization.
 */
export function compileTranscriptProjection(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  return compileTranscriptProjectionWithDiagnostics(messages, augments);
}

function compileWebTranscriptProjection(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  const diagnostics =
    typeof window !== "undefined" && window.__STREAMING_DEBUG__
      ? webProjectionDiagnostics
      : undefined;
  return compileTranscriptProjectionWithDiagnostics(
    messages,
    augments,
    diagnostics,
  );
}

function compileTranscriptProjectionWithDiagnostics(
  messages: Message[],
  augments?: PreprocessAugments,
  diagnostics?: MessageProjectionDiagnostics,
): RenderItem[] {
  const items = projectTranscriptMessages(messages, augments, diagnostics);
  const compactCoalescedItems = coalesceCompactBoundaryItems(items);
  const slashCommandCoalescedItems = coalesceSlashCommandSkillBodies(
    compactCoalescedItems,
  );
  const enrichedItems = enrichWriteStdinWithCommand(slashCommandCoalescedItems);
  const pollCoalescedItems = coalesceDetachedPollContinuations(enrichedItems);
  const backgroundAnnotatedItems =
    annotateBackgroundCommands(pollCoalescedItems);
  const shellPollFilteredItems = hideContextFreeEmptyShellPolls(
    backgroundAnnotatedItems,
  );
  return collapseSessionSetupRuns(shellPollFilteredItems);
}
