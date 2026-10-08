# Typeset informal Unicode math in prose, as a scored opt-in

Agents often write math as Unicode prose with TeX-ish scripts rather than in
`$…$`: `ζ(s) = Σ_{n≥1} 1/nˢ`, `∫₁^∞ x⁻ˢ dx = 1/(s−1)`, `∏_p 1/(1 − p⁻ˢ)`.
YA now redraws the Unicode script characters legibly
([rich-text-rendering](../../topics/rich-text-rendering.md) § Unicode script
characters), but `_x`, `_{…}`, `^n` and big-operator limits stay literal, and
`Σ_{n≥1}` cannot stack its limits.

The wanted shape is a real rewrite system, not a handful of regexes: parse a
candidate span with a grammar, score whether the whole expression is really
math (operator density, balanced structure, script and relation symbols,
absence of prose words), and typeset only above a threshold, as a user
option. Hand-rolled regex limit parsing was tried and withdrawn on
2026-10-08 for that reason.

## Prior art checked (2026-10-08)

- **UnicodeMath** (Murray Sargent, Unicode Technical Note #28) is the closest
  specified linear format: `∑_(n=1)^∞ 1/n^s`. It uses parenthesised script
  arguments, not TeX braces.
- **[UnicodeMathML](https://github.com/MurrayIII/UnicodeMathML)** (MIT, npm
  `unicodemathml` 1.0.7, ~730 kB unpacked, commits through 2026-10) parses
  UnicodeMath with a PEG grammar to MathML, and has a markdown-it path. Its
  math zones are explicitly delimited (`⁅ ⁆`); it does not detect math in
  running prose. Candidate parser for the scored span, not a detector.
- **[pylatexenc](https://github.com/phfaist/pylatexenc)** `unicode_to_latex`
  maps characters to TeX escapes without structure; not a fit.

No library found that detects undelimited Unicode/TeX-ish math in prose and
scores it. That detector is the part YA would have to own.
