/**
 * Labelled training rows for the Unicode prose-math recognizer.
 *
 * Delimited TeX in real prose is converted to the informal Unicode that
 * agents write without delimiters (TeX → KaTeX MathML → UnicodeMathML's
 * MathMLtoUnicodeMath → informalize) and spliced back, so the span labels
 * are exact and the surrounding prose supplies negatives. Prose without
 * TeX contributes negatives: a 1-in-8 sample of runs with no math
 * character, down-weighted session runs whose only "hot" characters are
 * common in prose, and a 1-in-4 sample of code lines.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import { informalize, seededRandom } from "./informalize.js";
import type { KatexModule, TextRun } from "./sources.js";

const serverRequire = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const clientRequire = createRequire(
  new URL("../../packages/client/package.json", import.meta.url),
);

export type LabelClass = "math" | "soft" | "ignore";
export interface TrainingRow {
  text: string;
  labels: [number, number, LabelClass][];
  weight: number;
  kind: string;
}

// UnicodeMathML (MIT), pinned; only MathMLtoUnicodeMath is used.
const UNICODEMATHML_REPO = "https://github.com/MurrayIII/UnicodeMathML";
export const UNICODEMATHML_COMMIT = "636dc8f7b2cb59805ac5f8042adb150130a28605";

/** Clone (once) and load UnicodeMathML; returns TeX → UnicodeMath. */
export function texToUnicodeMathConverter(
  cacheDir: string,
  { offline }: { offline: boolean },
): (tex: string, display: boolean) => string {
  const checkout = join(
    cacheDir,
    `UnicodeMathML-${UNICODEMATHML_COMMIT.slice(0, 8)}`,
  );
  if (!existsSync(join(checkout, "src/unicodemathml.js"))) {
    if (offline) throw new Error(`UnicodeMathML is not cached at ${checkout}`);
    execFileSync("git", [
      "clone",
      "--quiet",
      "--filter=blob:none",
      UNICODEMATHML_REPO,
      checkout,
    ]);
    execFileSync("git", [
      "-C",
      checkout,
      "checkout",
      "--quiet",
      UNICODEMATHML_COMMIT,
    ]);
  }
  const { JSDOM } = clientRequire("jsdom") as {
    JSDOM: new (
      html: string,
    ) => { window: { DOMParser: unknown; Node: unknown; document: unknown } };
  };
  const katex = serverRequire("katex") as KatexModule;
  const { window } = new JSDOM("");
  const context: Record<string, unknown> = {
    console: { log() {}, warn() {}, error: console.error },
    performance,
    testing: true,
    ummlConfig: { texMacros: {} },
    DOMParser: window.DOMParser,
    Node: window.Node,
    document: window.document,
  };
  context.window = context;
  context.root = context;
  vm.createContext(context);
  vm.runInContext(
    readFileSync(join(checkout, "src/unicodemathml.js"), "utf8"),
    context,
    {
      filename: "unicodemathml.js",
    },
  );
  const toUnicodeMath = context.MathMLtoUnicodeMath as (
    mathml: string,
  ) => string;
  return (tex, display) => {
    // KaTeX's own warnings for missing glyph metrics are not errors here.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const html = katex.renderToString(tex, {
        output: "mathml",
        displayMode: display,
        throwOnError: true,
        strict: false,
      });
      return toUnicodeMath(
        html.replace(/^.*?(<math[\s\S]*<\/math>).*$/s, "$1"),
      );
    } finally {
      console.warn = warn;
    }
  };
}

// TeX used for typography agents write as plain text (numbers,
// percentages, a lone ± or ×) is ignored; a single symbol is "soft".
const TYPOGRAPHIC = /^[\d.,%\s]*[±×∼~<>≤≥+−-]?[\d.,%\s]*[kKMB]?$/u;
const SINGLE_SYMBOL = /^\p{L}$/u;
const labelClass = (math: string): LabelClass =>
  TYPOGRAPHIC.test(math)
    ? "ignore"
    : SINGLE_SYMBOL.test(math)
      ? "soft"
      : "math";

