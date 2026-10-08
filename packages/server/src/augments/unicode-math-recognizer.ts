/**
 * Recognise undelimited math in prose: Unicode math and TeX-like scripts
 * that agents write without `$…$`, such as `ζ(s) = Σ_{n≥1} 1/nˢ` or
 * `λ=.05`. Runs in linear time: classify characters, run a two-pass heat
 * field, then snap the result to whitespace tokens. The trained, quantised
 * parameters live in `unicode-math-params.ts`; the training pipeline and
 * evaluation are recorded in gaps/sketches/unicode-prose-math.md.
 *
 * Field: F(i) = h(i) + d(i)·F(i−1) and B(i) = h(i) + d(i)·B(i+1), with
 * H(i) = F(i) + B(i) − h(i) and p(i) = σ(H(i) − θ). Heat h(i) is the class
 * heat plus a per-code-point override plus left/right neighbour-class pair
 * heat; the decay d(i) = σ(class decay logit + override).
 */

const PUNCT = "()[]{}=+-*/<>|,.:;!?'\"~\\";
const CLASSES: readonly string[] = [
  "space",
  "l1",
  "L1",
  "l2",
  "l3",
  "word",
  "fn",
  "ident",
  "digits",
  "sub-mark",
  "underscore",
  "sup-mark",
  "caret",
  ...[...PUNCT].map((c) => `ascii${c}`),
  "ascii-other",
  "greek",
  "script",
  "big-op",
  "arrow",
  "math-symbol",
  "math-other",
  "math-letter",
  "letter-other",
  "punct-other",
  "other",
  "surrogate-tail",
];
const K = CLASSES.length;
const C: Readonly<Record<string, number>> = Object.fromEntries(
  CLASSES.map((name, i) => [name, i]),
);
const cls = (name: string): number => {
  const id = C[name];
  if (id === undefined) throw new Error(`unknown class ${name}`);
  return id;
};
const SPACE = cls("space");
const TAIL = cls("surrogate-tail");

/** Multi-letter words that are function names inside math. */
export const FUNCTION_NAMES: ReadonlySet<string> = new Set(
  "sin cos tan sec csc cot sinh cosh tanh arcsin arccos arctan log ln lg exp lim max min sup inf det dim arg ker deg gcd lcm mod Re Im Pr tr sgn argmax argmin softmax erf var cov".split(
    " ",
  ),
);

const RE = {
  greek: /\p{Script=Greek}/u,
  script: /[⁰-₟ᴬ-ᶿⱼⱽ]/u,
  bigOp: /[∑∏∐∫∬∭∮∯∰⋀⋁⋂⋃⨀⨁⨂⨄⨆]/u,
  arrow: /[←-⇿⟰-⟿⤀-⥿]/u,
  sm: /\p{Sm}/u,
  math: /\p{Math}/u,
  letter: /\p{L}/u,
  punct: /\p{P}/u,
};

function nonAsciiClass(ch: string, cp: number): number {
  if (RE.bigOp.test(ch)) return cls("big-op");
  if (RE.script.test(ch)) return cls("script");
  if (RE.greek.test(ch)) return cls("greek");
  if ((cp >= 0x1d400 && cp <= 0x1d7ff) || (cp >= 0x2100 && cp <= 0x214f)) {
    return cls("math-letter");
  }
  if (RE.arrow.test(ch)) return cls("arrow");
  if (RE.sm.test(ch)) return cls("math-symbol");
  if (RE.math.test(ch)) return cls("math-other");
  if (RE.letter.test(ch)) return cls("letter-other");
  if (RE.punct.test(ch)) return cls("punct-other");
  return cls("other");
}

const isGreekLetter = (ch: string) => RE.greek.test(ch) && RE.letter.test(ch);
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isDigit = (c: number) => c >= 48 && c <= 57;

function letterRunClass(text: string, i: number, j: number): number {
  const len = j - i;
  const before = text.charCodeAt(i - 1);
  const after = text.charCodeAt(j);
  const identifier =
    len >= 3 &&
    (before === 95 || after === 95 || isDigit(before) || isDigit(after));
  if (FUNCTION_NAMES.has(text.slice(i, j))) return cls("fn");
  if (identifier) return cls("ident");
  if (len === 1) return text.charCodeAt(i) <= 90 ? cls("L1") : cls("l1");
  if (len === 2) return cls("l2");
  return len === 3 ? cls("l3") : cls("word");
}

// `_`/`^` are script markers only after a short operand that starts a
// word (in `TNMV_8_5_x_0` the `x` belongs to an identifier) and before an
// argument.
function scriptMarker(text: string, i: number): boolean {
  let s = i - 1;
  while (s >= 0 && isLetter(text.charCodeAt(s))) s--;
  const letters = i - 1 - s;
  const l = text.charCodeAt(i - 1);
  const r = text.charCodeAt(i + 1);
  const sc = text.charCodeAt(s);
  if (letters && (sc === 95 || isDigit(sc))) return false;
  const operand =
    (letters >= 1 && letters <= 2) ||
    isDigit(l) ||
    l === 41 ||
    l === 93 ||
    l === 125 ||
    l > 127;
  const argument =
    isLetter(r) || isDigit(r) || r === 123 || r === 40 || r === 45 || r > 127;
  return operand && argument;
}

