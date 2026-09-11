import { BashOutputSchema, normalizeBashResult } from "../../../lib/bashResult";
import { z } from "zod";

// Display requirements are deliberately separate from permissive provider
// schemas: a failed or interrupted call is still a valid transcript record.
export const ReadDisplayInputSchema = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});
export const WriteDisplayInputSchema = z.object({
  file_path: z.string(),
  content: z.string(),
  _highlightedContentHtml: z.string().optional(),
  _highlightedLanguage: z.string().optional(),
  _highlightedTruncated: z.boolean().optional(),
  _renderedMarkdownHtml: z.string().optional(),
});
export const TextFileDisplaySchema = z.object({
  filePath: z.string(),
  content: z.string(),
  numLines: z.number(),
  startLine: z.number(),
  totalLines: z.number(),
});
export const PatchHunkDisplaySchema = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(z.string()),
});
export const QuestionDisplaySchema = z.object({
  id: z.string().optional(),
  question: z.string(),
  header: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      description: z.string(),
      preview: z.string().optional(),
    }),
  ),
  multiSelect: z.boolean(),
  isOther: z.boolean().optional(),
  isSecret: z.boolean().optional(),
});
export const AskUserQuestionDisplayInputSchema = z.object({
  questions: z.array(QuestionDisplaySchema),
});

/** Checked acknowledgement/error text, distinct from a successful file body. */
export const WriteDisplayResultSchema = z.union([
  z.object({ file: TextFileDisplaySchema, content: z.string().optional() }),
  z.string().transform((content) => ({ content, file: undefined })),
  z.object({ content: z.string(), file: z.undefined() }),
]);
export const PlainToolOutputSchema = z.union([
  z.string(),
  // Older Gemini servers advertised this routing envelope as structured data.
  // Keep their content readable without depending on a server-side correction.
  z
    .object({ tool_use_id: z.string(), content: z.string() })
    .transform((value) => value.content),
]);
const string = z.string();
const number = z.number();
const optionalString = string.optional();
const optionalNumber = number.optional();
// Provider acknowledgements are ordered text blocks, not successful file bodies.
const TextResultBlocksSchema = z
  .array(
    z.object({
      type: z.enum(["input_text", "output_text", "text"]),
      text: string,
    }),
  )
  .min(1);
const TextAcknowledgementSchema = TextResultBlocksSchema.transform((blocks) =>
  blocks.map((block) => block.text).join("\n"),
);
const highlight = {
  _highlightedContentHtml: optionalString,
  _highlightedLanguage: optionalString,
  _highlightedTruncated: z.boolean().optional(),
  _renderedMarkdownHtml: optionalString,
};
// Inline bytes are optional: once YA materializes tool-result media, the stored
// result keeps only its metadata and path, and the row re-reads the file.
export const MediaFileDisplaySchema = z.object({
  base64: optionalString,
  filePath: optionalString,
  type: string,
  originalSize: optionalNumber,
  dimensions: z
    .object({
      originalWidth: optionalNumber,
      originalHeight: optionalNumber,
      displayWidth: optionalNumber,
      displayHeight: optionalNumber,
    })
    .optional(),
});
export const PdfFileDisplaySchema = MediaFileDisplaySchema.extend({
  type: string.default("application/pdf"),
});
export const ReadDisplayResultSchema = z.union([
  z.object({
    type: z.enum(["text", "file_unchanged"]).optional(),
    file: z.union([
      TextFileDisplaySchema,
      z.object({
        filePath: string,
        content: z.undefined().optional(),
        numLines: z.undefined().optional(),
      }),
    ]),
    ...highlight,
  }),
  z.object({
    type: z.literal("image"),
    file: MediaFileDisplaySchema,
    ...highlight,
  }),
  z.object({
    type: z.literal("pdf"),
    file: PdfFileDisplaySchema,
    ...highlight,
  }),
]);
const editFields = {
  file_path: optionalString,
  old_string: optionalString,
  new_string: optionalString,
  replace_all: z.boolean().optional(),
  _structuredPatch: z.array(PatchHunkDisplaySchema).optional(),
  _diffHtml: optionalString,
  _rawPatch: optionalString,
  changes: z.array(z.object({ path: string })).optional(),
};
// Alternatives prove a concrete display requirement, then carry a common
// checked projection. Empty all-optional objects are never an Edit variant.
export const EditDisplayInputSchema = z.union([
  z
    .object({
      ...editFields,
      changes: z.array(z.object({ path: string })).min(1),
    })
    .transform((v) => ({ ...v, displayVariant: "changes" as const })),
  z
    .object({
      ...editFields,
      file_path: string,
      old_string: string,
      new_string: string,
    })
    .transform((v) => ({ ...v, displayVariant: "replacement" as const })),
  z
    .object({ ...editFields, _rawPatch: string })
    .transform((v) => ({ ...v, displayVariant: "patch" as const })),
  z
    .object({ ...editFields, rawPatch: string })
    .transform(({ rawPatch, ...v }) => ({
      ...v,
      _rawPatch: rawPatch,
      displayVariant: "patch" as const,
    })),
  z.object({ ...editFields, patch: string }).transform(({ patch, ...v }) => ({
    ...v,
    _rawPatch: patch,
    displayVariant: "patch" as const,
  })),
  string.transform((_rawPatch) => ({
    ...z.object(editFields).parse({}),
    _rawPatch,
    displayVariant: "patch" as const,
  })),
  z
    .object({
      ...editFields,
      _structuredPatch: z.array(PatchHunkDisplaySchema),
    })
    .transform((v) => ({ ...v, displayVariant: "augmented" as const })),
  z
    .object({ ...editFields, file_path: string })
    .transform((v) => ({ ...v, displayVariant: "target" as const })),
]);
const EditResultObjectSchema = z.object({
  filePath: optionalString,
  oldString: optionalString,
  newString: optionalString,
  originalFile: string.nullable().optional(),
  replaceAll: z.boolean().optional(),
  userModified: z.boolean().optional(),
  structuredPatch: z.array(PatchHunkDisplaySchema).optional(),
  content: optionalString,
});
export const EditDisplayResultSchema = z.union([
  EditResultObjectSchema,
  TextAcknowledgementSchema.transform((content) =>
    EditResultObjectSchema.parse({ content }),
  ),
]);
export const EditDisplayFailureSchema = z.union([
  z.string().transform((content) => ({ content })),
  z.object({ content: string }),
]);
export const BashDisplayInputSchema = z
  .object({
    command: optionalString,
    cmd: z.union([string, z.array(string)]).optional(),
    description: optionalString,
    timeout: optionalNumber,
    run_in_background: z.boolean().optional(),
    _backgroundTaskStatus: optionalString,
    _projectPathLinks: z
      .array(z.object({ text: string, filePath: string }))
      .optional(),
    _previewResult: z.union([string, BashOutputSchema]).optional(),
  })
  .refine((v) => v.command !== undefined || v.cmd !== undefined);
