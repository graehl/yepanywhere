#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const clientSrcDir = path.join(repoRoot, "packages", "client", "src");

const defaultLimit = 120;

const userFacingAttributeNames = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "data-tooltip",
  "placeholder",
  "title",
]);

const codeLikeElementNames = new Set(["code", "kbd", "pre", "samp", "var"]);

const skippedDirectories = new Set([
  "__tests__",
  "i18n",
  "node_modules",
  "styles",
]);

const skippedExactText = new Set([
  "",
  " ",
  "/btw",
  "AI",
  "bash",
  "Bash",
  "Claude",
  "Claude Code",
  "Claude SDK",
  "CLI",
  "command",
  "Codex",
  "Codex CLI",
  "CodexOSS",
  "diff",
  "Gemini",
  "Gemini ACP",
  "Grok",
  "Grok STT",
  "Mother",
  "Ollama",
  "OpenCode",
  "PCM16",
  "REC",
  "STT",
  "URL",
  "WebRTC",
  "Yep Anywhere",
  "YA",
  "vLLM",
]);

const informationalSingleWords = new Set([
  "Added",
  "Archived",
  "Audio",
  "Copy",
  "Copied",
  "Correction",
  "Draft",
  "Edit",
  "Ext",
  "Explored",
  "Jump",
  "Loading",
  "Plan",
  "Removed",
  "Save",
  "Turn",
]);

function usage() {
  console.log(`Usage: node scripts/find-raw-i18n-copy.mjs [options]

Scans client TSX files for likely raw user-facing English copy. This is an
advisory heuristic, not a parser for localization correctness.

Options:
  --include-info       Include low-priority short labels and badges.
  --limit <count>      Maximum findings to print. Default: ${defaultLimit}.
  --json               Print machine-readable JSON.
  --max-warnings <n>   Exit 1 when warnings exceed n. Omit for advisory exit 0.
  --help               Show this message.
`);
}

function parseArgs(argv) {
  const options = {
    includeInfo: false,
    json: false,
    limit: defaultLimit,
    maxWarnings: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") return { help: true, options };
    if (arg === "--include-info") {
      options.includeInfo = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      index += 1;
      options.limit = parseNonNegativeInteger(raw, "--limit");
      continue;
    }
    if (arg?.startsWith("--limit=")) {
      options.limit = parseNonNegativeInteger(
        arg.slice("--limit=".length),
        "--limit",
      );
      continue;
    }
    if (arg === "--max-warnings") {
      const raw = argv[index + 1];
      index += 1;
      options.maxWarnings = parseNonNegativeInteger(raw, "--max-warnings");
      continue;
    }
    if (arg?.startsWith("--max-warnings=")) {
      options.maxWarnings = parseNonNegativeInteger(
        arg.slice("--max-warnings=".length),
        "--max-warnings",
      );
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return { help: false, options };
}

function parseNonNegativeInteger(raw, optionName) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value) || value < 0 || String(value) !== String(raw)) {
    throw new Error(`${optionName} expects a non-negative integer.`);
  }
  return value;
}

