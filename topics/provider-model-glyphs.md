# Provider and model compact glyphs (top-right status)

## Goal

Reduce top-right status width in the composer/header area by replacing the verbose
provider/model prefix with compact glyphs while preserving full text in hover and
details panes.

- Keep version or numeric detail text visible as plain text.
- Never drop provider name/model substring fidelity for tooltip content.
- The first matching rule must be **longest substring match**, then first-row order.

## Matching contract

1. Normalize inputs:
   - `provider = provider?.toLowerCase().trim()`
   - `model = (model ?? "").toLowerCase().trim()`
2. Apply provider glyph from the provider table if recognized.
3. Strip common provider prefixes from model strings before model matching:
   - `claude-<family>-`
   - `gpt-`
   - `openai/`
   - `opencode/`
4. Apply the model substring table in order of row length descending:
   - exact longer match first (for example `gpt-5.5-mini` before `gpt`).
5. Keep captured numeric/version segments as plain text.
6. If no model pattern matches, keep compact text as:
   - `{{providerGlyph}} {{rawModel}}`

Tooltip contract:

- `title` should always include the full string:
  - `{{providerDisplayName}} · {{rawModel}} · {{thinking/effort extras}}`

## Provider glyphs

| Provider key   | Unicode glyph | SVG concept (fallback)                                  | Why |
|---|---:|---|---|
| `claude`       | `◉` | 12x12 filled circle with short right-facing wedge notch | High-contrast marker, quick “AI assistant” identity |
| `claude-ollama`| `◎` | 12x12 circle with dashed ring + center dot | Distinct from cloud Claude with local/runtime hint |
| `codex`        | `⌬` | 12x12 six-pointed star (hexagon pinwheel) | Suggests routing + active tool-loop |
| `codex-oss`    | `◈` | 12x12 outlined rhombus with double stroke | “Local / OSS” variant of Codex family |
| `gemini`       | `✦` | 12x12 six-point gem-like radial star | “Gemini” feel and broad recognition |
| `gemini-acp`   | `✶` | `✦` with lower-right ring-tail extension            | Differentiates local Gemini vs ACP transport |
| `opencode`     | `⧉` | 12x12 two overlapping squares                    | Suggests “proxy/bridge + tool surface” |

Fallback if provider is unknown: use `◌`.

## Common model substrings (version number kept visible)

Use these entries after provider matching.  
The glyph column is a compact mark; keep the version chunk as text.

| Provider scope | Model substring(s) | Match mode | Unicode glyph | SVG concept (fallback) | Compact rendering |
|---|---|---|---|---|---|
| claude | `opus[1m]`, `opus-1m` | ordered exact | `◐` | Semicircle + right stem (memory/strength marker) | `◐ 1m` |
| claude | `opus` | substring | `◐` | same | `◐` |
| claude | `sonnet[1m]`, `sonnet-1m` | ordered exact | `♪` | Notehead + beam stub (balance marker) | `♪ 1m` |
| claude | `sonnet` | substring | `♪` | same | `♪` |
| claude | `haiku` | substring | `✎` | Pencil tip in a box (lean/light marker) | `✎` |
| codex | `gpt-5.4-spark` | ordered exact | `⚡` | Angled “spark” stroke + core dot | `⚡ 5.4` |
| codex | `gpt-5.5` | ordered exact | `◆` | 12x12 diamond | `◆ 5.5` |
| codex | `gpt-5.4` | ordered exact | `◆` | 12x12 diamond | `◆ 5.4` |
| codex | `gpt-5.4-mini` | ordered exact | `◇` | Hollow 12x12 diamond | `◇ 5.4-mini` |
| codex | `gpt-5.4-nano` | ordered exact | `◇` | hollow 12x12 diamond with slash | `◇ 5.4-nano` |
| codex | `gpt-5.4` | substring | `◇` | compact diamond | `◇ 5.4` |
| codex | `gpt-5.3` | substring | `◆` | 12x12 diamond | `◆ 5.3` |
| codex | `gpt-5` | substring | `◆` | 12x12 diamond | `◆ 5` |
| codex | `gpt-4` | substring | `⧉` | Overlapping squares (lighter family) | `⧉ 4` |
| gemini | `2.5-pro` | substring | `✹` | Three-rayed “pro” wedge | `✹ 2.5-pro` |
| gemini | `2.5-flash` | substring | `⚡` | Lightning cap + short tail | `⚡ 2.5-flash` |
| gemini | `1.5-pro` | substring | `✹` | same | `✹ 1.5-pro` |
| gemini | `gemini` | substring | `◗` | Half-diamond + dot | `◗` |
| opencode | `gpt-5` | substring | `◆` | 12x12 diamond | `◆ 5` |
| opencode | `gpt-4` | substring | `⧉` | two overlapping boxes | `⧉ 4` |
| opencode | `qwen` | substring | `◌` | small centered dot-in-ring | `◌` |
| opencode | `llama` | substring | `◥` | right-angle chevron + tail | `◥` |
| opencode | `mistral` | substring | `◰` | quarter-square with stroke | `◰` |
| any | `thinking` | substring | `∴` | Three dot triangle | `∴` (append to existing status copy) |

## Version and extras retention rules

- Version-like tokens are preserved as plain text:
  - `gpt-5.4-mini` → `◇ 5.4-mini`
  - `opus-4-1` (or `claude-opus-4.1`) → `◐ 4.1`
- Prefixes like `thinking off`, `auto`, `on:high` remain as plain text after the
  glyph cluster.
- If a row has both model and provider glyphs, render provider glyph first to keep
  provider identity primary.

## Suggested output examples

- `provider: claude`, `model: claude-opus-4-1` → `◉ ◐ 4.1`
- `provider: codex`, `model: gpt-5.4-mini` → `⌬ ◇ 5.4-mini`
- `provider: gemini`, `model: gemini-2.5-flash` → `✦ ⚡ 2.5-flash`
- `provider: opencode`, `model: opencode/gpt-5-nano` → `⧉ ◆ 5-nano`
- busy copy (`Thinking`, `waiting`) still stays as full text in tooltip/details, while
  compact top-right line stays glyph-based.

## Open questions before implementation

- Confirm if provider glyphs should be plain Unicode only or include inline SVG for
  unresolved font fallback cases.
- Decide if local model families (e.g., more Ollama/Qwen/Mistral variants) need
  dedicated entries now or by “other model” fallback.
- Confirm final ordering between provider glyph and model glyph when compact space is
  extremely tight (provider-first is recommended).

