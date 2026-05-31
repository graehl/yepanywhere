# Session UI Customization

> Session UI customization lets users choose which session controls are visible
> or enabled while preserving keyboard-driven access to advanced actions.

Topic: session-ui-customization

## Vision

YA should eventually offer a session-customization surface similar in spirit to
global new-session defaults: show a mock session toolbar/composer with optional
features visible in context, then let the user click controls to toggle whether
they are enabled. Disabled controls should appear dimmed, crossed out, or
otherwise clearly unavailable in the mockup rather than disappearing from the
customization view.

This is the resolution path for session controls that are useful to some users
but too busy, speculative, or maintainer-contested for the default UI. Examples
include composer delivery choices such as ASAP versus deferred/"when idle"
send, secondary search/edit controls, and other advanced per-session actions.

Until the full mockup exists, a first-level `Experimental features` setting may
serve as a coarse gate for restored default-off controls. Each gated feature
should still point at its most relevant topic doc so the user can inspect the
behavior and the reason it is not part of the default UI.

The current first concrete entry is Patient queued messages, which links to
[`message-control-steer-queue-btw-later-interrupt.md`](message-control-steer-queue-btw-later-interrupt.md)
and lets the user opt the patient/ASAP queue-mode toggle in or out after the
master experimental gate is enabled.

## Contract

- Defaults may stay conservative, but optional controls should have a path to
  remain available without rebuilding the UI for each maintainer preference.
- A disabled visible button is a UI preference, not necessarily a disabled
  command. If the keyboard accelerator still works, tooltip and mouseover
  surfaces should continue to show that accelerator.
- Customization state should distinguish global defaults from per-session
  overrides, matching the pattern used by new-session/global defaults where
  possible.
- Controls disabled by upstream preference should be candidates for
  configurable default-off restoration before the implementation is removed.

## Mockup Requirements

When this is implemented, the settings surface should show a realistic session
composer/toolbar mockup. Clicking a control in the mockup toggles whether the
real session UI shows or enables that feature. Disabled controls should remain
legible in the mockup and use a visual treatment such as dimming or
strikethrough/cross-out so the user understands what can be restored.

The hover surface for grouped or secondary actions should include keyboard
accelerators for actions that remain available by shortcut, even if their
visible buttons are disabled.

## Related Topics

- [kzahel-disabled.md](kzahel-disabled.md) logs upstream-disabled features that
  should be reconsidered as configurable default-off session controls.
- [message-control-steer-queue-btw-later-interrupt.md](message-control-steer-queue-btw-later-interrupt.md)
  defines message delivery behaviors that session customization may expose or
  hide.
