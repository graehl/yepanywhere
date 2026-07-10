import { posix, win32 } from "node:path";
import type { ToolDisplayAction } from "@yep-anywhere/shared";

/**
 * Rollout-recoverable semantic actions for Codex command presentation.
 *
 * The app-server's `commandActions` are richer live evidence, but rollout
 * replay does not persist them for GPT-5.6 code-mode calls. Keep rendering
 * decisions based on this conservative command analysis so live and reload
 * can converge; use provider actions as an oracle in tests and diagnostics.
 *
 * Spec: topics/codex-code-mode-render-convergence.md
 */

export interface CodexReadShellInfo {
  filePath: string;
  startLine?: number;
  endLine?: number;
  stripLineNumbers: boolean;
}

export interface CodexReadDisplayAction extends CodexReadShellInfo {
  absolutePath?: string;
  command: string;
  kind: "read";
  name: string;
}

export interface CodexSearchDisplayAction {
  command: string;
  kind: "search";
  path?: string;
  query: string;
}

export interface CodexListDisplayAction {
  command: string;
  kind: "list";
  path?: string;
}

export type CodexDisplayAction =
  | CodexReadDisplayAction
  | CodexSearchDisplayAction
  | CodexListDisplayAction;

export interface CodexCommandAnalysis {
  actions: CodexDisplayAction[];
  command: string;
  explorationOnly: true;
}

const SHELL_EXECUTABLES = new Set(["bash", "sh", "zsh", "dash"]);
const POWERSHELL_EXECUTABLES = new Set([
  "pwsh",
  "pwsh.exe",
  "powershell",
  "powershell.exe",
]);

