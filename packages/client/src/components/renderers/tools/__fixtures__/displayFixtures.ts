import type { z } from "zod";
import type { toolDisplayContracts } from "../toolDisplayContracts";

type Contracts = typeof toolDisplayContracts;
export type Fixture<K extends keyof Contracts> = {
  input: z.input<Contracts[K]["input"]>;
  result:
    | z.input<Contracts[K]["result"]>
    | (Contracts[K] extends { partialResult: infer P extends z.ZodType }
        ? z.input<P>
        : never);
  text: string;
  provenance: string;
};
export type DisplayFixtureManifest = {
  [K in keyof Contracts]: Record<Contracts[K]["variants"][number], Fixture<K>>;
};
const claude =
  "Synthetic minimal Claude SDK 0.3.258/native JSONL shape; values are invented. Native adapter pairs are tested separately.";
const codex =
  "Synthetic minimal Codex 0.154.0 normalized shape; values are invented. Native adapter pairs are tested separately.";
const augment =
  "Synthetic YA augmentation; this display-only fact is not emitted by a provider.";
const file = {
  filePath: "/tmp/contract.ts",
  content: "contract content",
  numLines: 1,
  startLine: 1,
  totalLines: 1,
};
const read = { file_path: file.filePath };
const write = { ...read, content: file.content };
const hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: ["-before", "+after"],
};
const replacement = { ...read, old_string: "before", new_string: "after" };
const patch =
  "*** Begin Patch\n*** Update File: /tmp/contract.ts\n@@\n-before\n+after\n*** End Patch";
const editResult = {
  filePath: file.filePath,
  oldString: "before",
  newString: "after",
  structuredPatch: [hunk],
};
const todos = [
  {
    content: "Verify contracts",
    status: "in_progress" as const,
    activeForm: "Verifying contracts",
  },
];
const snapshot = {
  version: 1 as const,
  tasks: [{ id: "1", subject: "Verify contracts", status: "in_progress" }],
};
const question = {
  question: "Which contract?",
  header: "Contract",
  options: [{ label: "Checked", description: "Use checked values" }],
  multiSelect: false,
};
const grep = {
  mode: "files_with_matches" as const,
  filenames: ["contract.ts"],
  numFiles: 1,
};
const goal = {
  objective: "Verify contracts",
  status: "active",
  tokenBudget: 1000,
  tokensUsed: 20,
};

/** Independent semantic controls. A new registration/variant requires an entry;
 * values are not generated from the schemas whose requirements they test. */
