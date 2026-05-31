# Session Toolbar UI Controls

Status: In Progress

Progress:

- [x] 2026-05-31: Added `UI_KEYS.sessionToolbarVisibility` and a defensive
  localStorage-backed visibility hook with same-tab updates.
- [x] 2026-05-31: Added Appearance settings for Session Toolbar visibility,
  including a compact preview and reset action.
- [x] 2026-05-31: Wired low-risk toolbar chrome to the visibility model:
  slash menu, model indicator, microphone/speech selector, context usage,
  `/btw`, nudge, queue buttons/toggle, and session status chips.

## Context

Session toolbar controls have accumulated organically: slash command access,
voice input, context usage, `/btw`, nudge, liveness/status, and queued-message
controls all compete for space in the primary composer toolbar.

Some of these features are valuable but not universally wanted in the primary
toolbar. They are less intrusive when kept in the session `...` menu, where
they remain discoverable without consuming composer space.

This is a UI customization problem, not a server behavior or feature-security
problem. Hiding a toolbar affordance should generally not disable the
underlying capability.

## Decisions

- Store session toolbar visibility in browser localStorage, not server
  settings.
- Treat toolbar visibility as per-browser UI chrome:
  - desktop and phone can diverge;
  - different browser profiles can diverge;
  - remote users connecting to the same Yep server do not share the preference.
- Keep behavior/configuration settings on the server when they affect server
  behavior or shared policy. Examples:
  - global nudge defaults;
  - public share enablement and viewer URL;
  - relay/Remote Access config.
- Keep session `...` menu entries available for features whose toolbar button
  is hidden, unless a later setting explicitly disables the feature itself.
- First slice should hide only low-risk visible toolbar chrome. It should not
  change message delivery semantics.

## Planned Toolbar Visibility Keys

- Slash menu.
- Model indicator.
- Microphone and speech-method selector.
- Context usage.
- `/btw` toolbar button.
- Nudge toolbar button.
- Queue buttons and queue-mode toggle.
- Session status/liveness chips.

## Non-Goals

- Do not disable slash command parsing when the slash menu is hidden.
- Do not disable `/btw` command handling when the `/btw` button is hidden.
- Do not disable nudge behavior or hide the session `... -> Nudge...` entry
  when the nudge toolbar button is hidden.
- Do not change server-side heartbeat/nudge scheduling in this pass.
- Do not move global nudge defaults out of Agent Context in the first slice.

## Tactical Work

### 1. Local Visibility Model

- Add a `UI_KEYS.sessionToolbarVisibility` localStorage key.
- Add a focused hook that:
  - loads defaults when no preference exists;
  - validates stored JSON defensively;
  - exposes per-control updates;
  - syncs same-tab consumers through a small external store.
- Default every toolbar control to visible for backward compatibility.

### 2. Appearance Settings UI

- Add a Session Toolbar subsection to Appearance.
- Show a compact preview that reflects the current visibility toggles.
- Add toggles for each planned visibility key.
- Add a reset-to-defaults action.
- Keep copy clear that these settings affect toolbar visibility only.

### 3. Toolbar Wiring

- Read the visibility hook inside `MessageInputToolbar` so both the normal
  composer toolbar and approval toolbar use the same preference.
- Hide low-risk chrome based on the visibility model:
  - slash menu;
  - model indicator;
  - microphone and speech-method selector;
  - context usage;
  - `/btw` button;
  - nudge button;
  - session status/liveness chips;
  - secondary queue buttons/toggle.
- Keep primary send/steer/queue behavior intact.

### 4. Follow-On Behavior Choices

- Decide whether "disable queued message input" should be a separate behavior
  setting rather than a toolbar visibility setting.
- Decide whether global nudge defaults should move out of Agent Context into a
  more appropriate settings category.
- Consider a separate per-device compact-toolbar preset for phones.

## Verification Checklist

- Toolbar controls default to visible in a fresh browser profile.
- Appearance settings toggles persist after reload.
- Toggling a control updates the preview and the session toolbar.
- Hidden nudge toolbar control does not remove the session `... -> Nudge...`
  menu entry.
- Hidden `/btw` toolbar control does not remove typed `/btw` command handling.
- Hidden queue controls do not alter server queue APIs or existing keyboard
  shortcuts.