function shouldEscapeShellChar(next: string | undefined): boolean {
  return (
    next !== undefined &&
    (/\s/.test(next) || next === "\\" || next === "'" || next === '"')
  );
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (!char) continue;

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (
        quote === '"' &&
        char === "\\" &&
        shouldEscapeShellChar(command[i + 1])
      ) {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\\" && shouldEscapeShellChar(command[i + 1])) {
      escaping = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function getExecutableName(token: string): string {
  const normalized = token.replace(/\\/g, "/");
  return (normalized.split("/").pop() || token).toLowerCase();
}

function isShellExecutable(token: string): boolean {
  return SHELL_EXECUTABLES.has(getExecutableName(token));
}

function isPowerShellExecutable(token: string): boolean {
  const executableName = getExecutableName(token);
  return (
    POWERSHELL_EXECUTABLES.has(executableName) ||
    executableName.endsWith("pwsh.exe") ||
    executableName.endsWith("powershell.exe")
  );
}

function getShellLauncherPrefixLength(tokens: string[]): number {
  if (tokens.length < 3) {
    return 0;
  }

  const first = tokens[0] || "";
  const second = tokens[1] || "";
  const third = tokens[2] || "";

  if (
    getExecutableName(first) === "env" &&
    isShellExecutable(second) &&
    third === "-lc" &&
    tokens.length >= 4
  ) {
    return 3;
  }

  if (isShellExecutable(first) && second === "-lc" && tokens.length >= 3) {
    return 2;
  }

  if (isPowerShellExecutable(first)) {
    for (let i = 1; i < tokens.length - 1; i++) {
      const token = tokens[i]?.toLowerCase();
      if (token === "-command" || token === "-c") {
        return i + 1;
      }
    }
  }

  return 0;
}

export function unwrapCodexShellLauncherCommand(command: string): string {
  let normalized = command.trim();

  for (let i = 0; i < 3; i++) {
    const tokens = tokenizeShellCommand(normalized);
    const launcherPrefixLength = getShellLauncherPrefixLength(tokens);
    if (launcherPrefixLength === 0 || tokens.length <= launcherPrefixLength) {
      break;
    }
    normalized = tokens.slice(launcherPrefixLength).join(" ").trim();
  }

  return normalized;
}

function splitTopLevelCommandSequence(command: string): string[] | null {
  const commands: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let escaping = false;

  const pushCommand = (end: number): boolean => {
    const part = command.slice(start, end).trim();
    if (!part) return false;
    commands.push(part);
    return true;
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const next = command[i + 1];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (quote) {
      if (quote === '"' && (char === "`" || (char === "$" && next === "("))) {
        return null;
      }
      if (char === "\\" && quote === '"') {
        escaping = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    // Command substitution and grouped shell programs require a real parser.
    if (char === "`" || (char === "$" && next === "(") || char === "(") {
      return null;
    }
    if (char === ")" || char === "{" || char === "}") {
      return null;
    }

    if (char === "|" && next === "|") {
      return null;
    }
    if (char === "&" && next !== "&") {
      return null;
    }

    const separatorLength =
      char === "&" && next === "&" ? 2 : char === ";" || char === "\n" ? 1 : 0;
    if (separatorLength === 0) continue;
    if (!pushCommand(i)) {
      // Permit formatting newlines immediately after another separator.
      if (char === "\n" && command.slice(start, i).trim() === "") {
        start = i + 1;
        continue;
      }
      return null;
    }
    i += separatorLength - 1;
    start = i + 1;
  }

  if (quote || escaping || !pushCommand(command.length)) {
    return null;
  }
  return commands;
}

function parseLineRangeToken(
  token: string,
): { startLine: number; endLine: number } | null {
  const match = token.match(/^(\d+)(?:,(\d+))?p$/);
  if (!match?.[1]) return null;

  const startLine = Number.parseInt(match[1], 10);
  const endLine = match[2] ? Number.parseInt(match[2], 10) : startLine;
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    return null;
  }

  return {
    startLine,
    endLine: Math.max(startLine, endLine),
  };
}

function parseReadShellCommand(command: string): CodexReadShellInfo | null {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) return null;

  if (tokens[0] === "cat" && tokens.length === 2) {
    const filePath = tokens[1];
    if (!filePath || filePath.startsWith("-")) {
      return null;
    }
    return {
      filePath,
      stripLineNumbers: false,
    };
  }

  if (tokens[0] === "sed" && tokens[1] === "-n" && tokens.length === 4) {
    const range = parseLineRangeToken(tokens[2] ?? "");
    const filePath = tokens[3];
    if (!range || !filePath || filePath.startsWith("-")) {
      return null;
    }
    return {
      filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      stripLineNumbers: false,
    };
  }

  const isNlSedCommand =
    tokens[0] === "nl" &&
    tokens[1] === "-ba" &&
    tokens[3] === "|" &&
    tokens[4] === "sed" &&
    tokens[5] === "-n" &&
    tokens.length === 7;
  if (isNlSedCommand) {
    const filePath = tokens[2];
    const range = parseLineRangeToken(tokens[6] ?? "");
    if (!filePath || !range) return null;
    return {
      filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      stripLineNumbers: true,
    };
  }

  return parsePowerShellGetContentCommand(tokens);
}

function parsePowerShellGetContentCommand(
  tokens: string[],
): CodexReadShellInfo | null {
  if (tokens[0]?.toLowerCase() !== "get-content") {
    return null;
  }

  if (tokens.some((token) => token === "&&" || token === ";")) {
    return null;
  }

  const pipeIndex = tokens.indexOf("|");
  const getContentTokens =
    pipeIndex === -1 ? tokens : tokens.slice(0, pipeIndex);
  let selectWindow: { skip: number; first?: number } | null = null;
  if (pipeIndex !== -1) {
    selectWindow = parseSelectObjectWindow(tokens.slice(pipeIndex + 1));
    if (!selectWindow) {
      return null;
    }
  }

  const flagsWithValue = new Set([
    "-credential",
    "-delimiter",
    "-encoding",
    "-erroraction",
    "-exclude",
    "-filter",
    "-include",
    "-readcount",
    "-stream",
  ]);
  let filePath = "";
  let totalCount: number | undefined;

  for (let i = 1; i < getContentTokens.length; i++) {
    const token = getContentTokens[i];
    if (!token) continue;
    const normalized = token.toLowerCase();

    if (normalized === "-path" || normalized === "-literalpath") {
      const next = getContentTokens[i + 1];
      if (!next || next.startsWith("-")) return null;
      filePath = next;
      i += 1;
      continue;
    }
    if (normalized.startsWith("-path:")) {
      filePath = token.slice("-path:".length);
      continue;
    }
    if (normalized.startsWith("-literalpath:")) {
      filePath = token.slice("-literalpath:".length);
      continue;
    }

    if (normalized === "-totalcount" || normalized === "-head") {
      const next = getContentTokens[i + 1];
      const parsed = next ? Number.parseInt(next, 10) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      totalCount = parsed;
      i += 1;
      continue;
    }
    if (normalized.startsWith("-totalcount:")) {
      const parsed = Number.parseInt(token.slice("-totalcount:".length), 10);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      totalCount = parsed;
      continue;
    }
    if (normalized.startsWith("-head:")) {
      const parsed = Number.parseInt(token.slice("-head:".length), 10);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      totalCount = parsed;
      continue;
    }

    if (flagsWithValue.has(normalized)) {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (!filePath) filePath = token;
  }

  filePath = stripOuterQuotes(filePath);
  if (!filePath || filePath.startsWith("-")) return null;

  if (selectWindow) {
    const startLine = selectWindow.skip + 1;
    return {
      filePath,
      startLine,
      ...(selectWindow.first !== undefined && selectWindow.first > 0
        ? { endLine: selectWindow.skip + selectWindow.first }
        : {}),
      stripLineNumbers: false,
    };
  }

  return {
    filePath,
    ...(totalCount !== undefined && totalCount > 0
      ? { startLine: 1, endLine: totalCount }
      : {}),
    stripLineNumbers: false,
  };
}

function parseSelectObjectWindow(
  tokens: string[],
): { skip: number; first?: number } | null {
  if (tokens[0]?.toLowerCase() !== "select-object") {
    return null;
  }

  let skip: number | undefined;
  let first: number | undefined;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const normalized = token.toLowerCase();

    if (normalized === "-skip" || normalized === "-first") {
      const next = tokens[i + 1];
      const parsed = next ? Number.parseInt(next, 10) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      if (normalized === "-skip") skip = parsed;
      else first = parsed;
      i += 1;
      continue;
    }

    if (normalized.startsWith("-skip:") || normalized.startsWith("-first:")) {
      const prefixLength = normalized.startsWith("-skip:")
        ? "-skip:".length
        : "-first:".length;
      const parsed = Number.parseInt(token.slice(prefixLength), 10);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      if (normalized.startsWith("-skip:")) skip = parsed;
      else first = parsed;
      continue;
    }

    return null;
  }

  if (skip === undefined && first === undefined) return null;
  return {
    skip: skip ?? 0,
    ...(first !== undefined ? { first } : {}),
  };
}

function parseRipgrepCommand(
  command: string,
): { query: string; path?: string } | null {
  const tokens = tokenizeShellCommand(command);
  if (tokens[0] !== "rg" || tokens.length < 2) {
    return null;
  }
  if (tokens.includes("--files")) {
    return null;
  }
  if (
    tokens.some((token) => token === "|" || token === "&&" || token === ";")
  ) {
    return null;
  }

  const flagsWithValue = new Set([
    "-g",
    "--glob",
    "-e",
    "--regexp",
    "-f",
    "--file",
    "-m",
    "--max-count",
    "-A",
    "--after-context",
    "-B",
    "--before-context",
    "-C",
    "--context",
    "-t",
    "--type",
    "-T",
    "--type-not",
  ]);

  let query = "";
  const searchPaths: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token === "--") {
      const rest = tokens.slice(i + 1).filter(Boolean);
      if (!query && rest[0]) query = rest[0];
      if (query) searchPaths.push(...rest.slice(1));
      break;
    }
    if (token === "-e" || token === "--regexp") {
      const next = tokens[i + 1];
      if (next && !query) query = next;
      i += 1;
      continue;
    }
    if (flagsWithValue.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith("--glob=") || token.startsWith("--regexp=")) {
      if (token.startsWith("--regexp=") && !query) {
        query = token.slice("--regexp=".length);
      }
      continue;
    }
    if (token.startsWith("-")) continue;
    if (!query) query = token;
    else searchPaths.push(token);
  }

  if (!query) return null;
  return {
    query,
    ...(searchPaths.length > 0 ? { path: searchPaths.join(" ") } : {}),
  };
}

