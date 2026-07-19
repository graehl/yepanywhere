import type { Message } from "../types";
import type { RenderItem } from "../types/renderItems";
import { getCachedTranscriptProjection } from "./transcriptProjection/cache";
import { compileTranscriptProjection } from "./transcriptProjection/compiler";
import type { MessageProjectionDiagnostics } from "./transcriptProjection/messageProjection";
import type { PreprocessAugments } from "./transcriptProjection/types";

const webProjectionDiagnostics: MessageProjectionDiagnostics = {
  onAssistantMessage(details) {
    console.log("[preprocessMessages] Processing assistant message:", details);
  },
};

export function compileWebTranscriptProjection(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  const diagnostics =
    typeof window !== "undefined" && window.__STREAMING_DEBUG__
      ? webProjectionDiagnostics
      : undefined;
  return compileTranscriptProjection(messages, augments, diagnostics);
}

export function getCachedWebTranscriptProjection(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  return getCachedTranscriptProjection(
    messages,
    augments,
    compileWebTranscriptProjection,
  );
}