/** Per UTF-16 unit: class id, and the code point for override lookup. */
function classify(text: string): { cls: Uint8Array; cps: Uint32Array } {
  const n = text.length;
  const out = new Uint8Array(n);
  const cps = new Uint32Array(n);
  for (let i = 0; i < n; ) {
    const c = text.charCodeAt(i);
    if (isLetter(c)) {
      let j = i;
      while (j < n && isLetter(text.charCodeAt(j))) j++;
      out.fill(letterRunClass(text, i, j), i, j);
      i = j;
    } else if (isDigit(c)) {
      out[i++] = cls("digits");
    } else if (c === 32 || c === 9) {
      out[i++] = SPACE;
    } else if (c === 95 || c === 94) {
      const marker = scriptMarker(text, i);
      out[i++] =
        c === 95
          ? cls(marker ? "sub-mark" : "underscore")
          : cls(marker ? "sup-mark" : "caret");
    } else if (c < 128) {
      const ch = text.charAt(i);
      out[i++] = PUNCT.includes(ch) ? cls(`ascii${ch}`) : cls("ascii-other");
    } else {
      // Three or more Greek letters in a row are a Greek word.
      let j = i;
      while (j < n && isGreekLetter(text.charAt(j))) j++;
      if (j - i >= 3) {
        out.fill(cls("letter-other"), i, j);
        i = j;
        continue;
      }
      const cp = text.codePointAt(i) ?? c;
      out[i] = nonAsciiClass(String.fromCodePoint(cp), cp);
      cps[i] = cp;
      if (cp > 0xffff) out[i + 1] = TAIL;
      i += cp > 0xffff ? 2 : 1;
    }
  }
  return { cls: out, cps };
}

/** Compact parameter file as written by the trainer. */
export interface UnicodeMathParamsJson {
  step: number;
  theta: number;
  heat: string;
  decay: string;
  over: string;
  left: string;
  right: string;
}

export interface UnicodeMathParams {
  heat: Float64Array;
  decay: Float64Array;
  overrides: Map<number, readonly [number, number]>;
  left: Map<number, number>;
  right: Map<number, number>;
  theta: number;
}

