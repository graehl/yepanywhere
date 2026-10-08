// acli-capabilities: commentary-lines/1
/**
 * Optional build step: retrain the Unicode prose-math recognizer and write
 * packages/server/src/augments/unicode-math-params.bin. Not part of the
 * normal build; the committed parameters are used unless this is run.
 * See topics/rich-text-rendering.md § Typeset plain-text math and
 * gaps/sketches/unicode-prose-math.md for the method and its evaluation.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  encodeUnicodeMathParams,
  findUnicodeMath,
  loadUnicodeMathParams,
} from "../../packages/server/src/augments/unicode-math-recognizer.js";
import {
  buildRows,
  type TrainingRow,
  texToUnicodeMathConverter,
} from "./corpus.js";
import { DEFAULT_FIT, fitUnicodeMath } from "./fit.js";
import {
  createSegmenter,
  type PaperRef,
  paperTexts,
  sessionTexts,
  type TextRun,
} from "./sources.js";

const HELP = `Usage: pnpm -s unicode-math:train [options]

Retrain the prose-math recognizer from local session logs and a pinned list
of arXiv papers, and write its binary parameters. Prints phase-tagged
progress and a summary; exits 0 when the parameters are written.

  --sessions <dir>     Session log directory, repeatable (default
                       ~/.claude/projects and ~/.codex/sessions)
  --papers <file>      Pinned arXiv list (default scripts/unicode-math/papers.json)
  --markdown <dir>     Extra Markdown documents with delimited math, repeatable
  --labels <file>      Hand-labelled JSONL rows {text, labels: [[start, end,
                       "math"|"soft"|"ignore"]]}, repeatable; trained on and
                       reported as fit (not held-out accuracy)
  --cache <dir>        Fetched papers and UnicodeMathML checkout (default
                       ~/.cache/yep-anywhere/unicode-math)
  --offline            Use only cached papers and UnicodeMathML; no network
  --out <file>         Output (default packages/server/src/augments/unicode-math-params.bin)
  --epochs <n>         Training epochs (default ${DEFAULT_FIT.epochs})
  --no-commentary      Omit "# _acli.commentary:" summary lines
  -h, --help           Show this help

Fetching papers needs network access to arxiv.org (about 3 s per paper).

acli-capabilities: commentary-lines/1`;

const { values: opt } = parseArgs({
  options: {
    sessions: { type: "string", multiple: true },
    papers: { type: "string" },
    markdown: { type: "string", multiple: true },
    labels: { type: "string", multiple: true },
    cache: { type: "string" },
    offline: { type: "boolean", default: false },
    out: { type: "string" },
    epochs: { type: "string" },
    "no-commentary": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (opt.help) {
  console.log(HELP);
  process.exit(0);
}

const repo = new URL("../../", import.meta.url).pathname;
const sessionsDirs = opt.sessions ?? [
  join(homedir(), ".claude/projects"),
  join(homedir(), ".codex/sessions"),
];
const papersFile = opt.papers ?? join(repo, "scripts/unicode-math/papers.json");
const cacheDir =
  opt.cache ?? join(homedir(), ".cache/yep-anywhere/unicode-math");
const outFile =
  opt.out ?? join(repo, "packages/server/src/augments/unicode-math-params.bin");
const epochs =
  opt.epochs === undefined ? DEFAULT_FIT.epochs : Number(opt.epochs);
if (!Number.isInteger(epochs) || epochs < 1) {
  console.error(`--epochs must be a positive integer, got ${opt.epochs}`);
  process.exit(2);
}
const log = (line: string) => console.log(line);
const commentary = (line: string) => {
  if (!opt["no-commentary"]) console.log(`# _acli.commentary: ${line}`);
};

console.log("# acli-capabilities: commentary-lines/1");
mkdirSync(cacheDir, { recursive: true });
const segment = createSegmenter();
const runs: TextRun[] = [];

const sessions = await sessionTexts(sessionsDirs, log);
for (const [i, text] of sessions.entries()) {
  runs.push(...segment("session", `s${i}`, text));
}
log(
  `[sources] ${sessions.length} assistant messages from ${sessionsDirs.join(", ")}`,
);

const papers = JSON.parse(readFileSync(papersFile, "utf8")) as PaperRef[];
const fetched = await paperTexts(papers, join(cacheDir, "papers"), {
  offline: opt.offline,
  log,
});
for (const { key, text } of fetched) runs.push(...segment("paper", key, text));

for (const dir of opt.markdown ?? []) {
  const { readdirSync } = await import("node:fs");
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(d, e.name))
        : e.name.endsWith(".md")
          ? [join(d, e.name)]
          : [],
    );
  const files = walk(dir).sort();
  for (const file of files)
    runs.push(...segment("paper", file, readFileSync(file, "utf8")));
  log(`[sources] ${files.length} Markdown documents from ${dir}`);
}

// Deduplicate identical runs, keeping the first.
const seen = new Set<string>();
const uniqueRuns = runs.filter((r) => !seen.has(r.text) && seen.add(r.text));
log(`[segment] ${uniqueRuns.length} text runs`);

const toUnicodeMath = texToUnicodeMathConverter(cacheDir, {
  offline: opt.offline,
});
const stats: Record<string, number> = {};
const rows: TrainingRow[] = buildRows(uniqueRuns, toUnicodeMath, stats);
log(`[corpus] ${rows.length} rows ${JSON.stringify(stats)}`);

const labelled: TrainingRow[] = [];
for (const file of opt.labels ?? []) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Pick<TrainingRow, "text" | "labels">;
    labelled.push({
      text: row.text,
      labels: row.labels,
      weight: 1,
      kind: "labelled",
    });
  }
}
if (labelled.length) log(`[corpus] ${labelled.length} hand-labelled rows`);

const params = fitUnicodeMath(
  [...rows, ...labelled],
  { ...DEFAULT_FIT, epochs },
  log,
);
const bytes = encodeUnicodeMathParams(params);
writeFileSync(outFile, bytes);
const shipped = loadUnicodeMathParams(bytes);
log(
  `[encode] ${outFile}: ${bytes.length} bytes, ${shipped.overrides.size} overrides, ${shipped.left.size + shipped.right.size} pairs`,
);

// Fit on the hand labels, through the shipped decoder and runtime decoding.
if (labelled.length) {
  let regions = 0;
  let falseRegions = 0;
  let gold = 0;
  let hit = 0;
  for (const row of labelled) {
    const found = findUnicodeMath(shipped, row.text);
    regions += found.length;
    falseRegions += found.filter(
      ([s, e]) => !row.labels.some(([a, b]) => Math.min(b, e) > Math.max(a, s)),
    ).length;
    for (const [a, b, k] of row.labels) {
      if (k !== "math") continue;
      gold++;
      if (
        found.some(([s, e]) => {
          const inter = Math.max(0, Math.min(b, e) - Math.max(a, s));
          return inter / (Math.max(b, e) - Math.min(a, s)) >= 0.5;
        })
      ) {
        hit++;
      }
    }
  }
  const precision = 1 - falseRegions / Math.max(1, regions);
  log(
    `[fit] labelled rows: region precision ${precision.toFixed(3)} (${falseRegions} false of ${regions}), math-span recall ${(hit / Math.max(1, gold)).toFixed(3)} (training fit, not held-out)`,
  );
}
commentary(
  `Wrote ${bytes.length}-byte recognizer parameters to \`${outFile}\` from ${sessions.length} session messages and ${fetched.length} papers. Run the server tests and review recognition before committing.`,
);
