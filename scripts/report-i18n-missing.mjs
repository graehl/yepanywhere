#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const i18nDir = path.join(repoRoot, "packages", "client", "src", "i18n");
const englishLocale = "en";
const defaultLimit = 25;

function usage() {
  console.log(`Usage: node scripts/report-i18n-missing.mjs [options]

Reports keys present in en.json but absent from sparse non-English locale files.
This is an advisory backlog report; missing translations fall back to English
at runtime and do not make the command fail.

Options:
  --locale <code>      Report one locale. Repeat or comma-separate for many.
  --limit <count|all>  Missing key samples per locale. Default: ${defaultLimit}.
  --json               Print machine-readable JSON with full missing lists.
  --markdown           Print a Markdown report.
  --help               Show this message.
`);
}

function parseArgs(argv) {
  const options = {
    format: "text",
    limit: defaultLimit,
    locales: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") return { help: true, options };
    if (arg === "--json") {
      setFormat(options, "json");
      continue;
    }
    if (arg === "--markdown") {
      setFormat(options, "markdown");
      continue;
    }
    if (arg === "--locale") {
      const raw = argv[index + 1];
      index += 1;
      addLocales(options, raw);
      continue;
    }
    if (arg?.startsWith("--locale=")) {
      addLocales(options, arg.slice("--locale=".length));
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      index += 1;
      options.limit = parseLimit(raw);
      continue;
    }
    if (arg?.startsWith("--limit=")) {
      options.limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return { help: false, options };
}

function setFormat(options, format) {
  if (options.format !== "text" && options.format !== format) {
    throw new Error("Pass only one output format: --json or --markdown.");
  }
  options.format = format;
}

function addLocales(options, raw) {
  if (!raw) {
    throw new Error("--locale expects a locale code.");
  }
  for (const locale of raw.split(",")) {
    const trimmed = locale.trim();
    if (trimmed) options.locales.push(trimmed);
  }
}

function parseLimit(raw) {
  if (raw === "all") return null;
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value) || value < 0 || String(value) !== String(raw)) {
    throw new Error("--limit expects a non-negative integer or 'all'.");
  }
  return value;
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function collectLocaleFiles() {
  const files = (await readdir(i18nDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return files
    .map((file) => ({
      file,
      locale: path.basename(file, ".json"),
      path: path.join(i18nDir, file),
    }))
    .filter((entry) => entry.locale !== englishLocale);
}

function filterLocaleFiles(localeFiles, requestedLocales) {
  if (requestedLocales.length === 0) return localeFiles;

  const requested = new Set(requestedLocales);
  const available = new Set(localeFiles.map((entry) => entry.locale));
  const unknown = [...requested].filter((locale) => !available.has(locale));
  if (unknown.includes(englishLocale)) {
    throw new Error("en is the source catalog; report a non-English locale.");
  }
  if (unknown.length > 0) {
    throw new Error(`Unknown locale(s): ${unknown.join(", ")}`);
  }

  return localeFiles.filter((entry) => requested.has(entry.locale));
}

async function buildReport(options) {
  const englishPath = path.join(i18nDir, `${englishLocale}.json`);
  const englishMessages = await readJson(englishPath);
  const englishKeys = Object.keys(englishMessages);
  const localeFiles = filterLocaleFiles(
    await collectLocaleFiles(),
    options.locales,
  );

  const locales = [];
  for (const localeFile of localeFiles) {
    const messages = await readJson(localeFile.path);
    const missing = englishKeys
      .filter((key) => !Object.hasOwn(messages, key))
      .map((key) => ({
        key,
        english: String(englishMessages[key]),
      }));
    const translatedCount = englishKeys.length - missing.length;
    locales.push({
      locale: localeFile.locale,
      file: localeFile.file,
      englishKeyCount: englishKeys.length,
      translatedCount,
      missingCount: missing.length,
      coveragePercent: percent(translatedCount, englishKeys.length),
      missing,
    });
  }

  return {
    summary: {
      englishKeyCount: englishKeys.length,
      localeCount: locales.length,
      totalMissing: locales.reduce(
        (total, locale) => total + locale.missingCount,
        0,
      ),
    },
    locales,
  };
}

function percent(numerator, denominator) {
  if (denominator === 0) return 100;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function printTextReport(report, options) {
  console.log("Missing i18n translations (advisory)");
  console.log(`English keys: ${report.summary.englishKeyCount}`);
  console.log(
    `Locales: ${report.locales.map((entry) => entry.locale).join(", ")}`,
  );
  console.log(`Total missing: ${report.summary.totalMissing}`);
  console.log(
    "Missing keys fall back to English at runtime; this command does not enforce translation coverage.",
  );

  for (const locale of report.locales) {
    console.log(
      `\n${locale.file}: ${locale.missingCount} missing, ${locale.translatedCount} translated (${locale.coveragePercent}% coverage)`,
    );
    printTextMissing(locale.missing, options.limit);
  }

  if (options.limit !== null) {
    console.log("\nPass --limit all for complete text/Markdown output.");
  }
}

function printTextMissing(missing, limit) {
  const visible = limit === null ? missing : missing.slice(0, limit);
  for (const entry of visible) {
    console.log(`  ${entry.key}: ${JSON.stringify(entry.english)}`);
  }
  if (visible.length < missing.length) {
    console.log(
      `  ... ${missing.length - visible.length} more omitted by --limit.`,
    );
  }
}

function printMarkdownReport(report, options) {
  console.log("# Missing i18n Translations\n");
  console.log(
    "Advisory report. Missing sparse-locale keys fall back to English at runtime.\n",
  );
  console.log(`English keys: ${report.summary.englishKeyCount}`);
  console.log(`Total missing: ${report.summary.totalMissing}\n`);
  console.log("| Locale | Translated | Missing | Coverage |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const locale of report.locales) {
    console.log(
      `| \`${escapeMarkdown(locale.locale)}\` | ${locale.translatedCount} | ${locale.missingCount} | ${locale.coveragePercent}% |`,
    );
  }

  for (const locale of report.locales) {
    console.log(`\n## ${escapeMarkdown(locale.file)}\n`);
    console.log(
      `${locale.missingCount} missing, ${locale.translatedCount} translated (${locale.coveragePercent}% coverage).\n`,
    );
    const visible =
      options.limit === null
        ? locale.missing
        : locale.missing.slice(0, options.limit);
    if (visible.length === 0) {
      console.log("No missing keys shown.\n");
      continue;
    }
    console.log("| Key | English |");
    console.log("| --- | --- |");
    for (const entry of visible) {
      console.log(
        `| \`${escapeMarkdown(entry.key)}\` | ${escapeMarkdown(entry.english)} |`,
      );
    }
    if (visible.length < locale.missing.length) {
      console.log(
        `\n_${locale.missing.length - visible.length} more omitted by --limit._`,
      );
    }
  }
}

function escapeMarkdown(text) {
  return String(text)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .replaceAll("`", "\\`");
}

async function main() {
  const { help, options } = parseArgs(process.argv.slice(2));
  if (help) {
    usage();
    return;
  }

  const report = await buildReport(options);
  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.format === "markdown") {
    printMarkdownReport(report, options);
  } else {
    printTextReport(report, options);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
