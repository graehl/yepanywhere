const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;

export interface CommandTurn {
  /** The slash command, e.g. "/harsh-review". */
  command: string;
  /** Trailing arguments, or "" when the command took none. */
  args: string;
}

/**
 * A slash-command user turn arrives wrapped by Claude Code as
 * `<command-name>/foo</command-name><command-message>…</command-message>
 * <command-args>…</command-args>`. Extract the command and any args so a
 * display surface can render the command itself instead of the raw tags;
 * returns null for an ordinary prose turn (render that verbatim).
 */
export function parseCommandTurn(text: string): CommandTurn | null {
  const command = text.match(COMMAND_NAME_RE)?.[1]?.trim();
  if (!command) return null;
  const args = text.match(COMMAND_ARGS_RE)?.[1]?.trim() ?? "";
  return { command, args };
}
