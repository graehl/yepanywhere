import type { AppContentBlock } from "@yep-anywhere/shared";

/** Plain text of a turn's content (string or text blocks); for fork-prefill
 *  and the turn-notch copy action. See topics/fork-from-turn.md. */
export function turnContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        (b as { type?: string })?.type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

export function messageContentToPlainText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const value = block as AppContentBlock;
      if (value.type === "text" && typeof value.text === "string") {
        return value.text;
      }
      if (value.type === "thinking" && typeof value.thinking === "string") {
        return value.thinking;
      }
      return typeof value.content === "string" ? value.content : "";
    })
    .filter(Boolean)
    .join("\n");
}