function parseListCommand(command: string): { path?: string } | null {
  const tokens = tokenizeShellCommand(command);
  if (tokens.some((token) => token === "|" || token === ">" || token === "<")) {
    return null;
  }

  if (tokens[0] === "rg" && tokens[1] === "--files") {
    const flagsWithValue = new Set([
      "-g",
      "--glob",
      "--iglob",
      "-t",
      "--type",
      "-T",
      "--type-not",
      "--sort",
      "--sortr",
    ]);
    const paths: string[] = [];
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;
      if (flagsWithValue.has(token)) {
        i += 1;
        continue;
      }
      if (token.startsWith("-")) continue;
      paths.push(token);
    }
    if (paths.length > 1) return null;
    return paths[0] ? { path: paths[0] } : {};
  }

  if (tokens[0] === "ls") {
    const paths = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (paths.length > 1) return null;
    return paths[0] ? { path: paths[0] } : {};
  }

  return null;
}

function isWindowsPath(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\") ||
    value.includes("\\")
  );
}

function isAbsoluteCrossPlatform(value: string): boolean {
  return posix.isAbsolute(value) || win32.isAbsolute(value);
}

function resolveAbsolutePath(
  filePath: string,
  workingDirectory: string | undefined,
): string | undefined {
  if (isAbsoluteCrossPlatform(filePath)) return filePath;
  if (!workingDirectory) return undefined;
  const pathApi = isWindowsPath(workingDirectory) ? win32 : posix;
  return pathApi.resolve(workingDirectory, filePath);
}

