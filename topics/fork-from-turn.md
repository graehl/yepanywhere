# Turn-notch actions (fork / copy / trim)

> Fork-from-turn already exists in the session view. This topic covers
> exposing it (plus copy and the existing scrollback-trim) from the
> scrollbar-aligned turn notches via a context menu, and making fork seed the
> new tab's compose box with the turn it forked before.

Topic: fork-from-turn

Status: **built** — fork existed; the turn-notch context menu (jump / fork /
copy / hide-previous) and fork compose-prefill are now implemented.

See also:
[session-hovercard-recent-activity](session-hovercard-recent-activity.md) (the
sibling mobile context-menu / dismiss discussion),
[provider-agnostic-btw-asides](provider-agnostic-btw-asides.md) (the other fork
consumer),
[scrollback-view-stability](scrollback-view-stability.md) (the client transcript
window the trim dot controls).

## What already exists (do not rebuild)

- **Fork from a turn.** `SessionPage.forkBeforeUserMessage(messageId)` forks the
  session from just *before* a user message: it finds the prior user/assistant
  message as the anchor and calls `api.forkSession(projectId, sessionId,
  { upToMessageId: anchor })`, then navigates to the new session. Gated by
  `currentProviderInfo.supportsForkSession`. Surfaced per-turn through
  `MessageList` `onForkBeforeUserMessage` → `RenderItemComponent`
  `onForkBeforeUserPrompt` / `onForkBefore`.
- **Scrollbar turn notches.** `UserTurnNavigator` renders, per user turn, a jump
  marker (`handleAnchorClick`) **and** a trim dot (`onTrimAnchor(markerId)` —
  "load client transcript from this turn", i.e. drop earlier scrollback).
- **Compose drafts** are plain `localStorage[\`draft-message-${sessionId}\`]`
  (SessionPage builds that key; `useDraftPersistence(key)` reads it directly —
  no install-id indirection for the session composer).

## Implemented

1. **Context menu on the notches.** `UserTurnNavigator` markers take
   `onContextMenu` (desktop right-click) and a ~450ms long-press (touch) that
   open a portaled menu (`.user-turn-nav-context-menu`) anchored with its right
   edge at the pointer, opening leftward (notches sit at the right edge).
   Items: **Jump to turn**, **Fork from here** (`onForkAnchor`), **Copy turn**
   (`onCopyAnchor`), **Hide previous** (`onTrimAnchor`). Plain click still jumps;
   the trim dot still trims. Dismiss: transparent overlay click, Escape, or
   selecting an item. New props are optional, so items render only when wired.
2. **Fork seeds the new composer.** `SessionPage.forkBeforeUserMessage` writes
   the selected turn's text to `localStorage["draft-message-" + newSessionId]`
   before navigating; the composer reads that key via `useDraftPersistence`.
   "Branch and retry this turn." `turnContentText()` extracts the text (shared
   with copy).
3. **Copy** uses the full turn text, resolved in `SessionPage` (`copyUserMessage`
   → `onCopyUserMessage` → `onCopyAnchor`), not the truncated `marker.preview`.
   Silent (matches the existing copy-prompt action; no toast / i18n key added).

Wiring: `SessionPage` → `MessageList` (`onForkBeforeUserMessage`,
`onCopyUserMessage`, `onTrimBeforeUserMessage`) → `UserTurnNavigator`
(`onForkAnchor`, `onCopyAnchor`, `onTrimAnchor`). Fork stays gated by
`supportsForkSession` (`SessionPage` passes `undefined` otherwise, so the menu
omits Fork).

## Open questions / follow-ups

- Long-pressing a right-edge notch is a small touch target; may want a larger
  hit area or to surface the menu from the wider preview label on touch.
- Whether to share one context-menu component with the hovercard topic's mobile
  row-`…` menu proposal (shared dismiss rules).
- Copy has no visible confirmation (silent); add a toast if desired.
