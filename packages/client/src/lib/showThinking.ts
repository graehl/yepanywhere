import type { ShowThinking } from "@yep-anywhere/shared";

/**
 * Whether a provider returns (summarized) thinking by default — i.e. what the
 * inherited "default" Show-thinking preference currently behaves as. Codex
 * always requests reasoning summaries (`summary: "auto"` in its provider), so
 * its native default shows thinking; Claude/Opus 4.7+ and the rest omit it by
 * default (YA's evidence-grounded baseline; see topics/claude-thinking-config).
 *
 * Used only to render which On/Off state the un-overridden "default" maps to
 * (a minor cue), never to gate behavior. When this guess is wrong for a new
 * provider the fix is one line here.
 */
export function providerDefaultShowsThinking(
  provider?: string | null,
): boolean {
  const p = (provider ?? "").toLowerCase();
  return p === "codex" || p === "codex-oss";
}

/**
 * The concrete On/Off that a Show-thinking preference currently resolves to:
 * explicit "on"/"off" pass through; "default" resolves against the provider.
 */
export function effectiveShowThinking(
  value: ShowThinking,
  provider?: string | null,
): "on" | "off" {
  if (value === "on" || value === "off") return value;
  return providerDefaultShowsThinking(provider) ? "on" : "off";
}