function basenameCrossPlatform(filePath: string): string {
  return isWindowsPath(filePath)
    ? win32.basename(filePath)
    : posix.basename(filePath);
}

function parseDisplayAction(
  command: string,
  workingDirectory: string | undefined,
): CodexDisplayAction | null {
  const readInfo = parseReadShellCommand(command);
  if (readInfo) {
    const absolutePath = resolveAbsolutePath(
      readInfo.filePath,
      workingDirectory,
    );
    return {
      kind: "read",
      command,
      name: basenameCrossPlatform(readInfo.filePath),
      ...readInfo,
      ...(absolutePath ? { absolutePath } : {}),
    };
  }

  const listInfo = parseListCommand(command);
  if (listInfo) {
    return { kind: "list", command, ...listInfo };
  }

  const searchInfo = parseRipgrepCommand(command);
  if (searchInfo) {
    return { kind: "search", command, ...searchInfo };
  }

  return null;
}

export function analyzeCodexCommand(
  command: string,
  workingDirectory?: string,
): CodexCommandAnalysis | null {
  const normalizedCommand = unwrapCodexShellLauncherCommand(command);
  const commands = splitTopLevelCommandSequence(normalizedCommand);
  if (!commands) return null;

  const actions: CodexDisplayAction[] = [];
  for (const part of commands) {
    const action = parseDisplayAction(part, workingDirectory);
    if (!action) return null;
    actions.push(action);
  }

  return {
    actions,
    command: normalizedCommand,
    explorationOnly: true,
  };
}

/** Strip parser evidence that should not participate in render identity. */
export function toToolDisplayActions(
  actions: CodexDisplayAction[],
): ToolDisplayAction[] {
  return actions.map((action) => {
    switch (action.kind) {
      case "read":
        return {
          kind: action.kind,
          path: action.filePath,
          name: action.name,
          ...(action.absolutePath ? { absolutePath: action.absolutePath } : {}),
          ...(action.startLine !== undefined
            ? { startLine: action.startLine }
            : {}),
          ...(action.endLine !== undefined ? { endLine: action.endLine } : {}),
        };
      case "search":
        return {
          kind: action.kind,
          query: action.query,
          ...(action.path ? { path: action.path } : {}),
        };
      case "list":
        return {
          kind: action.kind,
          ...(action.path ? { path: action.path } : {}),
        };
      default:
        throw new Error("Unsupported Codex display action");
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Convert live app-server metadata into the same semantic vocabulary. */
export function parseCodexCommandActionsOracle(
  commandActions: unknown,
): CodexDisplayAction[] | null {
  if (!Array.isArray(commandActions) || commandActions.length === 0)
    return null;

  const actions: CodexDisplayAction[] = [];
  for (const value of commandActions) {
    if (!isRecord(value)) return null;
    const type = stringField(value, "type");
    const command = stringField(value, "command") ?? "";

    if (type === "read") {
      const filePath = stringField(value, "path");
      if (!filePath) return null;
      const parsed = parseReadShellCommand(command);
      actions.push({
        kind: "read",
        command,
        filePath,
        absolutePath: filePath,
        name: stringField(value, "name") ?? basenameCrossPlatform(filePath),
        ...(parsed?.startLine !== undefined
          ? { startLine: parsed.startLine }
          : {}),
        ...(parsed?.endLine !== undefined ? { endLine: parsed.endLine } : {}),
        stripLineNumbers: parsed?.stripLineNumbers ?? false,
      });
      continue;
    }

    if (type === "search") {
      const query = stringField(value, "query");
      if (!query) return null;
      const path = stringField(value, "path");
      actions.push({
        kind: "search",
        command,
        query,
        ...(path ? { path } : {}),
      });
      continue;
    }

    if (type === "listFiles") {
      const path = stringField(value, "path");
      actions.push({ kind: "list", command, ...(path ? { path } : {}) });
      continue;
    }

    return null;
  }

  return actions;
}

export function stripOuterQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return value.slice(1, -1);
  }

  return value;
}
