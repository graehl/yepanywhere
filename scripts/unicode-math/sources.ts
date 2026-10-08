/**
 * Training text sources for the Unicode prose-math recognizer:
 * - assistant prose from local Claude and Codex session logs;
 * - arXiv papers from a pinned list, fetched as HTML (inline math carries
 *   its TeX in `alttext`) and cached;
 * and segmentation of either into the text runs YA's Markdown renderer
 * sees, using the same parser and KaTeX plugin options as the server.
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline";

const serverRequire = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const clientRequire = createRequire(
  new URL("../../packages/client/package.json", import.meta.url),
);

// The small surfaces used from packages resolved through the workspace.
interface DomNode {
  textContent: string | null;
  getAttribute(name: string): string | null;
  replaceWith(node: unknown): void;
  querySelectorAll(selector: string): Iterable<DomNode>;
}
interface JsdomModule {
  JSDOM: new (
    html: string,
  ) => {
    window: {
      document: DomNode & { createTextNode(text: string): unknown };
    };
  };
}
interface KatexModule {
  renderToString(tex: string, options: Record<string, unknown>): string;
}

export interface TextRun {
  src: string;
  /** Document identity, for deterministic sampling. */
  doc: string;
  text: string;
  /** Delimited TeX spans: [start, end, delimiter, tex]. */
  spans: [number, number, string, string][];
}

// --- Session logs -------------------------------------------------------

function* jsonlFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(path);
    else if (entry.name.endsWith(".jsonl")) yield path;
  }
}

function assistantTexts(record: Record<string, unknown>): string[] {
  const texts: string[] = [];
  const push = (content: unknown, type: string) => {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      const p = part as { type?: string; text?: unknown };
      if (p.type === type && typeof p.text === "string") texts.push(p.text);
    }
  };
  // Claude Code transcript line.
  const message = record.message as { content?: unknown } | undefined;
  if (record.type === "assistant") push(message?.content, "text");
  // Codex rollout line.
  const payload = record.payload as
    | { role?: string; content?: unknown }
    | undefined;
  if (record.type === "response_item" && payload?.role === "assistant") {
    push(payload.content, "output_text");
  }
  return texts;
}

/** Unique assistant text blocks from session logs under `dirs`. */
export async function sessionTexts(
  dirs: readonly string[],
  log: (line: string) => void,
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    const before = out.length;
    let files = 0;
    for (const file of jsonlFiles(dir)) {
      files++;
      const lines = createInterface({
        input: createReadStream(file),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (!line.includes('"assistant"')) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue; // a partially written trailing line
        }
        for (const text of assistantTexts(record)) {
          if (text.length < 20) continue;
          const key = createHash("sha1").update(text).digest("base64");
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(text);
        }
      }
    }
    log(`[sources] ${dir}: ${files} logs, ${out.length - before} new messages`);
  }
  return out;
}

// --- arXiv papers -------------------------------------------------------

export type { KatexModule };

export interface PaperRef {
  key: string;
  arxiv: string;
}

const PAPER_SOURCES = [
  (id: string) => `https://arxiv.org/html/${id}`,
  (id: string) => `https://ar5iv.labs.arxiv.org/html/${id}`,
];
const USER_AGENT = "yep-anywhere unicode-math retrain (scripts/unicode-math)";
// arXiv asks automated clients to keep to about one request per 3 seconds.
const REQUEST_GAP_MS = 3000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Paper text as Markdown-like paragraphs with inline math as `\(…\)`.
 * Fetched HTML is cached under `cacheDir`; with `offline`, only cached
 * papers are used.
 */
export async function paperTexts(
  papers: readonly PaperRef[],
  cacheDir: string,
  { offline, log }: { offline: boolean; log: (line: string) => void },
): Promise<{ key: string; text: string }[]> {
  mkdirSync(cacheDir, { recursive: true });
  const { JSDOM } = clientRequire("jsdom") as JsdomModule;
  const out: { key: string; text: string }[] = [];
  let fetched = 0;
  let missing = 0;
  for (const paper of papers) {
    const cached = join(cacheDir, `${paper.arxiv}.html`);
    if (!existsSync(cached)) {
      if (offline) {
        missing++;
        continue;
      }
      let html: string | null = null;
      for (const url of PAPER_SOURCES) {
        if (fetched++) await wait(REQUEST_GAP_MS);
        const response = await fetch(url(paper.arxiv), {
          headers: { "User-Agent": USER_AGENT },
        });
        if (response.ok) {
          html = await response.text();
          break;
        }
      }
      if (html === null) {
        log(`[papers] no HTML for ${paper.key} (${paper.arxiv})`);
        missing++;
        continue;
      }
      writeFileSync(cached, html);
    }
    const document = new JSDOM(readFileSync(cached, "utf8")).window.document;
    const paragraphs: string[] = [];
    for (const p of document.querySelectorAll(".ltx_p")) {
      for (const math of p.querySelectorAll("math")) {
        const tex = math.getAttribute("alttext") ?? "";
        math.replaceWith(document.createTextNode(` \\(${tex}\\) `));
      }
      const text = (p.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) paragraphs.push(text);
    }
    out.push({ key: paper.key, text: paragraphs.join("\n\n") });
  }
  log(`[papers] ${out.length} papers ready, ${missing} unavailable`);
  return out;
}