export const BashDisplayResultSchema = z.union([
  BashOutputSchema,
  PlainToolOutputSchema.transform((v) => normalizeBashResult(v, false)),
]);
export const BashDisplayFailureSchema = z.union([
  BashOutputSchema,
  z.string().transform((v) => normalizeBashResult(v, true)),
]);
export const GlobDisplayInputSchema = z.object({
  pattern: string,
  path: optionalString,
});
export const GlobDisplayResultSchema = z.object({
  filenames: z.array(string),
  durationMs: number,
  numFiles: number,
  truncated: z.boolean(),
});
export const GrepDisplayInputSchema = z.object({
  pattern: string,
  path: optionalString,
  glob: optionalString,
  output_mode: z.enum(["files_with_matches", "content", "count"]).optional(),
});
export const GrepDisplayResultSchema = z.object({
  mode: z.enum(["files_with_matches", "content", "count"]),
  filenames: z.array(string),
  numFiles: number,
  content: optionalString,
  numLines: optionalNumber,
  appliedLimit: optionalNumber,
  matches: z
    .array(
      z.object({
        filePath: string,
        lineNumber: number,
        text: string,
        columnNumber: optionalNumber,
        ranges: z.array(z.object({ start: number, end: number })).optional(),
      }),
    )
    .optional(),
});
export const TodoDisplaySchema = z.object({
  content: string,
  status: z.enum(["pending", "in_progress", "completed"]),
  activeForm: string,
});
export const TodoWriteDisplayInputSchema = z.object({
  todos: z.array(TodoDisplaySchema),
});
export const TodoWriteDisplayResultSchema = z.object({
  oldTodos: z.array(TodoDisplaySchema),
  newTodos: z.array(TodoDisplaySchema),
});
export const TaskDisplayInputSchema = z.object({
  prompt: string,
  description: optionalString,
  subagent_type: optionalString,
  model: optionalString,
});
export const TaskDisplayResultSchema = z.object({
  status: z.enum(["completed", "failed", "timeout", "async_launched"]),
  prompt: optionalString,
  agentId: optionalString,
  content: z
    .array(
      z
        .object({
          type: string,
          id: optionalString,
          text: optionalString,
          _renderedHtml: optionalString,
          summary: z
            .array(
              z.union([
                string,
                z.object({ type: optionalString, text: optionalString }),
              ]),
            )
            .optional(),
          thinking: optionalString,
          signature: optionalString,
          name: optionalString,
          input: z.json().optional(),
          tool_use_id: optionalString,
          content: optionalString,
          is_error: z.boolean().optional(),
        })
        .superRefine((block, ctx) => {
          const required =
            block.type === "tool_use"
              ? ["name", "id"]
              : block.type === "text"
                ? ["text"]
                : block.type === "tool_result"
                  ? ["tool_use_id"]
                  : [];
          for (const key of required) {
            if (typeof Reflect.get(block, key) !== "string")
              ctx.addIssue({
                code: "custom",
                path: [key],
                message: `Missing ${block.type} ${key}`,
              });
          }
        }),
    )
    .default([]),
  totalDurationMs: number.default(0),
  totalTokens: number.default(0),
  totalToolUseCount: number.default(0),
  isAsync: z.boolean().optional(),
  outputFile: optionalString,
});
export const TaskDisplayFailureSchema = z.union([
  TaskDisplayResultSchema,
  z.union([string, z.object({ content: string })]).transform((value) => ({
    status: "failed" as const,
    content: [
      { type: "text", text: typeof value === "string" ? value : value.content },
    ],
    totalDurationMs: 0,
    totalTokens: 0,
    totalToolUseCount: 0,
  })),
]);
export const WebSearchDisplayInputSchema = z.object({ query: string });
export const WebSearchDisplayResultSchema = z.object({
  query: string,
  results: z.array(
    z.union([
      string,
      z.object({ content: z.array(z.object({ title: string, url: string })) }),
    ]),
  ),
  durationSeconds: optionalNumber,
});
export const WebFetchDisplayInputSchema = z.object({
  url: string,
  prompt: string,
});
export const WebFetchDisplayResultSchema = z.object({
  bytes: number,
  code: number,
  codeText: string,
  result: string,
  durationMs: number,
  url: string,
});
export const AskUserQuestionDisplayResultSchema = z.object({
  questions: z
    .array(
      QuestionDisplaySchema.extend({ multiSelect: z.boolean().optional() }),
    )
    .optional(),
  answers: z.record(string, z.union([string, z.array(string)])).optional(),
});
export const ExitPlanModeDisplayInputSchema = z.object({
  plan: optionalString,
  _renderedHtml: optionalString,
});
export const ExitPlanModeDisplayResultSchema = z.object({
  message: optionalString,
  plan: optionalString,
  isAgent: z.boolean().optional(),
  filePath: optionalString,
  _renderedHtml: optionalString,
});
export const ExitPlanModeDisplayFailureSchema = z.union([
  string.transform((message) => ({ message })),
  z.object({ message: string }),
]);
export const UpdatePlanDisplayInputSchema = z.object({
  explanation: optionalString,
  plan: z.array(z.object({ step: string, status: string })).optional(),
});
export const UpdatePlanDisplayResultSchema = z.union([
  string,
  TextResultBlocksSchema,
  z.object({ message: optionalString }),
]);
export const WriteStdinDisplayInputSchema = z.object({
  session_id: z.union([string, number]).optional(),
  cell_id: z.union([string, number]).optional(),
  cellId: z.union([string, number]).optional(),
  command: optionalString,
  cmd: optionalString,
  chars: optionalString,
  linked_command: optionalString,
  linked_file_path: optionalString,
  linked_tool_name: optionalString,
});
export const WriteStdinDisplayResultSchema = z.union([
  string,
  TextResultBlocksSchema,
  z.object({
    content: optionalString,
    stdout: optionalString,
    output: optionalString,
    exitCode: optionalNumber,
    exit_code: optionalNumber,
    durationSeconds: optionalNumber,
    wall_time_seconds: optionalNumber,
  }),
]);
export const BashOutputDisplayInputSchema = z.object({
  bash_id: string,
  block: z.boolean().optional(),
  wait_up_to: optionalNumber,
});
export const BashOutputDisplayResultSchema = z.object({
  shellId: string,
  command: string,
  status: z.enum(["running", "completed", "failed"]),
  exitCode: number.nullable(),
  stdout: string,
  stderr: string,
  stdoutLines: number,
  stderrLines: number,
  timestamp: string,
});
export const TaskOutputDisplayInputSchema = z.object({
  task_id: string,
  block: z.boolean().optional(),
  timeout: optionalNumber,
});
export const TaskOutputDisplayResultSchema = z.object({
  retrieval_status: z.enum([
    "completed",
    "timeout",
    "running",
    "success",
    "not_ready",
  ]),
  task: z
    .object({
      task_id: optionalString,
      task_type: z.enum(["local_bash", "local_agent", "agent"]).optional(),
      status: z.enum(["running", "completed", "failed"]).optional(),
      description: optionalString,
      output: optionalString,
      exitCode: number.nullable().optional(),
    })
    .optional(),
});
export const KillShellDisplayInputSchema = z.object({ shell_id: string });
export const KillShellDisplayResultSchema = z.object({
  message: string,
  shell_id: string,
});
export const ViewImageDisplayInputSchema = z.object({ path: string });
export const ViewImageDisplayResultSchema = z.union([
  string,
  // The path action consumes no image bytes; stored media is handled separately.
  z
    .array(
      z.union([
        z.object({
          type: z.enum(["input_text", "output_text", "text"]),
          text: string,
        }),
        z.object({
          type: z.literal("input_image"),
          image_url: string,
          detail: optionalString,
        }),
      ]),
    )
    .min(1),
  z.object({}),
  z.null(),
]);
export const SpawnAgentDisplayInputSchema = z.object({
  description: optionalString,
  prompt: optionalString,
  message: optionalString,
  task: optionalString,
  objective: optionalString,
  role: optionalString,
  agent_role: optionalString,
  agent_type: optionalString,
  subagent_type: optionalString,
  model: optionalString,
});
const SpawnAgentObjectSchema = z
  .object({
    agent_id: optionalString,
    agentId: optionalString,
    nickname: optionalString,
  })
  .transform((value) => ({
    ...value,
    agentId: value.agent_id ?? value.agentId,
  }));
