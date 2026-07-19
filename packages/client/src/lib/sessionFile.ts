export interface SessionFileEvent {
  relativePath: string;
  provider?: "claude" | "gemini" | "codex";
}

export function extractSessionIdFromFileEvent(
  event: SessionFileEvent,
): string | null {
  const filename = event.relativePath.split(/[\\/]/).pop();
  if (!filename) return null;

  let base = filename;
  if (base.endsWith(".jsonl")) {
    base = base.slice(0, -6);
  } else if (base.endsWith(".json")) {
    base = base.slice(0, -5);
  }

  if (event.provider === "codex") {
    const match = base.match(/([0-9a-fA-F-]{36})$/);
    if (match) return match[1] ?? null;
  }

  return base;
}

/**
 * Current Claude child transcripts live below
 * `{parentSessionId}/subagents/agent-*.{jsonl,meta.json}`. Recover the
 * canonical YA parent session without treating the provider child ID as a YA
 * session ID.
 */
export function extractParentSessionIdFromAgentFileEvent(
  event: SessionFileEvent,
): string | null {
  if (event.provider !== "claude") return null;

  const parts = event.relativePath.split(/[\\/]/);
  const subagentsIndex = parts.lastIndexOf("subagents");
  if (subagentsIndex <= 1) return null;

  return parts[subagentsIndex - 1] || null;
}
