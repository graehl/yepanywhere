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
surface, high-contrast theme colors, visible border and modest shadow, UI font,
tight unzoomed line spacing, and no decorative animation. Multiline content
preserves line breaks.

The shared layer consumes both static `title=` hints and explicit
`data-tooltip` hints. It also supports titles computed on pointer entry, such as
fresh command elapsed time and output tails. While active it suppresses the
browser bubble, associates the themed tooltip via `aria-describedby`, and
restores the source `title` on dismissal. `Native` mode bypasses this layer.

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

Faded `+N` hidden-content badges outside Bash/Ran should eventually be able to
show the omitted tail through the shared preview machinery. Renderers should
provide their actual hidden text/content to one reusable tail-tooltip path
rather than each recreating Bash's last-lines handler.

This is a future idea, not part of the initial themed-tooltip work. A rendered
tail may use its normal output renderer or text/output font instead of the UI
font, but it remains a tooltip-like affordance: the same monochrome
high-contrast shell, normal tooltip geometry, dwell/adjacency behavior, and
slightly tighter unzoomed metrics. “Rendered” changes the body typography and
content treatment, not the surface into a card.

## Verification contract

- Static and pointer-computed titles obey rest delay, movement reset/dismiss,
  focus, and restoration.
- Only visible tooltips enable immediate temporally adjacent reveals.
- Native mode leaves ordinary browser titles intact.
- Valid slider/number edits select themed mode; an empty number draft does not.
- Session hover cards use the 3× first-open delay and immediate warm switching.
- Secondary-click copy/enlarge respects context-menu and selection exclusions.
- The local and remote entry points install the same tooltip layer and
  pre-render appearance initialization.
