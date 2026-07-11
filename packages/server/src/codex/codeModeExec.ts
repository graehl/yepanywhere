/**
 * Conservative reader for Codex code-mode `exec` rollout entries.
 *
 * This is deliberately not a JavaScript parser. It recognizes only direct
 * `tools.<name>(literal)` calls and identifiers bound by a simple
 * `const <name> = <literal>` declaration. A literal is a JS literal
 * expression (models emit unquoted identifier keys, single-quoted strings,
 * and trailing commas at least as often as strict JSON), parsed without
 * evaluation. Unknown expressions fail closed so transcript rendering never
 * depends on evaluating persisted code.
 */

export interface CodexCodeModeNestedCall {
  input: unknown;
  sourceEnd: number;
  sourceStart: number;
  toolName: string;
}

export interface CodexCodeModeGroupInput {
  calls: Array<Pick<CodexCodeModeNestedCall, "input" | "toolName">>;
  source: string;
}

interface ScannedExpression {
  end: number;
  text: string;
}

const IDENTIFIER_START_RE = /[A-Za-z_$]/;
const IDENTIFIER_PART_RE = /[A-Za-z0-9_$]/;

function isIdentifierStart(char: string | undefined): boolean {
  return !!char && IDENTIFIER_START_RE.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return !!char && IDENTIFIER_PART_RE.test(char);
}

function readIdentifier(
  source: string,
  start: number,
): { end: number; value: string } | null {
  if (!isIdentifierStart(source[start])) return null;
  let end = start + 1;
  while (isIdentifierPart(source[end])) end++;
  return { end, value: source.slice(start, end) };
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    index++;
    if (char === quote) return index;
  }
  return source.length;
}

function skipComment(source: string, start: number): number {
  if (source[start + 1] === "/") {
    const newline = source.indexOf("\n", start + 2);
    return newline < 0 ? source.length : newline + 1;
  }
  if (source[start + 1] === "*") {
    const end = source.indexOf("*/", start + 2);
    return end < 0 ? source.length : end + 2;
  }
  return start;
}

function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) {
      index++;
      continue;
    }
    if (source[index] === "/") {
      const afterComment = skipComment(source, index);
      if (afterComment !== index) {
        index = afterComment;
        continue;
      }
    }
    break;
  }
  return index;
}

function scanExpression(
  source: string,
  start: number,
  terminators: ReadonlySet<string>,
): ScannedExpression | null {
  const stack: string[] = [];
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "/") {
      const afterComment = skipComment(source, index);
      if (afterComment !== index) {
        index = afterComment;
        continue;
      }
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
      index++;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (stack.length === 0 && terminators.has(char)) {
        return { end: index, text: source.slice(start, index).trim() };
      }
      const expected = char === ")" ? "(" : char === "]" ? "[" : "{";
      if (stack.pop() !== expected) return null;
      index++;
      continue;
    }
    if (stack.length === 0 && terminators.has(char ?? "")) {
      return { end: index, text: source.slice(start, index).trim() };
    }
    index++;
  }
  if (terminators.has("")) {
    return { end: source.length, text: source.slice(start).trim() };
  }
  return null;
}

function parseJsonLiteral(text: string): unknown | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return parseJsLiteralExpression(text);
  }
}

const JS_ESCAPE_MAP: Record<string, string> = {
  "0": "\0",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

interface ParsedLiteralValue {
  end: number;
  value: unknown;
}

/**
 * Parse one JS literal expression (object, array, string, number, boolean,
 * null) without evaluating code. Returns undefined for anything else —
 * identifiers, calls, spreads, template interpolation — so callers keep the
 * fail-closed contract of the JSON path.
 */
function parseJsLiteralExpression(text: string): unknown | undefined {
  const parsed = parseLiteralValue(text, skipTrivia(text, 0));
  if (!parsed) return undefined;
  if (skipTrivia(text, parsed.end) !== text.length) return undefined;
  return parsed.value;
}

function parseLiteralValue(
  source: string,
  start: number,
): ParsedLiteralValue | null {
  const char = source[start];
  if (char === '"' || char === "'" || char === "`") {
    return parseLiteralString(source, start);
  }
  if (char === "{") return parseLiteralObject(source, start);
  if (char === "[") return parseLiteralArray(source, start);
  const keyword = readIdentifier(source, start);
  if (keyword) {
    if (keyword.value === "true") return { end: keyword.end, value: true };
    if (keyword.value === "false") return { end: keyword.end, value: false };
    if (keyword.value === "null") return { end: keyword.end, value: null };
    return null;
  }
  return parseLiteralNumber(source, start);
}

function parseLiteralString(
  source: string,
  start: number,
): ParsedLiteralValue | null {
  const quote = source[start];
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) return null;
      if (escaped === "u" || escaped === "x") {
        const hexLength = escaped === "x" ? 2 : 4;
        const hex = source.slice(index + 2, index + 2 + hexLength);
        if (!new RegExp(`^[0-9a-fA-F]{${hexLength}}$`).test(hex)) return null;
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 2 + hexLength;
        continue;
      }
      value += JS_ESCAPE_MAP[escaped] ?? escaped;
      index += 2;
      continue;
    }
    if (char === quote) {
      return { end: index + 1, value };
    }
    // Template interpolation would need evaluation; fail closed.
    if (quote === "`" && char === "$" && source[index + 1] === "{") return null;
    if (quote !== "`" && char === "\n") return null;
    value += char;
    index++;
  }
  return null;
}

const LITERAL_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function parseLiteralNumber(
  source: string,
  start: number,
): ParsedLiteralValue | null {
  const match = LITERAL_NUMBER_RE.exec(source.slice(start));
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return { end: start + match[0].length, value };
}

