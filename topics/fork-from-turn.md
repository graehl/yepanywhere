# Turn-notch actions (fork / copy / trim)

> Fork-from-turn already exists in the session view. This topic covers
> exposing it (plus copy and the existing scrollback-trim) from the
> scrollbar-aligned turn notches via a context menu, and making fork seed the
> new tab's compose box with the turn it forked before.

Topic: fork-from-turn

Status: **partly built (fork exists); notch context menu + compose-prefill proposed.**

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

## Proposed enhancement

1. **Context menu on the notches** (right-click + long-press for touch) offering
   **Fork**, **Copy**, and **Trim** ("load from here", the current dot action).
   The plain click stays a jump; the menu adds the heavier actions and is the
   only way to reach them on mobile.
2. **Fork seeds the new tab's compose box.** On fork-before a user turn, write
   that turn's text to `localStorage["draft-message-" + newSessionId]` before
   navigating, so the forked session opens with the old turn pre-filled — a
   "branch and retry this turn differently" flow. (Not implemented today; the
   existing fork drops the turn without surfacing it.)
3. **Copy** copies the full turn text (not the truncated `marker.preview`), so
   the marker→message-text mapping is resolved in `SessionPage` (which holds
   `messages`); `UserTurnNavigator` just invokes `onCopy(markerId)` / `onFork(
   markerId)`.

## Open questions / decisions

- Context-menu interaction model on touch (long-press) vs. desktop (right-click),
  and whether it reuses the row `…` menu styling from the hovercard topic's
  mobile proposal (shared dismiss rules: tap-outside / option / re-tap).
- Fork anchors *before* the selected turn; confirm the prefilled text is that
  selected turn (the one excluded from the fork), not the anchor.
- Non-`supportsForkSession` providers: hide Fork in the menu (leave Copy/Trim).