// --- Segmentation -------------------------------------------------------

const MAX_RUN = 2000;
const CLOSE: Readonly<Record<string, string>> = {
  $: "$",
  $$: "$$",
  "\\(": "\\)",
  "\\[": "\\]",
};

interface MarkdownToken {
  type: string;
  markup: string;
  content: string;
  info: string;
  children: MarkdownToken[] | null;
}

export function createSegmenter() {
  const MarkdownIt = serverRequire("markdown-it") as new (
    options: Record<string, unknown>,
  ) => {
    use(plugin: unknown, options: Record<string, unknown>): unknown;
    parse(src: string, env: object): MarkdownToken[];
  };
  const katex = serverRequire("katex") as KatexModule;
  const { katex: katexPlugin } = serverRequire("@mdit/plugin-katex") as {
    katex: unknown;
  };
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  // The server's math options (packages/server/src/augments/safe-markdown.ts).
  md.use(katexPlugin, {
    delimiters: "all",
    allowInlineWithSpace: false,
    mathFence: false,
    throwOnError: false,
  });
  const valid = (tex: string, display: boolean) => {
    if (!tex.trim()) return false;
    // KaTeX reports glyphs without metrics only through console.warn; they
    // do not make the TeX invalid.
    const warn = console.warn;
    console.warn = () => {};
    try {
      katex.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        strict: false,
      });
      return true;
    } catch {
      return false;
    } finally {
      console.warn = warn;
    }
  };

  function* inlineRuns(
    children: readonly MarkdownToken[],
  ): Generator<[string, TextRun["spans"]]> {
    let text = "";
    let spans: TextRun["spans"] = [];
    function* flush(): Generator<[string, TextRun["spans"]]> {
      const lead = text.length - text.trimStart().length;
      const run = text.trim();
      if (run.length >= 3 && run.length <= MAX_RUN) {
        yield [
          run,
          spans
            .map(
              ([s, e, k, t]) =>
                [s - lead, e - lead, k, t] as [number, number, string, string],
            )
            .filter(([s, e]) => s >= 0 && e <= run.length),
        ];
      }
      text = "";
      spans = [];
    }
    for (const c of children) {
      if (c.type === "text") text += c.content;
      else if (c.type === "softbreak" || c.type === "hardbreak") text += " ";
      else if (c.type === "math_inline") {
        const raw = `${c.markup}${c.content}${CLOSE[c.markup] ?? c.markup}`;
        if (valid(c.content, false)) {
          spans.push([
            text.length,
            text.length + raw.length,
            c.markup,
            c.content,
          ]);
        }
        text += raw;
      } else if (
        c.type === "code_inline" ||
        c.type === "html_inline" ||
        c.type === "image"
      ) {
        yield* flush();
      }
    }
    yield* flush();
  }

  /**
   * Text runs of one Markdown document: prose runs (with delimited math
   * spans), display-math blocks as whole-run spans, and code lines with
   * `src` suffixed `-code`.
   */
  return function segment(
    src: string,
    doc: string,
    markdown: string,
  ): TextRun[] {
    const runs: TextRun[] = [];
    let tokens: MarkdownToken[];
    try {
      tokens = md.parse(markdown, {});
    } catch {
      return runs;
    }
    for (const t of tokens) {
      if (t.type === "inline") {
        for (const [text, spans] of inlineRuns(t.children ?? [])) {
          runs.push({ src, doc, text, spans });
        }
      } else if (t.type === "math_block") {
        const tex = t.content.trim().replace(/\s*\n\s*/g, " ");
        if (
          tex.length <= MAX_RUN &&
          !tex.includes("\\begin") &&
          valid(tex, true)
        ) {
          runs.push({
            src,
            doc,
            text: tex,
            spans: [[0, tex.length, "block", tex]],
          });
        }
      } else if (
        (t.type === "fence" && !/\b(math|latex|tex|katex)\b/i.test(t.info)) ||
        t.type === "code_block"
      ) {
        for (const line of t.content.split("\n")) {
          const text = line.trim();
          if (text.length >= 3 && text.length <= MAX_RUN) {
            runs.push({ src: `${src}-code`, doc, text, spans: [] });
          }
        }
      }
    }
    return runs;
  };
}
