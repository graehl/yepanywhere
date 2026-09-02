export const CODEX_PLAN_TOOL_MODES = [
  "provider-default",
  "disabled",
  "enabled",
] as const;

export type CodexPlanToolMode = (typeof CODEX_PLAN_TOOL_MODES)[number];

export function parseCodexPlanToolMode(
  value: string | undefined,
): CodexPlanToolMode {
  if (value === undefined) return "provider-default";
  if (CODEX_PLAN_TOOL_MODES.includes(value as CodexPlanToolMode)) {
    return value as CodexPlanToolMode;
  }
  throw new Error(
    `YEP_CODEX_UPDATE_PLAN must be one of: ${CODEX_PLAN_TOOL_MODES.join(", ")}`,
  );
}
