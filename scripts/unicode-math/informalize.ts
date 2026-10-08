/**
 * Turn UnicodeMath (from UnicodeMathML's MathMLtoUnicodeMath) into the
 * informal dialect agents write in prose: ASCII letters, TeX-braced or
 * Unicode scripts, optional spaces around operators, `.05` for `0.05`.
 * Every choice comes from a seeded generator so a corpus build is
 * reproducible. Returns null for constructs agents do not write inline
 * (matrices, build-up internals); the caller drops that example.
 */

export type Random = () => number;

/** mulberry32: a small, exact 32-bit generator. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUP: Readonly<Record<string, string>> = {
  0: "⁰",
  1: "¹",
  2: "²",
  3: "³",
  4: "⁴",
  5: "⁵",
  6: "⁶",
  7: "⁷",
  8: "⁸",
  9: "⁹",
  "+": "⁺",
  "−": "⁻",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  i: "ⁱ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  n: "ⁿ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
  T: "ᵀ",
};
const SUB: Readonly<Record<string, string>> = {
  0: "₀",
  1: "₁",
  2: "₂",
  3: "₃",
  4: "₄",
  5: "₅",
  6: "₆",
  7: "₇",
  8: "₈",
  9: "₉",
  "+": "₊",
  "−": "₋",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
};
const SUP_DIGIT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SUP).map(([plain, sup]) => [sup, plain]),
);

const REJECT = /[⬚〖〗├┤■⒨⒱█▭▢⟡⬄⇳⬍⬆⬇⬌□Ⓐ✎☁⫷⫸@&┬┴]/u;
const RELATION = /[=≠<>≤≥≈≡∼≃≅∝∈∉⊂⊆⊃⊇→←↔⇒⇔↦≪≫∣]/u;
const BINARY = /[+−±∓×·⋅∘∪∩∧∨⊕⊗]/u;

function foldLetter(ch: string, keepFancy: boolean): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x210e) return "h";
  if (cp < 0x1d400 || cp > 0x1d7ff) return ch;
  const doubleStruck = cp >= 0x1d538 && cp <= 0x1d56b;
  return doubleStruck && keepFancy ? ch : ch.normalize("NFKC");
}

// Script argument starting at i (just after ^ or _): a parenthesised group
// or one operand token. Returns [content, endIndex].
function scriptArg(s: string, i: number): [string, number] | null {
  if (s[i] === "(") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")" && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return null;
  }
  const m = /^(?:[−-]?[\p{L}\p{N}∞′]+|.)/u.exec(s.slice(i));
  return m ? [m[0], i + m[0].length] : null;
}

function writeScript(marker: string, arg: string, random: Random): string {
  const table = marker === "^" ? SUP : SUB;
  const chars = [...arg];
  if (chars.length <= 3 && chars.every((c) => table[c]) && random() < 0.45) {
    return chars.map((c) => table[c]).join("");
  }
  const single =
    chars.length === 1 || /^\d+$/.test(arg) || /^[A-Za-z]$/.test(arg);
  const r = random();
  if (single) {
    if (r < 0.75) return marker + arg;
    return r < 0.95 ? `${marker}{${arg}}` : `${marker}(${arg})`;
  }
  return r < 0.8 ? `${marker}{${arg}}` : `${marker}(${arg})`;
}

// Script contents get the same script rewriting but no operator spacing.
function informalizeInner(arg: string, random: Random): string {
  let out = "";
  for (let i = 0; i < arg.length; ) {
    const ch = arg.charAt(i);
    if ((ch === "^" || ch === "_") && i > 0) {
      const inner = scriptArg(arg, i + 1);
      if (!inner) return arg;
      out += writeScript(ch, inner[0], random);
      i = inner[1];
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Spaces around top-level relations and binary operators, outside scripts.
function spaceOperators(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === "{" || ch === "(") depth++;
    if (ch === "}" || ch === ")") depth = Math.max(0, depth - 1);
    const prev = s.charAt(i - 1);
    const unary = /[−+-]/.test(ch) && (i === 0 || /[(=,{\s^_]/.test(prev));
    out +=
      depth === 0 && !unary && (RELATION.test(ch) || BINARY.test(ch))
        ? ` ${ch} `
        : ch;
  }
  return out;
}

export function informalize(
  unicodeMath: string,
  random: Random,
): string | null {
  if (REJECT.test(unicodeMath)) return null;
  const keepFancy = random() < 0.4;
  let s = [...unicodeMath].map((c) => foldLetter(c, keepFancy)).join("");
  // Function application becomes a space; other invisible operators vanish.
  s = s.replace(/[⁡-⁤​]/g, (c) => (c === "⁡" ? " " : ""));
  s = s.replace(/"([^"]*)"/g, "$1").replace(/▒/g, " ");
  // Unicode superscripts KaTeX already produced: sometimes spell as ^n.
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, (run) =>
    random() < 0.35
      ? `^${[...run].map((c) => SUP_DIGIT[c] ?? c).join("")}`
      : run,
  );
  let out = "";
  for (let i = 0; i < s.length; ) {
    const ch = s.charAt(i);
    if ((ch === "^" || ch === "_") && i > 0) {
      const arg = scriptArg(s, i + 1);
      if (!arg) return null;
      out += writeScript(ch, informalizeInner(arg[0], random), random);
      i = arg[1];
      continue;
    }
    out += ch;
    i++;
  }
  if (random() < 0.4) out = out.replace(/−/g, "-");
  if (random() < 0.3) out = out.replace(/(^|[^\d.])0\.(\d)/g, "$1.$2");
  if (random() < 0.5) out = spaceOperators(out);
  return out.replace(/\s+/g, " ").trim() || null;
}