export const displayFixtures = {
  Write: {
    file: {
      input: {
        ...write,
        _highlightedContentHtml:
          '<pre><code><span class="line">highlighted contract</span></code></pre>',
      },
      result: { file },
      text: "highlighted contract",
      provenance: augment,
    },
    acknowledgement: {
      input: write,
      result: "File written",
      text: "contract content",
      provenance: claude,
    },
  },
  Read: {
    "plain-text": {
      input: read,
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    text: {
      input: read,
      result: { type: "text", file },
      text: "contract content",
      provenance: claude,
    },
    dedup: {
      input: read,
      result: { type: "text", file: { filePath: file.filePath } },
      text: "unchanged",
      provenance: claude,
    },
    image: {
      input: read,
      result: {
        type: "image",
        file: { base64: "aW1hZ2U=", type: "image/png" },
      },
      text: "image",
      provenance: claude,
    },
    pdf: {
      input: read,
      result: {
        type: "pdf",
        file: { filePath: file.filePath, base64: "cGRm", originalSize: 3 },
      },
      text: "PDF",
      provenance: claude,
    },
  },
  Edit: {
    "plain-text": {
      input: replacement,
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    replacement: {
      input: replacement,
      result: editResult,
      text: "after",
      provenance: claude,
    },
    patch: {
      input: { _rawPatch: patch },
      result: { content: "Applied patch" },
      text: "after",
      provenance: codex,
    },
    augmented: {
      input: { _structuredPatch: [hunk] },
      result: editResult,
      text: "after",
      provenance: augment,
    },
    changes: {
      input: { changes: [{ path: file.filePath }] },
      result: editResult,
      text: "contract.ts",
      provenance: codex,
    },
    target: {
      input: read,
      result: { content: "Applied patch" },
      text: "Patch preview unavailable",
      provenance:
        "Synthetic partial target-only Edit; no native complete replacement is claimed.",
    },
  },
  Bash: {
    standard: {
      input: { command: "printf contract" },
      result: {
        stdout: "contract output",
        stderr: "",
        interrupted: false,
        isImage: false,
      },
      text: "contract output",
      provenance: claude,
    },
  },
  Glob: {
    "plain-text": {
      input: { pattern: "*.ts" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { pattern: "*.ts" },
      result: {
        filenames: ["contract.ts"],
        numFiles: 1,
        durationMs: 1,
        truncated: false,
      },
      text: "contract.ts",
      provenance: claude,
    },
  },
  Grep: {
    "plain-text": {
      input: { pattern: "contract" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    files: {
      input: { pattern: "contract" },
      result: grep,
      text: "contract.ts",
      provenance: claude,
    },
    content: {
      input: { pattern: "contract", output_mode: "content" },
      result: {
        ...grep,
        mode: "content",
        content: "contract.ts:1:contract match",
        numLines: 1,
        matches: [
          {
            filePath: "contract.ts",
            lineNumber: 1,
            text: "contract match",
            ranges: [{ start: 0, end: 8 }],
          },
        ],
      },
      text: "contract match",
      provenance: claude,
    },
    count: {
      input: { pattern: "contract", output_mode: "count" },
      result: { ...grep, mode: "count", content: "contract.ts:1" },
      text: "1 file matched",
      provenance: claude,
    },
  },
  TodoWrite: {
    "plain-text": {
      input: { todos },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { todos },
      result: { oldTodos: [], newTodos: todos },
      text: "Verify contracts",
      provenance: claude,
    },
  },
  Task: {
    asynchronous: {
      input: { prompt: "Inspect contracts", description: "Background agent" },
      result: {
        status: "async_launched",
        isAsync: true,
        agentId: "contract-child",
        outputFile: "/tmp/agent.output",
      },
      text: "Background agent",
      provenance: claude,
    },
    "plain-text": {
      input: { prompt: "Inspect contracts", description: "Contract agent" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: {
        prompt: "Inspect contracts",
        description: "Contract agent",
        subagent_type: "Explore",
      },
      result: {
        status: "completed",
        prompt: "Inspect contracts",
        agentId: "contract-child",
        content: [{ type: "text", text: "Contract agent finished" }],
        totalDurationMs: 1,
        totalTokens: 10,
        totalToolUseCount: 1,
      },
      text: "Contract agent",
      provenance: claude,
    },
  },
  WebSearch: {
    "plain-text": {
      input: { query: "contracts" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { query: "display contracts" },
      result: {
        query: "display contracts",
        results: [
          {
            content: [
              {
                title: "Contract documentation",
                url: "https://example.com/contract",
              },
            ],
          },
        ],
        durationSeconds: 1,
      },
      text: "Contract documentation",
      provenance: claude,
    },
  },
  WebFetch: {
    "plain-text": {
      input: { url: "https://example.com", prompt: "Read" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { url: "https://example.com/contract", prompt: "Read contract" },
      result: {
        bytes: 20,
        code: 200,
        codeText: "OK",
        result: "Contract documentation",
        durationMs: 1,
        url: "https://example.com/contract",
      },
      text: "Contract documentation",
      provenance: claude,
    },
  },
  Web: {
    standard: {
      input: { search_query: [{ q: "display contracts" }] },
      result: {
        pages: [
          {
            title: "Contract documentation",
            url: "https://example.com/contract",
            lines: [{ n: 1, text: "Checked values" }],
          },
        ],
        durationSeconds: 1,
      },
      text: "Checked values",
      provenance: codex,
    },
  },
  AskUserQuestion: {
    "plain-text": {
      input: { questions: [question] },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain text answer acknowledgement without structured answer metadata.",
    },
    standard: {
      input: { questions: [question] },
      result: {
        questions: [question],
        answers: { "Which contract?": "Checked" },
      },
      text: "Which contract?",
      provenance: claude,
    },
  },
  ExitPlanMode: {
    "plain-text": {
      input: { plan: "Verify contracts" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { plan: "Verify display contracts" },
      result: { plan: "Verify display contracts" },
      text: "Verify display contracts",
      provenance: claude,
    },
  },
  UpdatePlan: {
    standard: {
      input: {
        plan: [{ step: "Verify display contracts", status: "in_progress" }],
      },
      result: "Plan updated",
      text: "Verify display contracts",
      provenance: codex,
    },
  },
  WriteStdin: {
    standard: {
      input: { session_id: 12, chars: "" },
      result: "contract output",
      text: "contract output",
      provenance: codex,
    },
  },
  create_goal: {
    standard: {
      input: { objective: goal.objective, token_budget: 1000 },
      result: { goal },
      text: "Verify contracts",
      provenance: codex,
    },
  },
  get_goal: {
    standard: {
      input: {},
      result: { goal },
      text: "Verify contracts",
      provenance: codex,
    },
  },
  update_goal: {
    standard: {
      input: { status: "complete" },
      result: { goal: { ...goal, status: "complete" } },
      text: "Verify contracts",
      provenance: codex,
    },
  },
  ViewImage: {
    standard: {
      input: { path: "/tmp/contract.png" },
      result: null,
      text: "contract.png",
      provenance: codex,
    },
  },
  spawn_agent: {
    standard: {
      input: { message: "Inspect contracts", description: "Contract agent" },
      result: { agent_id: "contract-child" },
      text: "Contract agent",
      provenance: codex,
    },
  },
  Exec: {
    standard: {
      input: {
        source: "text(await tools.exec_command({cmd:'printf contract'}))",
        calls: [
          { toolName: "exec_command", input: { cmd: "printf contract" } },
        ],
      },
      result: [
        {
          type: "input_text",
          text: '{"output":"contract output","exit_code":0,"wall_time_seconds":0.1}',
        },
      ],
      text: "contract output",
      provenance: codex,
    },
  },
  BashOutput: {
    "plain-text": {
      input: { bash_id: "shell" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { bash_id: "shell-contract" },
      result: {
        shellId: "shell-contract",
        command: "printf contract",
        status: "completed",
        exitCode: 0,
        stdout: "contract output",
        stderr: "",
        stdoutLines: 1,
        stderrLines: 0,
        timestamp: "2026-09-10T00:00:00Z",
      },
      text: "contract output",
      provenance: claude,
    },
  },
  TaskOutput: {
    "plain-text": {
      input: { task_id: "task" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { task_id: "shell-contract" },
      result: {
        retrieval_status: "completed",
        task: {
          task_id: "shell-contract",
          task_type: "local_bash",
          status: "completed",
          description: "Contract shell",
          output: "contract output",
          exitCode: 0,
        },
      },
      text: "contract output",
      provenance: claude,
    },
  },
  KillShell: {
    "plain-text": {
      input: { shell_id: "shell" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { shell_id: "shell-contract" },
      result: { message: "Contract shell stopped", shell_id: "shell-contract" },
      text: "Contract shell stopped",
      provenance: claude,
    },
  },
  Skill: {
    "plain-text": {
      input: { skill: "publish" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: { skill: "publish", args: "push origin and graehl" },
      result: { success: true, commandName: "publish" },
      text: "publish",
      provenance: claude,
    },
  },
  SendMessage: {
    "plain-text": {
      input: { to: "agent-contract", message: "Contract message" },
      result: "Contract text output",
      text: "Contract text output",
      provenance:
        "Synthetic plain-text provider output; metadata unavailable, checked input remains usable.",
    },
    standard: {
      input: {
        to: "agent-contract",
        summary: "Check the contract",
        message: "Contract message",
      },
      result: {
        success: true,
        message: "Resuming agent agent-c",
        resumedAgentId: "agent-contract",
      },
      text: "agent-contract",
      provenance: claude,
    },
  },
  TaskCreate: {
    event: {
      input: { subject: "Verify contracts" },
      result: "Task created",
      text: "Verify contracts",
      provenance: claude,
    },
    snapshot: {
      input: { subject: "Verify contracts", _taskSnapshot: snapshot },
      result: { _taskSnapshot: snapshot },
      text: "Verify contracts",
      provenance: augment,
    },
  },
  TaskUpdate: {
    event: {
      input: { taskId: "1", status: "in_progress" },
      result: "Task updated",
      text: "Task #1 in progress",
      provenance: claude,
    },
    snapshot: {
      input: { taskId: "1", _taskSnapshot: snapshot },
      result: { _taskSnapshot: snapshot },
      text: "Verify contracts",
      provenance: augment,
    },
  },
} satisfies DisplayFixtureManifest;