function parseLiteralObject(
  source: string,
  start: number,
): ParsedLiteralValue | null {
  const value: Record<string, unknown> = {};
  let index = skipTrivia(source, start + 1);
  while (index < source.length) {
    if (source[index] === "}") return { end: index + 1, value };

    let key: string;
    const char = source[index];
    if (char === '"' || char === "'") {
      const parsedKey = parseLiteralString(source, index);
      if (!parsedKey || typeof parsedKey.value !== "string") return null;
      key = parsedKey.value;
      index = parsedKey.end;
    } else {
      const identifier = readIdentifier(source, index);
      if (!identifier) return null;
      key = identifier.value;
      index = identifier.end;
    }

    index = skipTrivia(source, index);
    if (source[index] !== ":") return null;
    index = skipTrivia(source, index + 1);
    const parsedValue = parseLiteralValue(source, index);
    if (!parsedValue) return null;
    value[key] = parsedValue.value;

    index = skipTrivia(source, parsedValue.end);
    if (source[index] === ",") {
      index = skipTrivia(source, index + 1);
      continue;
    }
    if (source[index] === "}") return { end: index + 1, value };
    return null;
  }
  return null;
}

function parseLiteralArray(
  source: string,
  start: number,
): ParsedLiteralValue | null {
  const value: unknown[] = [];
  let index = skipTrivia(source, start + 1);
  while (index < source.length) {
    if (source[index] === "]") return { end: index + 1, value };

    const parsedValue = parseLiteralValue(source, index);
    if (!parsedValue) return null;
    value.push(parsedValue.value);

    index = skipTrivia(source, parsedValue.end);
    if (source[index] === ",") {
      index = skipTrivia(source, index + 1);
      continue;
    }
    if (source[index] === "]") return { end: index + 1, value };
    return null;
  }
  return null;
}

function collectConstLiterals(source: string): Map<string, unknown> {
  const literals = new Map<string, unknown>();
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "/") {
      const afterComment = skipComment(source, index);
      if (afterComment !== index) {
        index = afterComment;
        continue;
      }
    }
    const keyword = readIdentifier(source, index);
    if (!keyword) {
      index++;
      continue;
    }
    index = keyword.end;
    if (keyword.value !== "const") continue;

    const name = readIdentifier(source, skipTrivia(source, index));
    if (!name) continue;
    let cursor = skipTrivia(source, name.end);
    if (source[cursor] !== "=") continue;
    cursor = skipTrivia(source, cursor + 1);
    const expression = scanExpression(source, cursor, new Set([";", ""]));
    if (!expression) continue;
    const value = parseJsonLiteral(expression.text);
    if (value !== undefined) literals.set(name.value, value);
    index = Math.max(index, expression.end + 1);
  }
  return literals;
}

function resolveLiteral(
  expression: string,
  constLiterals: ReadonlyMap<string, unknown>,
): unknown | undefined {
  const direct = parseJsonLiteral(expression);
  if (direct !== undefined) return direct;
  if (!/^[$A-Z_a-z][$\w]*$/.test(expression)) return undefined;
  return constLiterals.get(expression);
}

function normalizeNestedInput(toolName: string, input: unknown): unknown {
  if (toolName === "apply_patch" && typeof input === "string") {
    return { _rawPatch: input };
  }
  return input;
}

/** Extract literal nested tool calls from persisted Codex code-mode source. */
export function extractCodexCodeModeCalls(
  source: unknown,
): CodexCodeModeNestedCall[] {
  if (typeof source !== "string" || !source.includes("tools.")) return [];

  const constLiterals = collectConstLiterals(source);
  const calls: CodexCodeModeNestedCall[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "/") {
      const afterComment = skipComment(source, index);
      if (afterComment !== index) {
        index = afterComment;
        continue;
      }
    }

    const root = readIdentifier(source, index);
    if (!root) {
      index++;
      continue;
    }
    index = root.end;
    if (root.value !== "tools") continue;

    let cursor = skipTrivia(source, root.end);
    if (source[cursor] !== ".") continue;
    cursor = skipTrivia(source, cursor + 1);
    const method = readIdentifier(source, cursor);
    if (!method) continue;
    cursor = skipTrivia(source, method.end);
    if (source[cursor] !== "(") continue;

    const argumentStart = skipTrivia(source, cursor + 1);
    const argument = scanExpression(source, argumentStart, new Set([",", ")"]));
    if (!argument || source[argument.end] === ",") {
      index = cursor + 1;
      continue;
    }
    const input = resolveLiteral(argument.text, constLiterals);
    if (input === undefined) {
      index = argument.end + 1;
      continue;
    }
    calls.push({
      input: normalizeNestedInput(method.value, input),
      sourceEnd: argument.end + 1,
      sourceStart: root.end - root.value.length,
      toolName: method.value,
    });
    index = argument.end + 1;
  }
  return calls;
}

export function createCodexCodeModeGroupInput(
  source: string,
  calls: CodexCodeModeNestedCall[],
): CodexCodeModeGroupInput {
  return {
    calls: calls.map(({ input, toolName }) => ({ input, toolName })),
    source,
  };
}

/**
 * Flatten the text-only content block array emitted by Codex code mode.
 * Mixed media/resource output stays in its original structured form.
 */
export function extractCodexCodeModeTextOutput(
  output: unknown,
): string | undefined {
  if (!Array.isArray(output) || output.length === 0) return undefined;
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    if (
      record.type !== "input_text" &&
      record.type !== "output_text" &&
      record.type !== "text"
    ) {
      return undefined;
    }
    if (typeof record.text !== "string") return undefined;
    parts.push(record.text);
  }
  return parts.join("");
}
