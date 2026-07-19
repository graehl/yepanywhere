import type { MarkdownAugment } from "@yep-anywhere/shared";

/**
 * When true, the session has active tool work or approval. Orphaned tools in
 * the current trailing user turn are treated as pending.
 */
export type ActiveToolApproval = boolean;

/** Inputs that accompany normalized messages during semantic projection. */
export interface TranscriptProjectionAugments {
  /** Pre-rendered markdown HTML keyed by message ID. */
  markdown?: Record<string, MarkdownAugment>;
  /** Matching tool_use rows remain pending while approval is active. */
  activeToolApproval?: ActiveToolApproval;
}
