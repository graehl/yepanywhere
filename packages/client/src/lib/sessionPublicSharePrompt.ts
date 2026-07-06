import { messageContentToPlainText } from "./sessionMessageText";

export const PUBLIC_SHARE_INITIAL_PROMPT_MAX_LENGTH = 700;

export function normalizePublicShareInitialPrompt(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<environment_context>")
  ) {
    return null;
  }
  const normalized = trimmed.replace(/\s+/g, " ");
  return normalized.length > PUBLIC_SHARE_INITIAL_PROMPT_MAX_LENGTH
    ? `${normalized.slice(0, PUBLIC_SHARE_INITIAL_PROMPT_MAX_LENGTH - 3).trimEnd()}...`
    : normalized;
}

export function getPublicShareInitialPrompt(messages: unknown[]): string | null {
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const entry = message as {
      content?: unknown;
      message?: { content?: unknown };
      type?: unknown;
    };
    if (entry.type !== "user") {
      continue;
    }
    const content =
      messageContentToPlainText(entry.content) ||
      messageContentToPlainText(entry.message?.content);
    const preview = normalizePublicShareInitialPrompt(content);
    if (preview) {
      return preview;
    }
  }
  return null;
}
