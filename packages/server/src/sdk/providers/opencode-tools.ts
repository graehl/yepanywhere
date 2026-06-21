/**
 * Normalize OpenCode tool calls to YA's canonical tool renderer contract.
 *
 * OpenCode names tools in lower case (`bash`, `read`, `edit`, …) and uses its
 * own input field names (`filePath`, `oldString`, …). YA's rich tool renderers
 * key on canonical names (`Bash`, `Read`, `Edit`, …) and Claude-style field
 * names (`file_path`, `old_string`, …). This module maps both so OpenCode tool
 * calls reach the rich renderers instead of the raw-JSON fallback.
 *
 * Used by both the live provider (opencode.ts) and the durable reader path
 * (normalization.ts) so live streaming and reloaded history agree.
 *
 * Tools without a mapping keep their original name and input untouched — an
 * unknown OpenCode tool stays explicit (raw fallback) rather than being forced
 * into a misleading alias. See topics/opencode-backend.md "Gaps To Close" #3.
 */

export interface NormalizedOpenCodeTool {
  /** Canonical YA renderer tool name (e.g. "Bash"), or the original name. */
  name: string;
  /** Input with field names mapped to the YA renderer's expectations. */
  input: Record<string, unknown>;
}

/** OpenCode lower-case tool name -> YA canonical renderer name. */
const OPENCODE_TOOL_NAME_MAP: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  glob: "Glob",
  grep: "Grep",
  todowrite: "TodoWrite",
  task: "Task",
  webfetch: "WebFetch",
  question: "AskUserQuestion",
};

/** Per-tool input field renames (OpenCode field -> YA/Claude field). */
const OPENCODE_TOOL_FIELD_RENAMES: Record<string, Record<string, string>> = {
  read: { filePath: "file_path" },
  write: { filePath: "file_path" },
  edit: {
    filePath: "file_path",
    oldString: "old_string",
    newString: "new_string",
    replaceAll: "replace_all",
  },
  grep: { include: "glob" },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function renameFields(
  input: Record<string, unknown>,
  renames: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[renames[key] ?? key] = value;
  }
  return out;
}

/**
 * Map an OpenCode tool name + raw input to YA's canonical name + input.
 */
export function normalizeOpenCodeTool(
  toolName: string | undefined,
  rawInput: unknown,
): NormalizedOpenCodeTool {
  const lower = (toolName ?? "").toLowerCase();
  const name = OPENCODE_TOOL_NAME_MAP[lower] ?? toolName ?? "unknown";
  const input = asRecord(rawInput);
  const renames = OPENCODE_TOOL_FIELD_RENAMES[lower];
  return { name, input: renames ? renameFields(input, renames) : input };
}

/**
 * Map YA's AskUserQuestion answers (a Record keyed by question text, each value
 * a label or list of labels) into OpenCode's ordered reply shape for
 * POST /question/{id}/reply: one array of selected option labels per question,
 * in the original question order. A question with no answer becomes [].
 */
export function mapOpenCodeQuestionAnswers(
  questions: ReadonlyArray<{ question: string }>,
  answers: Record<string, string | string[]> | undefined,
): string[][] {
  return questions.map((q) => {
    const value = answers?.[q.question];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  });
}
