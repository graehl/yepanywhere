export interface ParsedShellToolOutput {
  output: string;
  exitCode?: number;
  wallTime?: string;
  hasEnvelope: boolean;
}

function extractExitCode(text: string): number | undefined {
  const match = text.match(
    /(?:^|\n)\s*(?:Process exited with code|Exit code:)\s*(-?\d+)\b/i,
  );
  if (!match?.[1]) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

function extractWallTime(text: string): string | undefined {
  // Codex emits both "Wall time: 0.05 seconds" and "Wall time 30.0 seconds".
  const match = text.match(/(?:^|\n)\s*Wall time:?\s+([^\n]+)\s*(?:\n|$)/i);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim();
}

export function parseShellToolOutput(text: string): ParsedShellToolOutput {
  const outputMatch = text.match(/(?:^|\n)\s*Output:\s*\n([\s\S]*)$/i);
  const hasEnvelope = !!outputMatch;
  const output = (outputMatch?.[1] ?? text).trimEnd();

  return {
    output,
    exitCode: extractExitCode(text),
    wallTime: extractWallTime(text),
    hasEnvelope,
  };
}

/**
 * Normalized command-execution metadata carried on structured tool results
 * (spec: topics/provider-output-contract.md § Command execution metadata).
 */
export interface CommandResultMeta {
  exitCode?: number;
  durationSeconds?: number;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Read command metadata from a structured tool result, accepting both the
 * normalized fields (exitCode, durationSeconds) and raw provider fields a
 * normalization pass-through retains (exit_code, wall_time_seconds).
 */
export function getCommandResultMeta(structured: unknown): CommandResultMeta {
  if (!structured || typeof structured !== "object") {
    return {};
  }
  const record = structured as Record<string, unknown>;
  const exitCode = finiteNumber(record.exitCode ?? record.exit_code);
  const durationSeconds = finiteNumber(
    record.durationSeconds ?? record.wall_time_seconds,
  );
  return {
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

/** Compact human duration: "0.3s", "12.5s", "2m14s", "1h5m". */
export function formatCommandDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${rounded}s`;
  }
  if (seconds < 60 * 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds - minutes * 60);
    if (remainder >= 60) {
      return `${minutes + 1}m`;
    }
    return remainder > 0 ? `${minutes}m${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / (60 * 60));
  const minutes = Math.round((seconds - hours * 60 * 60) / 60);
  if (minutes >= 60) {
    return `${hours + 1}h`;
  }
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}
