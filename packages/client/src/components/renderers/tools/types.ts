import type { z } from "zod";
import type * as schemas from "./displayContracts";
export type BashInput = z.output<typeof schemas.BashDisplayInputSchema>;
export type BashResult = z.output<typeof schemas.BashDisplayResultSchema>;
export type ReadInput = z.output<typeof schemas.ReadDisplayInputSchema>;
export type ReadResult = z.output<typeof schemas.ReadDisplayResultSchema>;
export type EditInput = z.output<typeof schemas.EditDisplayInputSchema>;
export type EditResult = z.output<typeof schemas.EditDisplayResultSchema>;
export type WriteInput = z.output<typeof schemas.WriteDisplayInputSchema>;
export type WriteResult = z.output<typeof schemas.WriteDisplayResultSchema>;
export type TodoWriteInput = z.output<
  typeof schemas.TodoWriteDisplayInputSchema
>;
export type TodoWriteResult = z.output<
  typeof schemas.TodoWriteDisplayResultSchema
>;
export type GlobInput = z.output<typeof schemas.GlobDisplayInputSchema>;
export type GlobResult = z.output<typeof schemas.GlobDisplayResultSchema>;
export type GrepInput = z.output<typeof schemas.GrepDisplayInputSchema>;
export type GrepResult = z.output<typeof schemas.GrepDisplayResultSchema>;
export type TaskInput = z.output<typeof schemas.TaskDisplayInputSchema>;
export type TaskResult = z.output<typeof schemas.TaskDisplayResultSchema>;
export type WebSearchInput = z.output<
  typeof schemas.WebSearchDisplayInputSchema
>;
export type WebSearchResult = z.output<
  typeof schemas.WebSearchDisplayResultSchema
>;
export type WebFetchInput = z.output<typeof schemas.WebFetchDisplayInputSchema>;
export type WebFetchResult = z.output<
  typeof schemas.WebFetchDisplayResultSchema
>;
export type AskUserQuestionInput = z.output<
  typeof schemas.AskUserQuestionDisplayInputSchema
>;
export type AskUserQuestionResult = z.output<
  typeof schemas.AskUserQuestionDisplayResultSchema
>;
export type ExitPlanModeInput = z.output<
  typeof schemas.ExitPlanModeDisplayInputSchema
>;
export type ExitPlanModeResult = z.output<
  typeof schemas.ExitPlanModeDisplayResultSchema
>;
export type UpdatePlanInput = z.output<
  typeof schemas.UpdatePlanDisplayInputSchema
>;
export type UpdatePlanResult = z.output<
  typeof schemas.UpdatePlanDisplayResultSchema
>;
export type WriteStdinInput = z.output<
  typeof schemas.WriteStdinDisplayInputSchema
>;
export type WriteStdinResult = z.output<
  typeof schemas.WriteStdinDisplayResultSchema
>;
export type BashOutputInput = z.output<
  typeof schemas.BashOutputDisplayInputSchema
>;
export type BashOutputResult = z.output<
  typeof schemas.BashOutputDisplayResultSchema
>;
export type TaskOutputInput = z.output<
  typeof schemas.TaskOutputDisplayInputSchema
>;
export type TaskOutputResult = z.output<
  typeof schemas.TaskOutputDisplayResultSchema
>;
export type KillShellInput = z.output<
  typeof schemas.KillShellDisplayInputSchema
>;
export type KillShellResult = z.output<
  typeof schemas.KillShellDisplayResultSchema
>;
export type SkillInput = z.output<typeof schemas.SkillDisplayInputSchema>;
export type SkillResult = z.output<typeof schemas.SkillDisplayResultSchema>;
export type SendMessageInput = z.output<
  typeof schemas.SendMessageDisplayInputSchema
>;
export type SendMessageResult = z.output<
  typeof schemas.SendMessageDisplayResultSchema
>;
export type TextFile = z.output<typeof schemas.TextFileDisplaySchema>;
export type ImageFile = z.output<typeof schemas.MediaFileDisplaySchema>;
export type PdfFile = z.output<typeof schemas.PdfFileDisplaySchema>;
export type PatchHunk = z.output<typeof schemas.PatchHunkDisplaySchema>;
export type Question = z.output<typeof schemas.QuestionDisplaySchema>;
export type Todo = z.output<typeof schemas.TodoDisplaySchema>;
export type UpdatePlanStep = NonNullable<UpdatePlanInput["plan"]>[number];
export type GrepMatch = NonNullable<GrepResult["matches"]>[number];
export type GrepMatchRange = NonNullable<GrepMatch["ranges"]>[number];
export interface ToolSummaryContext {
  projectPath?: string | null;
}
