# Toolbar Settings UI

> The Settings → **Toolbar** pane lets users pick which composer-toolbar
> controls are shown and, for overflow-supported controls, how eagerly each
> collapses into the `…` overflow menu as the bar narrows ("narrowing
> priority").

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
`useSessionToolbarPriority` (stored narrowing-priority defaults).

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
   row uses the same control-row style as Shown: specimen preview, copy,
   priority choices for overflow-supported controls, and a compact command to
   show the control. Hidden-first is deliberate: off controls are the ones a
   user is hunting for to re-enable, and putting them up top makes them
   scannable even though the live preview already locates the *visible* ones.
3. A thin **separator**, then the **Shown zone** — visible controls in
   left-to-right toolbar order, one column that matches a single Hidden-zone
   column once that width can fit the shown-row controls, otherwise using the
   row's practical floor (capped by the pane). Each row has a specimen preview,
   copy, and a quick **× Hide**; rows for controls that the runtime overflow
   engine can actually move also show a **narrowing-priority radio**.

Both zones show a **per-row specimen** (`ToolbarControlPreview`) so a row is
identified by the actual element, not just text. The specimen is also an
activation surface for the row's editing menu/popover: pointer and keyboard
activation on the specimen must reach the same Off/priority controls as the
row's explicit controls. The specimen is somewhat redundant with the top preview
by design — recognizing a control should not require cross-referencing.

Row placement is stable during one visit to the pane. Hidden vs Shown section
membership is anchored to the visibility snapshot from pane entry, not recomputed
from each click. A Show/Hide click updates the real toolbar preview, persists
the setting, and changes the row's in-place command/state, but the row does not
jump to the other section until the user reloads, re-enters the settings pane, or
otherwise accepts a fresh saved baseline. Undo returns both the real toolbar
state and the row's in-place controls to the pane-entry snapshot.

Action-dependent specimens may provide invisible support context that the real
toolbar requires to construct the control, but the visible specimen remains
single-control: the `Project Queue` row shows only the project-queue button,
the `Now` row shows only the steering toggle, and neither row should leak the
primary send button or disappear because an adjacent send context was omitted.

## Narrowing-priority model

Priority answers "as the toolbar narrows, when does this control fold into the
`…` menu?" Levels, highest-survival first:

| value  | meaning                              | legacy tier |
|--------|--------------------------------------|-------------|
| `pin`  | never collapses (no menu copy)       | (always-on) |
| `last` | collapses last                       | `late`      |
| `mid`  | collapses in the middle              | `medium`    |
| `first`| collapses first                      | `early`     |

Defaults preserve the runtime collapse order: `modeSelector,attachments →
first`; `slashMenu,thinkingToggle → mid`; `renderMode,nudge,shortcutsHelp →
last`. Right-side controls (`sessionStatus`, `contextUsage`, `btw`, `steerNow`,
`projectQueue`) are priority-editable and default to `pin`, preserving today's
out-of-box toolbar unless the user chooses to collapse them. `MessageInputToolbar`
derives each supported overflow control's tier CSS class from its priority
(`priorityToTierClass`); the measured-width collapse logic is otherwise
unchanged (see `composer-bottom-bar-overflow.md`). The settings pane only shows
the priority radio for controls in that supported set, so a visible editor
always maps to real runtime behavior. `microphone` and `waveform` remain outside
the priority editor: microphone is the primary speech trigger, and waveform is
elastic capture feedback rather than a fixed-width collapsible control.

## Edit surfaces & persistence

- **Priority choices** — shown for every overflow-supported control in both
  Hidden and Shown rows; sets
  `useSessionToolbarPriority.setControlPriority`.
- **Show / Hide command** — sets `useSessionToolbarVisibility.setControlVisible`,
  updating the live toolbar and the row's in-place state without immediately
  moving the row between Hidden and Shown.
- **Specimen activation** — opens or focuses the row's Off/priority editing
  surface for that control; it must not be a dead visual-only affordance.
- **Header undo / Reset** — snapshot restore covers both maps; Reset clears both.

Both settings persist to **localStorage** and sync to server
`clientDefaults.sessionToolbarVisibility` / `clientDefaults.sessionToolbarPriority`
(server parse/merge in `packages/server/src/routes/settings.ts`), mirroring each
other exactly.

Implementation note: hidden rows must not use the old toggle-switch visual
language. Hidden and Shown rows are variants of one control-row component; the
visibility command changes label/action, while the priority surface stays
available whenever the runtime overflow engine supports that control.

## Status / follow-ups

- **Remaining non-priority controls are deliberate exclusions.** Priority
  storage still mirrors every visibility key so existing and future defaults can
  round-trip, but the pane exposes the radio only where the runtime overflow
  engine has a real menu copy. A future speech-specific design can revisit
  microphone/waveform without implying that today's row should show deceptive
  priority choices for them.
- **Regression cases to preserve.** Tests should keep covering row-specimen
  activation, Hidden rows retaining priority choices, action specimens showing
  only their own visible control, and Show/Hide changes not relocating rows
  during the same pane visit.
