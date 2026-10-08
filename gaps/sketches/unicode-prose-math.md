# Typeset informal Unicode math in prose, as a scored opt-in

Agents often write math as Unicode prose with TeX-ish scripts rather than in
`$…$`: `ζ(s) = Σ_{n≥1} 1/nˢ`, `∫₁^∞ x⁻ˢ dx = 1/(s−1)`, `∏_p 1/(1 − p⁻ˢ)`.
YA now redraws the Unicode script characters legibly
([rich-text-rendering](../../topics/rich-text-rendering.md) § Unicode script
characters), but `_x`, `_{…}`, `^n` and big-operator limits stay literal, and
`Σ_{n≥1}` cannot stack its limits.

The wanted shape is a recognizer with heuristic or learned scoring of whether
a span is really math, feeding an existing structural converter, as a user
option. A handful of regexes is not it: hand-rolled limit parsing was tried
and withdrawn on 2026-10-08 for that reason.

## Prior art (checked 2026-10-08)

- **UnicodeMath** (Murray Sargent, Unicode Technical Note #28, version 3.2)
  is the specified linear format closest to what agents write:
  `∑_(n=1)^∞ 1/n^s`. Script arguments are parenthesised, not braced. Its
  § 5 "Recognizing Mathematical Expressions" describes zone detection only
  qualitatively: math characters (U+2200–22FF operators, math alphanumerics,
  combining symbol marks, slashes, characters with the Unicode Math
  property) identify themselves and their immediate neighbours as math;
  most single ASCII letters may start or continue a zone (`a`, `A`, `I` only
  before an operator, comma or period); letter pairs not on an English
  two-letter word list are math; whitespace-free strings containing an
  unambiguous math character are math; function names continue a zone; and
  non-mathematical characters suggest their neighbours are not math. It
  calls these "not foolproof" and gives no weights, scores or algorithm.
  The hot-character field below is a quantitative form of the same idea.
- **[UnicodeMathML](https://github.com/MurrayIII/UnicodeMathML)** (MIT; npm
  `unicodemathml` 1.0.7; repo at `636dc8f7`, 2026-10-06) converts
  UnicodeMath to MathML with a PEG grammar. Its math zones are explicitly
  delimited (`⁅ ⁆`), including in its markdown-it rule; it never finds math
  in undelimited prose. Reviewed in detail below.
- **[pylatexenc](https://github.com/phfaist/pylatexenc)**
  `unicode_to_latex` maps characters to TeX escapes without structure; not a
  fit.
- **Formula detection research** targets PDFs and page images, using layout
  and font features that plain text lacks (for example
  [CRF math-zone detection](https://dl.acm.org/doi/pdf/10.1145/3103010.3121041)).
  No library was found that detects undelimited math in plain text and
  scores it. That detector is the part YA would have to own.

## What UnicodeMathML offers, file by file

Paths are relative to the repository root at `636dc8f7`.

### The grammar cannot reject anything

`src/unicodemathml-parser.pegjs` (1277 lines) is a total grammar. The
`other` rule consumes any character that is not a build-up operator, every
ASCII letter is an operand (`For` parses as the product F·o·r), and an
incomplete script such as a trailing `^` returns a red-coloured error node
instead of failing. A comment records that strict operator/operand
alternation from the tech note was dropped as "overly restrictive". The
grammar therefore answers "how does this parse", never "is this math". It
also assumes the whole input is one zone, and backtracking PEG cost is high
enough that the source carries "⚡ performance optimization" reorderings.

Usable as:

- **the converter** once a zone is chosen (UnicodeMath → MathML; YA's
  sanitizer already admits presentation MathML); and
- **a verifier feature**: parse a candidate span and score the tree, for
  example the share of characters landing in structural nodes (`nary`,
  `script`, `fraction`, `bracketed`) versus `other` and multi-letter
  `atoms`, with a penalty for each error node.

### Harvestable tables (deterministic first-pass features)

- **Unicode math classes:** `playground/assets/charinfo.js` embeds UTR #25
  `MathClass` data (`mathclasses`, about 1,450 single code points, plus
  `mathclassranges`): N normal, A alphabetic, B binary, R relation, L large
  operator, O/C open/close, P punctuation, U unary, F fence, D diacritic,
  S space, and so on. Take the data from Unicode's `MathClass` file rather
  than this copy. This is the single-character prior.
- **Character classes in the grammar:** `opNary` (∑ ∏ ∫ … about 50),
  `opOpen`/`opClose`, `opStretchyArrow`, `opScript`, the Unicode sub- and
  superscript sets (`unicodeSub`, `unicodeSup`), `unicodeFraction`,
  `diacritic`.
- **ASCII digraphs** (`mappedOperator`): `<=`, `>=`, `->`, `+-`, `~=`,
  `:=`, `<<`, `...`. These are math evidence in prose.
- **Function names** (`functionName`, `trigName`, `limName`):
  sin … lim, log, ln, det, max, gcd … Short words that would otherwise read
  as prose.
- **TeX control words** (`controlWords` in `src/unicodemathml.js`, about 760
  entries mapping `\alpha`, `\sum`, `\le` to Unicode). Recognises TeX names
  written bare in prose.

### Harvestable syntax (short-window features)

The script and n-ary rules define local patterns a fixed window can test
without a parse:

- base followed by a Unicode script run, or `_`/`^` followed by a script
  operand (`subU`, `subL`, `supU`, `supL`, mixed forms in `subsup`);
- `opNary`, optional scripts, then a space or `▒`, then an operand (`nary`);
- operand, relation or binary operator, operand: the alternation the parser
  dropped, which is exactly the signal a recognizer wants;
- balanced open/close around short operand runs.

### A TeX → UnicodeMath converter exists: the harness

`playground/assets/TeX.js` (988 lines, MIT) has `TeX2UnicodeMath(tex)`: a
control-word pass through `resolveCW`, then a structural pass that turns
`\frac{a}{b}` into a UnicodeMath fraction, `_{…}` into `_(…)`, `\sqrt[n]{…}`
into `√(n&…)`, and so on. It also has `MathMLtoTeX`. `src/unicodemathml.js`
has `MathMLtoUnicodeMath`, which uses `DOMParser` and so needs a DOM shim
in Node. That gives two routes from TeX to UnicodeMath:

1. `TeX2UnicodeMath` directly, covering the TeX that TeX.js knows; and
2. KaTeX's MathML output → `MathMLtoUnicodeMath`, covering whatever KaTeX
   parses, including the paper macros YA already normalises.

Only the playground ships `TeX.js`; it is not in the npm package, so using
it means vendoring. The library's main entry point also accepts `$…$`,
`\(…\)` and `\[…\]` input and calls `TeX2UnicodeMath` on it
(`src/unicodemathml.js` near line 5783). That works only when a page has
also loaded `TeX.js`.

`TeX.js` is a converter, not a renderer. It never lays out math: it
rewrites TeX to UnicodeMath text, and serialises a MathML tree back to TeX
(`MathMLtoTeX`, the file's first half). Display in UnicodeMathML comes from
emitting MathML, which the browser draws natively or MathJax draws. The
alternative to KaTeX is therefore the whole chain, TeX → UnicodeMath → PEG
parse → MathML → native browser rendering, and nothing in it is a reason to
replace KaTeX:

- `TeX2UnicodeMath` covers far less TeX than KaTeX. It is a single-pass
  control-word table with brace matching, and the papers' environments,
  macros and colour handling that YA already normalises for KaTeX
  (`topics/rich-text-rendering.md` § Paper math compatibility) have no
  counterpart here.
- Native MathML rendering is coarser than KaTeX's HTML and CSS output, and
  it depends on the browser's math fonts.
- YA already accepts presentation MathML where papers carry it, so native
  MathML would only matter for output this pipeline produces, namely a
  recognised Unicode zone.

`TeX.js` is therefore harness and training-data tooling only: it turns
delimited TeX in real text into UnicodeMath. For displaying a recognised
Unicode zone, the open question below is between UnicodeMath → MathML and
UnicodeMath → TeX → KaTeX; the second route needs `MathMLtoTeX` and a DOM
shim, and keeps one math look across YA.

Test vectors in the repository: `test/testmml.js` pairs about 80 MathML,
UnicodeMath and TeX cases, and `utils/benchmark.txt` holds 628 UnicodeMath
expressions from various sources. These are positive examples only.

## Recognizer design notes

### Single-character prior, then short windows

Score each character from the tables above: strong positives for large
operators, relations, Unicode scripts, math alphanumerics and Greek next to
operators; ambiguous for ASCII letters and digits; strong negatives for
runs of four or more ASCII letters that are not function names or
control words. Then score fixed windows over tokens (letter runs, digit
runs, symbols), not raw characters, so that `n≥1` and `For real` are
compared at the same grain. The window features are the syntax patterns
above. This is the bottom-up, convolution-like pass.

### Hot characters license spans (user-directed, 2026-10-08)

Some characters are hot for Unicode math: large operators, relations,
Unicode scripts, `_`/`^` next to an operand. Each hot character licenses a
span before and after it, wider for hotter characters; nearby spans merge,
and merged heat adds, decaying across intervening non-hot characters.

A direct form is a heat field with an exponential kernel. Let `h(j)` be a
character's heat from the tables above, and `d(j)` the decay factor for
crossing it: near 1 for hot or neutral math characters (digits, operators,
single-letter operands, spaces between them), smaller for ordinary letters,
and near 0 for a prose word, which acts as a cold barrier. The field at
position `i` is the sum over `j` of `h(j)` times the product of `d` over
the characters between them. Because the kernel is separable, two linear
passes compute it exactly:

```
F(i) = h(i) + d(i) · F(i−1)        left to right
B(i) = h(i) + d(i) · B(i+1)        right to left
H(i) = F(i) + B(i) − h(i)
```

A region is a maximal run with `H(i) ≥ θ`. This gives the requested
behaviour without explicit state: a character of heat `h` in uniform decay
`d` reaches roughly `log(h/θ) / log(1/d)` characters each way, so scalar
heat sets the invested scan area; two hot characters close together lift
the field between them above `θ`, merging their spans; and merged heat adds.
Cost is linear with no per-start state. A maximum chunk length remains as a
guard against long runs of neutral characters, such as a table of numbers.

`H` is a recall-oriented proposal. A region still needs the verifier score
below to render, and the boundary refinement trims what the field
over-licensed.

### Seeds and the left-to-right alternative

The heat field can also be thresholded twice: a higher seed threshold
selects regions worth verifying, and a lower extent threshold sets their
extent.

The left-to-right alternative anchors at a start and needs one live state
per candidate start, bounded by both a minimum running score and a maximum
chunk. It also misses formulas whose left edge looks like prose until a
strong symbol appears later: in `f(x) = ∑_k …` the evidence is to the right
of the start. Bottom-up growth recovers that left context naturally. The
proposed "grow the start by a few characters" step becomes a final
boundary refinement: try trimming or extending each end by a few tokens and
keep the extent with the best verifier score.

### Verification and threshold

For each region, parse with the UnicodeMath grammar and combine the tree
score with the window score; render only above an acceptance threshold.
Regions below it stay literal, with the existing script redraw.

### Dialect adapter

Agent output is not strict UnicodeMath. Before parsing, a small adapter
must map the agent dialect, at minimum `_{…}`/`^{…}` to `_(…)`/`^(…)`
(UnicodeMath shows braces as visible fences). Parsed `/` builds a stacked
fraction, which grows line height in running text; inline zones may need
`/` mapped to the linear slash `∕` (U+2215). This adapter is a rewrite
table owned by YA, kept separate from the recognizer.

### Heuristic first, learned later

Because the grammar gives no rejection signal, the recognizer is where the
modelling effort goes. Start with hand-weighted features to learn what
matters, then fit weights (logistic regression per window, or a small
linear-chain CRF over tokens with begin/inside/outside labels) once
labelled data exists.

## Data and evaluation

- **Synthesised positives with context:** take natural TeX spans with
  their surrounding prose from agent transcripts and paper extracts, where
  `$…$`, `\(…\)` and `\[…\]` mark the math. Convert each span to
  UnicodeMath by either route above, then "informalise" it toward the agent
  dialect: drop `▒`, rebrace script arguments, turn mappable scripts into
  Unicode script characters, fold math-italic letters to ASCII. Splice it
  back without delimiters. The delimiters supply exact span labels, and the
  surrounding prose supplies negatives.
- **Distribution shift:** synthesised Unicode math is not what agents write
  when they skip TeX. Hold out a hand-labelled evaluation set of real
  undelimited agent paragraphs, drawn from the same transcripts, and report
  span precision and recall on it, not on synthetic data.
- **False-positive budget:** rendering prose as math is worse than leaving
  math literal. Tune the threshold for high precision; the option stays off
  by default.

## Prototype recognizer (2026-10-08)

Built outside this repository in `/local/graehl/umath-research` (local git;
its `README.md` has the pipeline, protocol and reproduction steps). The
corpora are derived from private session logs and are not committed.

**Data.** 112k unique assistant text blocks from Claude and Codex logs
plus 230 paper extracts, segmented with the renderer's own parser
(markdown-it with the server's KaTeX plugin options). Each run is the text
of one inline token; inline code, raw HTML and images split it; fenced
and indented code are separate code runs. An earlier line-based
segmenter missed fences indented inside list items. Most "unfenced code"
false positives were those lines, which the renderer never shows as
prose.

Real undelimited Unicode math is rare in the sessions: about 500 of
305k runs carry a structural indicator, while prose uses of `→`, `×` and
`~` number in the thousands. Positives are therefore synthesised. Each
KaTeX-valid TeX span (about 20,000 inline spans, mostly papers) goes
TeX → KaTeX MathML → UnicodeMathML `MathMLtoUnicodeMath`, then through a
seeded agent-dialect informaliser. It is spliced back into its prose
with exact labels. Typographic TeX (`$5,898$`, a lone `$\pm$`) is ignored
and single-letter variables are soft. Negatives are ordinary prose,
prose with hot characters, and code lines; operator runs inside
negatives are ignored rather than labelled. The KaTeX MathML route beat
UnicodeMathML's own `TeX2UnicodeMath`, which leaves build-up internals
(`⍁1&n^s〗`) and unknown commands in its output.

The 619 real hot runs were hand-labelled. The 585 that the renderer
shows as prose form the real evaluation set (263 dev, 322 test, split by
message). Session files that contribute labelled runs are excluded from
training.

**Both predictors use the same token boundaries.** Regions are maximal
runs of whitespace-separated tokens, and both share the same edge
refinement. That refinement trims sentence punctuation and edge arrows.
It also drops regions with nothing to typeset: numbers with units,
signs, ranges or arrows between them (`4–6×`, `60→110→1,833`), and a lone
symbol (`B′`, `λ`). The two differ only in how a token is judged:

- **Token rule** (after UTN #28 § 5): a token is strong if it contains an
  unambiguous math character or script syntax. It is weak if it is short
  (a single letter, a number, an operator, a function name, or any word
  of at most two letters). A region is a run of strong or weak tokens
  with at least one strong token. Each token is judged alone, by fixed
  patterns.
- **Learned field**: a token's score is the highest character score
  inside it. Each character score comes from the heat field, which
  pools evidence from its neighbours on both sides with learned decay.
  A region needs one token scoring at least `high` (the seed), and
  extends over neighbours scoring at least `low`.

On real dev runs, the differences look like this (⟪…⟫ marks a region):

| text | gold | learned | rule |
|---|---|---|---|
| `Δ_benefit is a maximum` | `⟪Δ_benefit⟫` | `⟪Δ_benefit⟫` | `⟪Δ_benefit is⟫` |
| `with ε = 1e-8. Adam` | `⟪ε = 1e-8⟫` | `⟪ε = 1e-8⟫` | `⟪ε =⟫` |
| `VERIFIED bib; ≈6T NOT STATED` | none | none | `⟪≈6T⟫` |
| `(±5%, or your 10%)` | none | none | `⟪(±5%, or⟫` |
| `paired Δ (p).` | none | none | `⟪Δ (p)⟫` |
| `gives m +.533 (p=.012);` | `⟪p=.012⟫` | `⟪+.533 (p=.012)⟫` | none |
| `O (overfitting) = S(E) − S(E_neutral).` | `⟪= S(E) − S(E_neutral)⟫` | `⟪O (overfitting) = S(E) − S(E_neutral)⟫` | `⟪= S(E) − S(E_neutral). E_neutral⟫` |
| `update is 0.1·v_R + 0.1·v_Call + …` | the sum | none | `⟪is 0.1·v_R + … so R⟫` |

The rule's characteristic error is gluing short prose words (`is`, `or`)
and lone typographic tokens into regions, because each token is judged
out of context. The learned field's errors are boundary overreach into a
parenthetical, and misses where its evidence stays below the seed
threshold.

**Model.** The heat field above, with per-class heat and decay (54
classes from a character classifier). The classifier has letter-run
rules (identifiers, function names), script-marker rules (`_`/`^` count
only after a short operand that starts a word) and Unicode-property
rules (three or more Greek letters form a word). It adds sparse
per-code-point overrides and sparse left/right neighbour-class pair
heat. Training minimises weighted logistic loss per character, with an
exact gradient through both recurrences. The pair term carries nearly
all of the gain over the hand-seeded field; without it the learned field
is no better than the token rule.

**Size.** Quantised to step 0.5 after L1: about 100 overrides and 2,000
pairs. Parameters are 15.0 KB, 5.5 KB gzipped; the runtime is about 4 KB
minified. Roughly 2 M characters per second in Node (diagnostic).

**Dev results, precision first** (a miss leaves legible Unicode; a false
region garbles prose). Operating point seed 0.98, extent 0.5, chosen on
dev:

| dev set | predictor | region precision | math-span recall | runs fully right |
|---|---|---|---|---|
| real hot runs, N=263 | learned | 0.993 (1 false of 144) | 0.776 | 0.863 |
| real hot runs | token rule | 0.959 (7 false of 169) | 0.776 | 0.852 |
| synthetic, N=7139 | learned | 0.994 (5 false of 894) | 0.634 | 0.968 |
| synthetic | token rule | 0.974 (26 false of 988) | 0.524 | 0.954 |

A looser point (seed 0.9, extent 0.5) gives real-run precision 0.971 at
recall 0.841. The 0.98 seed is the precision-first choice.

**Test status.** An earlier iteration (line-based segmenter, seed 0.9)
ran the test sets once. On real hot runs it scored char F1 0.810 against
0.723, and span recall 0.782 against 0.657, both significant. But it
made twice the rule's false regions (128 against 64 per 1k runs). Those
numbers are superseded, and the test split has now been seen. A clean
final number for the current model needs freshly labelled real runs.

## Landed as an opt-in (2026-10-08)

The recognizer ships in the server Markdown renderer behind Appearance →
**Typeset plain-text math**, default off; the contract is in
[rich-text-rendering](../../topics/rich-text-rendering.md) § Typeset
plain-text math. The shipped parameters were retrained on all data,
including both natural splits. Recognition and KaTeX rendering run on the
server for every client; the setting only reveals the hidden KaTeX half.

Measured costs (diagnostic: shared host at load 11–15 on 16 cores,
interleaved legs, three rounds):

| measurement | before | with recognizer |
|---|---|---|
| server render, 2,000 random messages | 131–139 ms | 216–255 ms |
| server render, 353 messages with real math | 80–92 ms | 166–203 ms |
| HTML, random messages | 856 KB | 865 KB |
| HTML, math messages | 644 KB | 998 KB |
| browser insert + layout, 500 random messages | 37–39 ms | 29–30 ms (order noise) |
| browser insert + layout, 353 math messages, setting off | 94–95 ms | 102–134 ms |
| same, setting on | | 121–155 ms |
| toggling the setting, 445 regions mounted | | 13–22 ms |

The server pays about 0.04 ms per ordinary message. Messages with math
carry the hidden KaTeX DOM even with the setting off, about 10% more
insert time on a math-heavy transcript. A cheap per-token prefilter (skip
text without non-ASCII or operator characters) would skip 60% of runs. But
it loses 55 of the regions found across all session prose, mostly
function-call forms like `max(A[i-1], B[j-1])`, so it was not adopted.

Known gap: a formula can split around an unseeded token (`∫₁^∞ x⁻ˢ` and
`= 1/(s−1)` around `dx`).

## Open questions

- Whether to vendor `TeX.js` for the harness only (offline), or depend on
  the npm package at runtime for the converter as well.
- Whether rendering goes UnicodeMath → MathML directly, or UnicodeMath →
  TeX → KaTeX for consistent fonts with YA's existing math.
- Recognition runs on the server's Markdown text tokens, like the script
  redraw. Streaming paragraphs need the same treatment once a block
  completes.