async function collectTsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue;
      files.push(...(await collectTsxFiles(entryPath)));
      continue;
    }

    if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".stories.tsx")
    ) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function normalizeText(text) {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isCommandLikeText(text) {
  return /^(>|npm|pnpm|yarn|npx|node|git|grep|find|rg|curl|ssh|bash|zsh|sh|codex|ya-clean)\b/i.test(
    text,
  );
}

function isKeyboardHint(text) {
  return /^(Ctrl|Cmd|Alt|Shift|Enter|Esc|Tab|End|Click|Space|[A-Z])(\s*\+\s*(Ctrl|Cmd|Alt|Shift|Enter|Esc|Tab|End|Space|[A-Z]))*$/i.test(
    text,
  );
}

function isSimpleStatusText(text) {
  return /^(Loading|Computing|Planning|Updating|Connecting|Reconnecting|Compacting)(?: [A-Za-z-]+)*\.\.\.$/.test(
    text,
  );
}

function isRendererOperationalText(text) {
  return (
    text === "... and" ||
    text.startsWith("Content truncated ") ||
    isSimpleStatusText(text)
  );
}

function isTechnicalAttributeLabel(text) {
  return (
    text.length <= 64 &&
    !/[.!?…]/.test(text) &&
    /(\b[A-Z]{2,}\b|\/|browser-to-[A-Z]+|fullscreen|keyboard|transcript|audio format)/.test(
      text,
    )
  );
}

function shouldSkipText(text) {
  if (text.length === 0) return true;
  if (skippedExactText.has(text)) return true;
  if (!/[A-Za-z]/.test(text)) return true;
  if (/^&#x?[0-9a-f]+;?$/i.test(text)) return true;
  if (/^\\u[0-9a-f]+/i.test(text)) return true;
  if (/^(https?|wss?):\/\//.test(text)) return true;
  if (/^~?\//.test(text)) return true;
  if (/^[./\w-]+\.(tsx?|jsx?|json|css|md|png|jpe?g|gif|svg)$/.test(text)) {
    return true;
  }
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(text)) return true;
  if (/^[A-Z0-9_./:+-]{2,}$/.test(text)) return true;
  if (isKeyboardHint(text)) return true;
  if (isCommandLikeText(text)) return true;
  if (/^[A-Za-z]\([^)]+\)\s*=/.test(text)) return true;
  if (/^[-+*/=()[\]{}.,:;'"`<>|\\!?@#$%^&~\s]+$/.test(text)) return true;
  return false;
}

function isLowerPriorityPath(relativeFile) {
  return (
    relativeFile.includes("/components/renderers/") ||
    relativeFile.includes("/components/blocks/")
  );
}

function classifyText(text, sourceKind, relativeFile) {
  if (shouldSkipText(text)) return null;

  const words = text.match(/[A-Za-z][A-Za-z']*/g) ?? [];
  if (words.length === 0) return null;
  if (
    text.includes("↑") ||
    text.includes("↓") ||
    /\b(Esc|Enter|Ctrl|Cmd)\b/.test(text)
  ) {
    return {
      severity: "info",
      reason: "keyboard hint",
    };
  }
  if (isSimpleStatusText(text)) {
    return {
      severity: "info",
      reason: "status label",
    };
  }

  if (words.length === 1) {
    const word = words[0];
    if (
      informationalSingleWords.has(text) ||
      informationalSingleWords.has(word)
    ) {
      return {
        severity: "info",
        reason: "short label",
      };
    }
    if (text.length <= 12 && !/[.!?…]/.test(text)) {
      return {
        severity: "info",
        reason: "short label",
      };
    }
  }
  if (sourceKind === "attribute" && isTechnicalAttributeLabel(text)) {
    return {
      severity: "info",
      reason: "technical label",
    };
  }

  if (text.length <= 32 && !/[.!?…]/.test(text)) {
    return {
      severity: "info",
      reason: "short label",
    };
  }

  const lowerPriority = isLowerPriorityPath(relativeFile);
  if (lowerPriority && isRendererOperationalText(text)) {
    return {
      severity: "info",
      reason: "renderer status",
    };
  }

  const likelyProse =
    words.length >= 5 ||
    text.length >= 33 ||
    /[.!?…]/.test(text) ||
    (sourceKind === "attribute" && text.length > 32);

  if (likelyProse) {
    if (lowerPriority && text.length < 60 && !/[.!?…]/.test(text)) {
      return {
        severity: "info",
        reason:
          sourceKind === "attribute" ? "renderer attribute" : "renderer label",
      };
    }

    return {
      severity: "warning",
      reason:
        sourceKind === "attribute" ? "user-facing attribute" : "raw JSX text",
    };
  }

  return {
    severity: "info",
    reason: "short label",
  };
}

function getLineColumn(sourceFile, position) {
  const lineAndCharacter = sourceFile.getLineAndCharacterOfPosition(position);
  return {
    line: lineAndCharacter.line + 1,
    column: lineAndCharacter.character + 1,
  };
}

function getStringLiteralText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function isInsideCodeLikeElement(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const tagName = current.openingElement.tagName.getText(sourceFile);
      if (codeLikeElementNames.has(tagName)) return true;
    }
    current = current.parent;
  }
  return false;
}

function getJsxAttributeLiteral(openingElement, sourceFile, attributeName) {
  const property = openingElement.attributes.properties.find((attribute) => {
    return (
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(sourceFile) === attributeName
    );
  });
  if (!property || !ts.isJsxAttribute(property)) return null;
  return getJsxAttributeString(property);
}

function isInsideElementWithClass(node, sourceFile, className) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const classValue = getJsxAttributeLiteral(
        current.openingElement,
        sourceFile,
        "className",
      );
      if (classValue?.split(/\s+/).includes(className)) return true;
    }
    current = current.parent;
  }
  return false;
}

function getJsxAttributeString(attribute) {
  const initializer = attribute.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (!ts.isJsxExpression(initializer)) return null;
  const expression = initializer.expression;
  return expression ? getStringLiteralText(expression) : null;
}

function recordFinding(
  findings,
  sourceFile,
  filePath,
  node,
  rawText,
  kind,
  attributeName,
) {
  if (kind === "text" && isInsideCodeLikeElement(node, sourceFile)) return;

  const text = normalizeText(rawText);
  const relativeFile = path.relative(repoRoot, filePath);
  const classification = classifyText(text, kind, relativeFile);
  if (!classification) return;
  const isSpecimenCopy =
    kind === "text" &&
    isInsideElementWithClass(node, sourceFile, "output-appearance-specimen");

  const location = getLineColumn(sourceFile, node.getStart(sourceFile));
  findings.push({
    severity:
      isSpecimenCopy && classification.severity === "warning"
        ? "info"
        : classification.severity,
    reason:
      isSpecimenCopy && classification.severity === "warning"
        ? "specimen copy"
        : classification.reason,
    file: relativeFile,
    line: location.line,
    column: location.column,
    kind,
    attribute: attributeName ?? null,
    text,
  });
}

function scanSourceFile(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];

  function visit(node) {
    if (ts.isJsxText(node)) {
      recordFinding(
        findings,
        sourceFile,
        filePath,
        node,
        node.getText(sourceFile),
        "text",
      );
    } else if (ts.isJsxExpression(node)) {
      const expression = node.expression;
      if (
        expression &&
        (ts.isStringLiteral(expression) ||
          ts.isNoSubstitutionTemplateLiteral(expression)) &&
        !ts.isJsxAttribute(node.parent)
      ) {
        recordFinding(
          findings,
          sourceFile,
          filePath,
          expression,
          expression.text,
          "text",
        );
      }
    } else if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      if (userFacingAttributeNames.has(attributeName)) {
        const text = getJsxAttributeString(node);
        if (text !== null) {
          recordFinding(
            findings,
            sourceFile,
            filePath,
            node,
            text,
            "attribute",
            attributeName,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function sortFindings(findings) {
  const severityOrder = { warning: 0, info: 1 };
  return findings.sort((a, b) => {
    const severity = severityOrder[a.severity] - severityOrder[b.severity];
    if (severity !== 0) return severity;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
}

function printTextReport(findings, summary, options) {
  console.log("Raw i18n copy scan (advisory)");
  console.log(
    `Warnings: ${summary.warningCount}; info: ${summary.infoCount}${
      options.includeInfo ? "" : " (hidden; pass --include-info to show)"
    }`,
  );

  const printableFindings = findings
    .filter((finding) => options.includeInfo || finding.severity === "warning")
    .slice(0, options.limit);

  let previousFile = null;
  for (const finding of printableFindings) {
    if (finding.file !== previousFile) {
      console.log(`\n${finding.file}`);
      previousFile = finding.file;
    }
    const attribute = finding.attribute ? ` ${finding.attribute}` : "";
    console.log(
      `  ${finding.line}:${finding.column} ${finding.severity} ${finding.kind}${attribute} - ${finding.reason}: ${JSON.stringify(finding.text)}`,
    );
  }

  const visibleTotal = findings.filter(
    (finding) => options.includeInfo || finding.severity === "warning",
  ).length;
  if (visibleTotal > printableFindings.length) {
    console.log(
      `\n... ${visibleTotal - printableFindings.length} more finding(s) omitted by --limit.`,
    );
  }

  console.log(
    "\nThis scan is intentionally permissive. Keep brand names, keyboard keys, code-like labels, and renderer/debug text on the allowlist as needed.",
  );
}

async function main() {
  const { help, options } = parseArgs(process.argv.slice(2));
  if (help) {
    usage();
    return;
  }

  const files = await collectTsxFiles(clientSrcDir);
  const findings = [];
  for (const filePath of files) {
    const text = await readFile(filePath, "utf8");
    findings.push(...scanSourceFile(filePath, text));
  }
  sortFindings(findings);

  const summary = {
    fileCount: files.length,
    warningCount: findings.filter((finding) => finding.severity === "warning")
      .length,
    infoCount: findings.filter((finding) => finding.severity === "info").length,
  };

  if (options.json) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    printTextReport(findings, summary, options);
  }

  if (
    options.maxWarnings !== null &&
    summary.warningCount > options.maxWarnings
  ) {
    console.error(
      `Raw i18n warning count ${summary.warningCount} exceeds --max-warnings ${options.maxWarnings}.`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
