/**
 * Structured result of a Codex `web.run` browsing call (rollout tool name
 * `web__run`, normalized tool name `Web`).
 *
 * The provider returns one plain-text blob: a script envelope
 * (`Script completed` / `Wall time N seconds` / `Output:`) followed by one or
 * more page blocks. Each block is a title line `Title (URL)`, then a marker
 * line `cite<ref> [wordlim: N] <meta>; …` whose tail is
 * either windowed page lines (`L0: …`) or a prose search snippet. Inline
 * links are wrapped as `cite<id>†<label>[†<domain>]`.
 * Server normalization parses that structure once; clients render it.
 */

export interface CodexWebRunLine {
  /** Provider line number (the `Ln:` index within the page window). */
  n: number;
  /** Line text with citation markers reduced to their visible labels. */
  text: string;
}

export interface CodexWebRunPage {
  /** Page or search-hit title (may be empty when the provider omits it). */
  title: string;
  url?: string;
  /** Provider reference id for follow-up commands, e.g. "turn0search4". */
  ref?: string;
  /** Display word limit the provider applied, from `[wordlim: N]`. */
  wordLimit?: number;
  published?: string;
  crawled?: string;
  contentType?: string;
  /** The command that produced this view, e.g. `open({"ref_id":…})`. */
  source?: string;
  redirectedUrl?: string;
  /** Total line count of the full page, from `Total lines: N`. */
  totalLines?: number;
  /** Windowed page lines for open/find/click views. */
  lines?: CodexWebRunLine[];
  /** Prose snippet for search hits (views carry `lines` instead). */
  text?: string;
}

export interface CodexWebRunResult {
  durationSeconds?: number;
  pages: CodexWebRunPage[];
  /** Cleaned body text when no page blocks could be parsed. */
  text?: string;
}
