import type { Message } from "../../types";
import type { RenderItem } from "../../types/renderItems";
import { coalesceCompactBoundaryItems } from "./compactBoundaries";
import {
  type MessageProjectionDiagnostics,
  projectTranscriptMessages,
} from "./messageProjection";
import { collapseSessionSetupRuns } from "./sessionSetup";
import { coalesceSlashCommandSkillBodies } from "./slashCommandBodies";
import {
  annotateBackgroundCommands,
  coalesceDetachedPollContinuations,
  enrichWriteStdinWithCommand,
  hideContextFreeEmptyShellPolls,
} from "./shellFolding";
import type { TranscriptProjectionAugments } from "./types";

/**
 * Compile normalized transcript messages into the current semantic render
 * model without identity caching or web reference stabilization.
 */
export function compileTranscriptProjection(
  messages: Message[],
  augments?: TranscriptProjectionAugments,
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
