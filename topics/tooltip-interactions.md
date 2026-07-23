# Tooltip Interactions

> Tooltips use one browser-level appearance and timing preference while keeping
> ordinary hints compact, keyboard-accessible, and fast to scan once one has
> deliberately opened.

Topic: tooltip-interactions

## Modes and settings

Appearance presents `Themed` and `Native` as an explicit two-way style
selector. The delay slider and number field remain visible beside that selector
in the same row:

- `Themed` renders YA's tooltip layer with the active theme. Its default delay
  is 50 ms.
- `Native` leaves ordinary `title=` tooltips to the browser, including the
  browser's timing and colors. YA must not describe that timing as a numeric
  preset because it is controlled by the browser/OS.
- Moving the slider or entering a valid number selects `Themed`. Temporarily
  deleting the number while editing neither changes mode nor commits a delay.
- The mode and delay are portable browser preferences. The retired session
  hover-card delay seeds the shared delay at one third of its stored value when
  the new delay is absent, preserving that card's prior timing.

## Themed timing

The configured delay measures **pointer rest**, not merely time since entry.
Pointer movement before the first reveal restarts the timer. Pointer movement
after reveal dismisses the tooltip, matching the familiar native behavior; the
same target stays dismissed until the pointer leaves it.

Keyboard focus uses the same configured delay. Escape, primary click, scroll,
resize, blur, and leaving the target dismiss the tooltip.

Only a tooltip that actually became visible warms the tooltip system. After it
closes, entering another target within six times the configured delay opens the
adjacent tooltip immediately. “Adjacent” is temporal: no geometry test is
needed. Casually crossing targets that never opened does not warm anything.

The session preview hover card is intentionally slower and does not require
pointer rest: its first reveal waits three times the configured delay (150 ms
by default), so a casual pass across a session list remains quiet. After one
card opens, scanning neighboring session rows switches cards immediately. In
`Native` mode this YA-rendered card retains its existing 150 ms default or a
legacy stored card delay.

## Themed presentation

Plain text tooltips retain familiar tooltip geometry: a compact monochrome
surface with maximum black/white contrast and polarity opposite the active
light or dark color scheme, a visible border and modest shadow, UI font, tight
unzoomed line spacing, and no decorative animation. The ordinary themed
tooltip is one pixel larger than the compact `--font-size-xs` UI token; the
secondary-click enlargement still advances to `--font-size-sm`. Multiline
content preserves line breaks.

The shared layer consumes both legacy static `title=` hints and explicit
`data-tooltip` hints. New and pointer-computed producers assign exactly one
owner: themed mode uses `data-tooltip`; Native mode uses `title`, never both.
Shared helpers enforce that rule for React attributes, pointer-computed hints,
hidden-content badges, and generated fixed-font file links.
Themed mode proactively detaches every legacy browser `title`, including titles
added or updated after mount, and retains its text as YA tooltip metadata for
the entire time Themed mode is active. Only switching to Native restores those
titles. No pointer departure, dismissal, or viewport change may reintroduce a
browser-owned bubble while Themed mode owns tooltip presentation.

A hint that exactly repeats its target's visible text is omitted only when the
target is measurably visible in its own scrollport, every clipping ancestor,
and the viewport. If any of those clips the content—or the target cannot be
measured—the hint remains. Explanatory hints and extra metadata are not
inferred to be redundant. Ran commands use their producer's hidden-content
count first, then the same actual scroll-visibility check on hover. Thus a
command without a `+N` badge still reveals its full text when partly scrolled
out of view, while any fully scroll-visible command has neither a themed nor
native command tooltip. Expansion alone does not suppress the hint when the
command remains clipped by its own scrollport, an ancestor, or the viewport.
The Ran-label hint separately owns elapsed time.

Faded output/diff previews reveal a plain-text tail through shared preview
machinery: an ellipsis plus the final configured number of lines. The same
tail is available from the faded content and its `+N` hidden-content badge
where present. Bash/Ran, Web, Edit, and Write use this contract; the badge
requires its producer to supply the actual omitted-tail text so a new badge
cannot silently omit the affordance. When the line-count/character budget says
all content fits but wrapping, a clipping ancestor, or the viewport still hides
part of the rendered surface, hovering exposes the full content. Only content
that both fits and is fully scroll-visible remains without either tooltip
attribute.

File links use only the concise path and optional line/range as their hint.
Filename and adjacent `N lines` range links may therefore show the same hint.
Instructions such as “Click to view” are omitted because link activation and
browser link gestures are already conventional.

Secondary-click on a visible plain text tooltip copies its full text and
immediately increases the tooltip by one text-size step, without animation.
This must not intercept a right-click already handled by the app, a nonempty
text selection, or browser-operable link, form, editable, image, video, or
audio targets. Pointer movement still dismisses the enlarged tooltip.

Rich explanatory tooltips may retain structured content while using the same
dwell/warmth coordinator. Interactive help panels and menus are popovers, not
tooltips; they keep their own explicit open/close interaction instead of
pretending to be hover hints.

## Future: rendered hidden tails

The shared hidden-tail tooltip is currently plain text in the tooltip UI font.
A future rendered tail may use its normal output renderer or text/output font,
but it remains a tooltip-like affordance: the same monochrome high-contrast
shell, normal tooltip geometry, dwell/adjacency behavior, and slightly tighter
unzoomed metrics. “Rendered” changes the body typography and content treatment,
not the surface into a card.

## Verification contract

- Static and pointer-computed hints obey rest delay, movement reset/dismiss,
  focus, and exclusive native/themed ownership. Themed mode contains no live
  native titles; Native mode restores them.
- Exact visible-content hints are absent only when fully scroll-visible and
  remain when clipped by self, ancestor, or viewport; no-`+N` Ran commands
  follow the same measured rule.
- Every faded hidden-content preview exposes its actual tail from the fade and
  `+N` badge where present; an unfaded preview exposes its full content when
  any of its rendered surface is not scroll-visible.
- Read/file links expose only a concise path/range and never carry native and
  themed attributes simultaneously.
- Only visible tooltips enable immediate temporally adjacent reveals.
- Native mode leaves ordinary browser titles intact.
- Valid slider/number edits select themed mode; an empty number draft does not.
- Session hover cards use the 3× first-open delay and immediate warm switching.
- Secondary-click copy/enlarge respects context-menu and selection exclusions.
- The local and remote entry points install the same tooltip layer and
  pre-render appearance initialization.
