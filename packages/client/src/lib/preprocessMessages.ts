import type { Message } from "../types";
import type { RenderItem } from "../types/renderItems";
import type { PreprocessAugments } from "./transcriptProjection/types";
import { getCachedWebTranscriptProjection } from "./webTranscriptProjection";

export { compileTranscriptProjection } from "./transcriptProjection/compiler";
export { parseAgentResultFromText } from "./transcriptProjection/agentResults";
export { stripAwaySummaryHintSuffix } from "./transcriptProjection/messageProjection";
export type {
  ActiveToolApproval,
  PreprocessAugments,
} from "./transcriptProjection/types";

/** Compatibility façade for cached web transcript projection. */
export function preprocessMessages(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  return getCachedWebTranscriptProjection(messages, augments);
}
