# Toolbar Settings UI

> The Settings → **Toolbar** pane lets users pick which composer-toolbar
> controls are shown and, per control, how eagerly each collapses into the `…`
> overflow menu as the bar narrows ("narrowing priority").

Topic: toolbar-settings-ui

See also: [composer-bottom-bar-overflow.md](composer-bottom-bar-overflow.md)
(the runtime overflow engine the priority feeds) and
[session-ui-customization.md](session-ui-customization.md) (the broader
visibility-customization concern). This doc is the how-it-works reference for
the pane itself.

## Where

`packages/client/src/pages/settings/ToolbarSettings.tsx` (pane, category id
`toolbar`), rendering `SessionToolbarPreview` / `ToolbarControlPreview` from
`packages/client/src/components/SessionToolbarPreview.tsx`. State comes from two
mirror hooks: `useSessionToolbarVisibility` (which controls are shown) and
`useSessionToolbarPriority` (each shown control's narrowing priority).

## Layout contract

The pane is three stacked pieces, top to bottom:

1. **Live top preview** — a full, faithful, inert render of the composer
   toolbar with the user's actual visibility + priority
   (`SessionToolbarPreview`). Its job is **spatial memory**: it shows the
   visible controls in their real left-to-right positions so a user can locate
   one by where it sits, not by reading a list.
2. **Hidden zone** (first) — controls that are currently off. Split into **two
   side-groups**, left-aligned and right-aligned (matching the toolbar edge the
   control lives on; either group may be empty and shows "None hidden"). The two
   groups render as **two columns when there is room** and stack to one when
   narrow (`grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`). Each
   row is a specimen preview + copy + an on-slider. Hidden-first is deliberate:
   off controls are the ones a user is hunting for to re-enable, and putting
   them up top makes them scannable even though the live preview already locates
   the *visible* ones.
3. A thin **separator**, then the **Shown zone** — visible controls in
   left-to-right toolbar order, one full-width row each: specimen preview +
   copy + a **narrowing-priority radio** + a quick **× Hide**.

Both zones show a **per-row specimen** (`ToolbarControlPreview`) so a row is
identified by the actual element, not just text. That specimen is somewhat
redundant with the top preview by design — recognizing a control should not
require cross-referencing.

## Narrowing-priority model

Priority answers "as the toolbar narrows, when does this control fold into the
`…` menu?" Levels, highest-survival first:

| value  | meaning                              | legacy tier |
|--------|--------------------------------------|-------------|
| `pin`  | never collapses (no menu copy)       | (always-on) |
| `last` | collapses last                       | `late`      |
| `mid`  | collapses in the middle              | `medium`    |
| `first`| collapses first                      | `early`     |

Defaults reproduce the previously-hardcoded tiers exactly, so nothing changes
until a user reconfigures: `modeSelector,attachments → first`;
`slashMenu,thinkingToggle → mid`; `renderMode,nudge,shortcutsHelp → last`;
every always-on control (`microphone, waveform, steerNow, contextUsage, btw,
sessionStatus, projectQueue`) → `pin`. `MessageInputToolbar` derives each
overflow control's tier CSS class from its priority (`priorityToTierClass`); the
measured-width collapse logic is otherwise unchanged (see
`composer-bottom-bar-overflow.md`).

## Edit surfaces & persistence

- **Shown-zone priority radio** — sets `useSessionToolbarPriority.setControlPriority`.
- **× Hide / on-slider** — `useSessionToolbarVisibility.setControlVisible`,
  moving the row between the Shown and Hidden zones.
- **Header undo / Reset** — snapshot restore covers both maps; Reset clears both.

Both settings persist to **localStorage** and sync to server
`clientDefaults.sessionToolbarVisibility` / `clientDefaults.sessionToolbarPriority`
(server parse/merge in `packages/server/src/routes/settings.ts`), mirroring each
other exactly.

Implementation note: hidden rows are a `<div>`, not a `<label>` — the row embeds
the inert `ToolbarControlPreview` (which renders real `<button>`/`<input>`
elements), so a wrapping label would associate with a control inside the preview
instead of the visibility checkbox. The toggle carries its own `<label>`.

## Status / follow-ups

- **Right-side priority is configurable but not yet functionally effective.**
  Right-aligned / always-on controls expose a priority radio for settings-UI
  uniformity (so every shown control edits the same way), but the runtime
  overflow engine does not yet collapse them — they stay pinned in practice.
  Landed this way deliberately (a `Known coverage gaps` in the commit). The
  committed follow-up is to make right-side priority actually fold those
  controls, because offering a control that silently does nothing is itself the
  confusion this pane removes.
- **Clickable top preview (edit-in-preview) is a follow-up.** The top preview is
  currently read-only (spatial memory only); the Shown-zone priority radio + ×
  Hide are the editing surface. A future pass can let clicking a control in the
  top preview open the same priority/Off choice.