export function loadUnicodeMathParams(
  json: UnicodeMathParamsJson,
): UnicodeMathParams {
  const { step } = json;
  const nums = (s: string) =>
    Float64Array.from(s.split(" "), (x) => Number(x) * step);
  const pairs = (s: string) => {
    const map = new Map<number, number>();
    for (const entry of s ? s.split(" ") : []) {
      const [ab = "", v = "0"] = entry.split(":");
      const [a = 0, b = 0] = ab.split(".").map((x) => Number.parseInt(x, 36));
      map.set(a * K + b, Number(v) * step);
    }
    return map;
  };
  const overrides = new Map<number, readonly [number, number]>();
  for (const entry of json.over ? json.over.split(" ") : []) {
    const cp = entry.codePointAt(0) ?? 0;
    const [dh = 0, du = 0] = entry
      .slice(cp > 0xffff ? 2 : 1)
      .split(",")
      .map((x) => Number(x) * step);
    overrides.set(cp, [dh, du]);
  }
  const heat = nums(json.heat);
  const decay = nums(json.decay);
  if (heat.length !== K || decay.length !== K) {
    throw new Error("unicode math parameters: class table mismatch");
  }
  return {
    heat,
    decay,
    overrides,
    left: pairs(json.left),
    right: pairs(json.right),
    theta: json.theta * step,
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Per-character probability that the character belongs to math. */
export function mathScores(
  params: UnicodeMathParams,
  text: string,
): Float64Array {
  const { cls: classes, cps } = classify(text);
  const n = classes.length;
  const h = new Float64Array(n);
  const d = new Float64Array(n);
  const next = new Uint8Array(n);
  let following = SPACE;
  for (let i = n - 1; i >= 0; i--) {
    next[i] = following;
    if (classes[i] !== TAIL) following = classes[i] ?? SPACE;
  }
  let previous = SPACE;
  for (let i = 0; i < n; i++) {
    const k = classes[i] ?? SPACE;
    if (k === TAIL) {
      d[i] = 1;
      continue;
    }
    let heat =
      (params.heat[k] ?? 0) +
      (params.left.get(previous * K + k) ?? 0) +
      (params.right.get(k * K + (next[i] ?? SPACE)) ?? 0);
    let decay = params.decay[k] ?? 0;
    const override = cps[i] ? params.overrides.get(cps[i] ?? 0) : undefined;
    if (override) {
      heat += override[0];
      decay += override[1];
    }
    h[i] = heat;
    d[i] = sigmoid(decay);
    previous = k;
  }
  const p = new Float64Array(n);
  let f = 0;
  for (let i = 0; i < n; i++) {
    f = (h[i] ?? 0) + (d[i] ?? 0) * f;
    p[i] = f;
  }
  let b = 0;
  for (let i = n - 1; i >= 0; i--) {
    b = (h[i] ?? 0) + (d[i] ?? 0) * b;
    p[i] = sigmoid((p[i] ?? 0) + b - (h[i] ?? 0) - params.theta);
  }
  return p;
}

const EDGE_ARROW = /[←-⇿⟵-⟿\s]/u;
// Nothing to typeset: numbers with units, signs, ranges, multipliers or
// arrows between them (`64,292`, `4–6×`, `60→110→1,833`).
const NUMERIC_ONLY = /^[\d\s.,%×±~≈+−\-–kKMB←-⇿]*$/u;
// One symbol alone, possibly primed (`B′`, `λ`): a name or a variable
// mention, not worth typesetting on its own.
const LONE_SYMBOL = /^\p{L}[′″'*]?$/u;

function trimRegion(
  text: string,
  start: number,
  end: number,
): [number, number] | null {
  for (;;) {
    const was = [start, end];
    while (end > start && /[.,;:!?]/.test(text.charAt(end - 1))) end--;
    while (start < end && /[,;:!?]/.test(text.charAt(start))) start++;
    while (end > start && EDGE_ARROW.test(text.charAt(end - 1))) end--;
    while (start < end && EDGE_ARROW.test(text.charAt(start))) start++;
    if (was[0] === start && was[1] === end) break;
  }
  const body = text.slice(start, end);
  const typesettable =
    /[\p{L}\p{N}]/u.test(body) &&
    !NUMERIC_ONLY.test(body) &&
    !LONE_SYMBOL.test(body);
  return typesettable ? [start, end] : null;
}

export interface MathThresholds {
  /** A region must contain a token scoring at least this. */
  high: number;
  /** A region extends over neighbouring tokens scoring at least this. */
  low: number;
}

/** Precision-first operating point selected on the development sets. */
export const DEFAULT_MATH_THRESHOLDS: MathThresholds = { high: 0.98, low: 0.5 };

/**
 * Math regions in `text` as [start, end) UTF-16 offsets: maximal runs of
 * whitespace tokens each scoring at least `low` and containing a token
 * scoring at least `high`, where a token scores the maximum over its
 * characters. Edge punctuation and arrows are trimmed and regions with
 * nothing to typeset are dropped.
 */
export function findUnicodeMath(
  params: UnicodeMathParams,
  text: string,
  { high, low }: MathThresholds = DEFAULT_MATH_THRESHOLDS,
): [number, number][] {
  const p = mathScores(params, text);
  const tokens: { start: number; end: number; score: number; word: string }[] =
    [];
  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index;
    const end = start + match[0].length;
    let score = 0;
    for (let i = start; i < end; i++) score = Math.max(score, p[i] ?? 0);
    tokens.push({ start, end, score, word: match[0] });
  }
  const regions: [number, number][] = [];
  for (let i = 0; i < tokens.length; ) {
    if ((tokens[i]?.score ?? 0) < low) {
      i++;
      continue;
    }
    let j = i;
    let peak = 0;
    for (; j < tokens.length && (tokens[j]?.score ?? 0) >= low; j++) {
      peak = Math.max(peak, tokens[j]?.score ?? 0);
    }
    let s = i;
    let e = j;
    while (s < e && /^[aAI]$/.test(tokens[s]?.word ?? "")) s++;
    while (e > s && /^[aAI]$/.test(tokens[e - 1]?.word ?? "")) e--;
    const first = tokens[s];
    const last = tokens[e - 1];
    if (peak >= high && first && last && e > s) {
      const region = trimRegion(text, first.start, last.end);
      if (region) regions.push(region);
    }
    i = j;
  }
  return regions;
}

/**
 * Adapt a recognised region for KaTeX, which already reads Unicode math
 * (Greek, operators, Unicode sub- and superscripts). Fold exotic spaces,
 * which KaTeX has no metrics for, to plain spaces. Escape TeX's special
 * characters, read `~` as "approximately", read Greek Σ and Π carrying
 * limits as summation and product, brace multi-character script
 * arguments (`Δ_benefit` → `Δ_{benefit}`, `x^-s` → `x^{-s}`), and set
 * function names upright.
 */
export function unicodeMathToKatexSource(region: string): string {
  return region
    .replace(/[  -   　]/g, " ")
    .replace(/[%#&$]/g, (c) => `\\${c}`)
    .replace(/~/g, "\\sim ")
    .replace(/Σ(?=[_^])/g, "\\sum")
    .replace(/Π(?=[_^])/g, "\\prod")
    .replace(
      /([_^])([-−+]?[A-Za-z0-9\p{Script=Greek}]{2,}|[-−+][A-Za-z0-9\p{Script=Greek}])/gu,
      "$1{$2}",
    )
    .replace(/(?<![\\A-Za-z])[A-Za-z]+/g, (word) =>
      word.length > 1 && FUNCTION_NAMES.has(word)
        ? `\\operatorname{${word}}`
        : word,
    );
}
