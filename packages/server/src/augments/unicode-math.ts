/**
 * Presentation for Unicode superscript and subscript characters in prose,
 * as in math written without TeX: `1/nˢ`, `x⁻ˢ`, `∫₁^∞`.
 *
 * These code points are small, unevenly sized glyphs in most text fonts; the
 * modifier letters (ˢ, ᵏ) are worst. Each run is redrawn as an ordinary
 * script of the plain characters, carried in `data-ya-script` for a CSS
 * pseudo-element. The authored characters stay in the DOM unchanged, so
 * selection, copy and source mapping see exactly what was written.
 *
 * This is a per-character table, not a parser: notation such as `Σ_{n≥1}`
 * stays literal. Converting informal Unicode math to typeset math belongs to
 * an established linear format (UnicodeMath), not ad-hoc rules here.
 */

const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "−",
  "⁼": "=",
  "⁽": "(",
  "⁾": ")",
  ᵃ: "a",
  ᵇ: "b",
  ᶜ: "c",
  ᵈ: "d",
  ᵉ: "e",
  ᶠ: "f",
  ᵍ: "g",
  ʰ: "h",
  ⁱ: "i",
  ʲ: "j",
  ᵏ: "k",
  ˡ: "l",
  ᵐ: "m",
  ⁿ: "n",
  ᵒ: "o",
  ᵖ: "p",
  ʳ: "r",
  ˢ: "s",
  ᵗ: "t",
  ᵘ: "u",
  ᵛ: "v",
  ʷ: "w",
  ˣ: "x",
  ʸ: "y",
  ᶻ: "z",
  ᴬ: "A",
  ᴮ: "B",
  ᴰ: "D",
  ᴱ: "E",
  ᴳ: "G",
  ᴴ: "H",
  ᴵ: "I",
  ᴶ: "J",
  ᴷ: "K",
  ᴸ: "L",
  ᴹ: "M",
  ᴺ: "N",
  ᴼ: "O",
  ᴾ: "P",
  ᴿ: "R",
  ᵀ: "T",
  ᵁ: "U",
  ⱽ: "V",
  ᵂ: "W",
  ᵅ: "α",
  ᵝ: "β",
  ᵞ: "γ",
  ᵟ: "δ",
  ᵋ: "ε",
  ᶿ: "θ",
  ᶥ: "ι",
  ᶲ: "ϕ",
  ᵠ: "φ",
  ᵡ: "χ",
};

const SUBSCRIPTS: Readonly<Record<string, string>> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "−",
  "₌": "=",
  "₍": "(",
  "₎": ")",
  ₐ: "a",
  ₑ: "e",
  ₕ: "h",
  ᵢ: "i",
  ⱼ: "j",
  ₖ: "k",
  ₗ: "l",
  ₘ: "m",
  ₙ: "n",
  ₒ: "o",
  ₚ: "p",
  ᵣ: "r",
  ₛ: "s",
  ₜ: "t",
  ᵤ: "u",
  ᵥ: "v",
  ₓ: "x",
  ᵦ: "β",
  ᵧ: "γ",
  ᵨ: "ρ",
  ᵩ: "φ",
  ᵪ: "χ",
};

type ScriptKind = "sup" | "sub";

const SUP_CLASS = Object.keys(SUPERSCRIPTS).join("");
const SUB_CLASS = Object.keys(SUBSCRIPTS).join("");
const SCRIPT_RUN_SOURCE = `[${SUP_CLASS}]+|[${SUB_CLASS}]+`;
const SCRIPT_RUN = new RegExp(SCRIPT_RUN_SOURCE, "gu");
const HAS_SCRIPT_RUN = new RegExp(SCRIPT_RUN_SOURCE, "u");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainScript(run: string): { kind: ScriptKind; plain: string } {
  const table =
    SUPERSCRIPTS[run[0] ?? ""] === undefined ? SUBSCRIPTS : SUPERSCRIPTS;
  const kind: ScriptKind = table === SUPERSCRIPTS ? "sup" : "sub";
  const plain = Array.from(run, (char) => table[char] ?? char).join("");
  return { kind, plain };
}

/** Escape one prose text run as HTML, redrawing its Unicode script runs. */
export function renderUnicodeScripts(text: string): string {
  if (!HAS_SCRIPT_RUN.test(text)) return escapeHtml(text);
  let html = "";
  let last = 0;
  for (const match of text.matchAll(SCRIPT_RUN)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index));
    const { kind, plain } = plainScript(match[0]);
    html += `<span class="ya-uscript ya-uscript--${kind}" data-ya-script="${escapeHtml(plain)}"><span class="ya-uscript__source">${escapeHtml(match[0])}</span></span>`;
    last = index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}