export const SpawnAgentDisplayResultSchema = z.union([
  SpawnAgentObjectSchema,
  string
    .transform((value, ctx) => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid agent result JSON" });
        return z.NEVER;
      }
    })
    .pipe(SpawnAgentObjectSchema),
  // A textual rejection has no agent id. Keep it readable and visibly failed.
  string,
]);
const taskSnapshot = z.object({
  version: z.literal(1),
  tasks: z.array(
    z.object({
      id: string,
      subject: string,
      status: string,
      description: optionalString,
      activeForm: optionalString,
      missingCreate: z.boolean().optional(),
    }),
  ),
  currentTaskId: optionalString,
  sourceToolUseId: optionalString,
  unresolvedTaskIds: z.array(string).optional(),
});
export const TaskListDisplayInputSchema = z.object({
  subject: optionalString,
  taskId: optionalString,
  task_id: optionalString,
  id: optionalString,
  status: optionalString,
  _taskSnapshot: taskSnapshot.optional(),
});
export const TaskListDisplayResultSchema = z.union([
  string,
  z.object({ content: optionalString, _taskSnapshot: taskSnapshot.optional() }),
]);
export const GoalDisplayInputSchema = z.object({
  objective: optionalString,
  token_budget: optionalNumber,
  tokenBudget: optionalNumber,
  status: optionalString,
});
const goal = z.object({
  objective: optionalString,
  status: optionalString,
  token_budget: optionalNumber,
  tokenBudget: optionalNumber,
  tokens_used: optionalNumber,
  tokensUsed: optionalNumber,
  time_used_seconds: optionalNumber,
  timeUsedSeconds: optionalNumber,
});
export const GoalDisplayResultSchema = z.union([
  string,
  goal.extend({
    goal: goal.nullable().optional(),
    message: optionalString,
    content: optionalString,
    error: z
      .union([
        string,
        z.object({ message: optionalString, detail: optionalString }),
      ])
      .optional(),
    remainingTokens: number.nullable().optional(),
    remaining_tokens: number.nullable().optional(),
  }),
]);
const webQuery = z.object({
  q: optionalString,
  recency: optionalNumber,
  domains: z.array(string).optional(),
});
const webRef = z.object({
  ref_id: optionalString,
  lineno: number.nullable().optional(),
  pattern: optionalString,
  id: optionalNumber,
});
export const WebDisplayInputSchema = z.object({
  search_query: z.array(webQuery).optional(),
  image_query: z.array(webQuery).optional(),
  open: z.array(webRef).optional(),
  click: z.array(webRef).optional(),
  find: z.array(webRef).optional(),
  response_length: optionalString,
});
export const WebDisplayResultSchema = z.union([
  string,
  z.object({
    pages: z.array(
      z.object({
        ref: optionalString,
        title: string,
        url: optionalString,
        wordLimit: optionalNumber,
        totalLines: optionalNumber,
        contentType: optionalString,
        published: optionalString,
        redirectedUrl: optionalString,
        crawled: optionalString,
        source: optionalString,
        text: optionalString,
        lines: z.array(z.object({ n: number, text: string })).optional(),
      }),
    ),
    durationSeconds: optionalNumber,
    text: optionalString,
  }),
]);
export const ExecDisplayInputSchema = z.object({
  calls: z.array(
    z.object({
      toolName: string,
      input: z.object({ cmd: optionalString }).optional(),
    }),
  ),
  source: string,
});
export const ExecDisplayResultSchema = z.union([
  string,
  z.array(z.object({ type: z.enum(["input_text", "text"]), text: string })),
]);
