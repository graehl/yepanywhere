import type { displayFixtures } from "./displayFixtures";

// Each operation has its own oracle. Null means deliberately no presentation,
// not "anything that avoids fallback". Keep these expectations independent of
// schemas and renderer metadata; update them only for an intentional UI change.
export const displayOperationNames = [
  "renderToolUse",
  "renderToolResult",
  "renderCollapsedPreview",
  "renderInteractiveSummary",
  "renderInline",
] as const;
type Operations = readonly [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
];
type Expectations = {
  [K in keyof typeof displayFixtures]: Record<
    keyof (typeof displayFixtures)[K],
    Operations
  >;
};
const text = "Contract text output";
const plain = (
  use: string | null,
  interactive: string | null = null,
): Operations => [use, text, text, interactive, text];
const ordinary = (
  use: string | null,
  result: string,
  preview: string | null = null,
  interactive: string | null = null,
  inline: string | null = null,
): Operations => [use, result, preview, interactive, inline];
export const displayExpectations = {
  Write: {
    file: ordinary(
      "contract.ts",
      "highlighted contract",
      "highlighted contract",
    ),
    acknowledgement: ordinary(
      "contract.ts",
      "File written",
      "contract content",
    ),
  },
  Read: {
    "plain-text": plain("contract.ts", "contract.ts"),
    text: ordinary("contract.ts", "contract content", null, "1 lines"),
    dedup: ordinary("contract.ts", "unchanged", null, "unchanged"),
    image: ordinary("contract.ts", "contract.ts", null, "(image)"),
    pdf: ordinary("contract.ts", "PDF", null, "(PDF)"),
  },
  Edit: {
    "plain-text": plain("Computing diff", "contract.ts"),
    replacement: ordinary(
      "Computing diff",
      "after",
      "after",
      "Modified 2 lines",
    ),
    patch: ordinary(
      "*** Begin Patch",
      "Applied patch",
      "*** Begin Patch",
      "contract.ts",
    ),
    augmented: ordinary("after", "after", "after", "Modified 2 lines"),
    changes: ordinary("Computing diff", "after", "after", "Modified 2 lines"),
    target: ordinary(
      "Computing diff",
      "Applied patch",
      "Patch preview unavailable",
      "contract.ts",
    ),
  },
  Bash: {
    standard: ordinary("printf contract", "contract output", "contract output"),
  },
  Glob: {
    "plain-text": plain("*.ts"),
    standard: ordinary("*.ts", "contract.ts"),
  },
  Grep: {
    "plain-text": plain("contract"),
    files: ordinary("contract", "contract.ts", null, "1 file"),
    content: ordinary(
      "contract",
      "contract match",
      "contract match",
      "1 match",
    ),
    count: ordinary("contract", "1 file matched", null, "1 file"),
  },
  TodoWrite: {
    "plain-text": plain("1 in progress"),
    standard: ordinary("1 in progress", "Verify contracts"),
  },
  Task: {
    "plain-text": plain("Contract agent"),
    standard: ordinary(
      "Contract agent",
      "Contract agent finished",
      null,
      null,
      "completed",
    ),
    asynchronous: ordinary(
      "Background agent",
      "async_launched",
      null,
      null,
      "Background agent",
    ),
  },
  WebSearch: {
    "plain-text": plain("contracts"),
    standard: ordinary("display contracts", "Contract documentation"),
  },
  WebFetch: {
    "plain-text": plain("https://example.com"),
    standard: ordinary("Read contract", "Contract documentation"),
  },
  Web: {
    standard: ordinary(
      "display contracts",
      "Checked values",
      "Contract documentation",
    ),
  },
  AskUserQuestion: {
    "plain-text": plain("Which contract?"),
    standard: ordinary("Which contract?", "Checked"),
  },
  ExitPlanMode: {
    "plain-text": plain(null),
    standard: ordinary(
      null,
      "Verify display contracts",
      null,
      null,
      "Verify display contracts",
    ),
  },
  UpdatePlan: {
    standard: ordinary(
      null,
      "Plan updated",
      null,
      null,
      "Verify display contracts",
    ),
  },
  WriteStdin: {
    standard: ordinary(
      "command session 12",
      "contract output",
      null,
      "contract output",
    ),
  },
  create_goal: {
    standard: ordinary(
      "Verify contracts",
      "Verify contracts",
      "Verify contracts",
    ),
  },
  get_goal: {
    standard: ordinary(
      "Goal details are unavailable",
      "Verify contracts",
      "Verify contracts",
    ),
  },
  update_goal: {
    standard: ordinary("Goal details are unavailable", "Complete", "Complete"),
  },
  ViewImage: {
    standard: ordinary("contract.png", "contract.png", null, "contract.png"),
  },
  spawn_agent: {
    standard: ordinary(
      "Contract agent",
      "contract-child",
      null,
      null,
      "spawned",
    ),
  },
  Exec: { standard: ordinary("printf contract", "contract output") },
  BashOutput: {
    "plain-text": plain("Polling background shell"),
    standard: ordinary("shell-contract", "contract output"),
  },
  TaskOutput: {
    "plain-text": plain("Polling task"),
    standard: ordinary("shell-contract", "contract output"),
  },
  KillShell: {
    "plain-text": plain("Killing shell"),
    standard: ordinary("shell-contract", "Contract shell stopped"),
  },
  Skill: {
    "plain-text": plain("publish"),
    standard: ordinary("publish", "publish"),
  },
  SendMessage: {
    "plain-text": plain("agent-contract"),
    standard: ordinary("Check the contract", "agent-contract"),
  },
  TaskCreate: {
    event: ordinary(
      "Verify contracts",
      "Verify contracts",
      null,
      null,
      "Verify contracts",
    ),
    snapshot: ordinary(
      "Verify contracts",
      "Verify contracts",
      null,
      null,
      "Verify contracts",
    ),
  },
  TaskUpdate: {
    event: ordinary(
      "Task #1",
      "Task #1 in progress",
      null,
      null,
      "Task #1 in progress",
    ),
    snapshot: ordinary(
      "Task #1",
      "Verify contracts",
      null,
      null,
      "Verify contracts",
    ),
  },
} satisfies Expectations;
