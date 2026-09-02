export const CODEX_PLAN_TOOL_MODES = [
  "provider-default",
  "disabled",
  "enabled",
] as const;

export type CodexPlanToolMode = (typeof CODEX_PLAN_TOOL_MODES)[number];

export function isCodexPlanToolMode(
  value: unknown,
): value is CodexPlanToolMode {
  return CODEX_PLAN_TOOL_MODES.some((mode) => mode === value);
}
