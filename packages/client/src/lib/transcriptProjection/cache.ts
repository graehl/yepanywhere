import type { Message } from "../../types";
import type { RenderItem } from "../../types/renderItems";
import type { PreprocessAugments } from "./types";

export type TranscriptProjectionCompiler = (
  messages: Message[],
  augments?: PreprocessAugments,
) => RenderItem[];

interface TranscriptProjectionCacheEntry {
  activeToolApproval: boolean | undefined;
  items: RenderItem[];
  markdown: PreprocessAugments["markdown"];
}

const resultCache = new WeakMap<Message[], TranscriptProjectionCacheEntry[]>();
const CACHE_VARIANTS_PER_MESSAGE_ARRAY = 3;

/**
 * Cache semantic compilation by the identities of the message array and its
 * augment inputs. The compiler remains an explicit dependency so this module
 * does not import the legacy compatibility façade.
 */
export function getCachedTranscriptProjection(
  messages: Message[],
  augments: PreprocessAugments | undefined,
  compile: TranscriptProjectionCompiler,
): RenderItem[] {
  const markdown = augments?.markdown;
  const activeToolApproval = augments?.activeToolApproval;
  const cachedVariants = resultCache.get(messages);
  const cached = cachedVariants?.find(
    (entry) =>
      entry.markdown === markdown &&
      entry.activeToolApproval === activeToolApproval,
  );
  if (cached) {
    return cached.items;
  }

  const items = compile(messages, augments);
  const variants = cachedVariants ?? [];
  variants.push({ markdown, activeToolApproval, items });
  if (variants.length > CACHE_VARIANTS_PER_MESSAGE_ARRAY) {
    variants.shift();
  }
  resultCache.set(messages, variants);
  return items;
}