const HOT = /[\p{Math}\p{Script=Greek}⁰-₟ᴬ-ᶿ]/u;
const PROSE_HOT = /^[→←↔↑↓~×+=<>≥≤±|−^]$/u;
const STRUCTURAL = /[A-Za-z0-9)][_^][\w{(]|[\p{Script=Greek}∑∏∫√∞⁰-₟ᴬ-ᶿ]/u;

// In automatic negatives, arithmetic and assignments (`61 + 5×60 = 487`,
// `N = 173`) are math by the labelling guideline but unlabelled: mark runs
// of short operand/operator tokens containing an operator as ignore. A
// subscript underscore follows at most two letters, a digit or a bracket;
// `next_token` is a code identifier.
const OPERATOR =
  /[=+×−*/<>≤≥≈→←↔±~^|·∑Σ]|(?<![A-Za-z-])-(?![-A-Za-z])|(?<![A-Za-z]{2})[A-Za-z]_|[0-9)]_/u;
const SHORT_TOKEN = /^(?!.*[A-Za-z]{4})\S+$/u;

function ambiguousSpans(text: string): TrainingRow["labels"] {
  const tokens = [...text.matchAll(/\S+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    short: SHORT_TOKEN.test(m[0]) || OPERATOR.test(m[0]),
    op: OPERATOR.test(m[0]),
  }));
  const spans: TrainingRow["labels"] = [];
  for (let i = 0; i < tokens.length; ) {
    if (!tokens[i]?.short) {
      i++;
      continue;
    }
    let j = i;
    let op = false;
    for (; j < tokens.length && tokens[j]?.short; j++)
      if (tokens[j]?.op) op = true;
    const first = tokens[i];
    const last = tokens[j - 1];
    if (op && first && last) spans.push([first.start, last.end, "ignore"]);
    i = j;
  }
  return spans;
}

/** Turn segmented runs into weighted, labelled training rows. */
export function buildRows(
  runs: readonly TextRun[],
  toUnicodeMath: (tex: string, display: boolean) => string,
  stats: Record<string, number>,
): TrainingRow[] {
  const bump = (key: string) => {
    stats[key] = (stats[key] ?? 0) + 1;
  };
  const rows: TrainingRow[] = [];
  runs.forEach((run, id) => {
    const { src, text, spans } = run;
    if (src.endsWith("-code")) {
      if (id % 4) return;
      bump("code-negative");
      rows.push({
        text,
        labels: ambiguousSpans(text),
        weight: 0.5,
        kind: "code",
      });
      return;
    }
    const origin = src === "paper" ? "paper" : "session";
    if (spans.length) {
      const random = seededRandom(Math.imul(id, 2654435761));
      let built = "";
      const labels: TrainingRow["labels"] = [];
      let last = 0;
      for (const [start, end, kind, tex] of spans) {
        let math: string | null;
        try {
          math = informalize(toUnicodeMath(tex, kind === "block"), random);
        } catch {
          math = null;
        }
        if (!math) {
          bump(`${origin}:convert-failed`);
          return;
        }
        built += text.slice(last, start);
        labels.push([
          built.length,
          built.length + math.length,
          labelClass(math),
        ]);
        built += math;
        last = end;
      }
      built += text.slice(last);
      bump(`${origin}:${spans[0]?.[2] === "block" ? "block" : "inline"}`);
      rows.push({ text: built, labels, weight: 1, kind: "positive" });
      return;
    }
    const hot = [...text].filter((c) => HOT.test(c));
    if (!hot.length) {
      if (id % 8) return;
      bump(`${origin}:easy-negative`);
      rows.push({ text, labels: [], weight: 1, kind: "easy" });
    } else if (
      origin === "session" &&
      hot.every((c) => PROSE_HOT.test(c)) &&
      !STRUCTURAL.test(text)
    ) {
      bump("session:weak-negative");
      rows.push({
        text,
        labels: ambiguousSpans(text),
        weight: 0.3,
        kind: "weak",
      });
    } else {
      bump(`${origin}:unlabelled-skipped`);
    }
  });
  return rows;
}
