# Turn-notch actions (fork / copy / trim)

> Fork-from-turn already exists in the session view. This topic covers
> exposing it (plus copy and the existing scrollback-trim) from the
> scrollbar-aligned turn notches via a context menu, and making fork seed the
> new tab's compose box with the turn it forked before.

Topic: fork-from-turn

Status: partly built. The turn-notch context menu (jump / fork / copy /
hide-previous) and fork compose-prefill are implemented. The next design step
is to replace the single fork entry with explicit **Fork before…** and **Fork
after…** actions, where **Fork after…** can use the composer as summary
instructions and create a fork whose later history is replaced by a generated
handoff summary.

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

## Proposal: fork before / fork after / fork-after-summary

Replace the current notch-menu **Fork from here** entry; no legacy label needs
to be preserved. The right-scroll turn marker context menu should stay narrow:

```text
Jump
Fork before…
Fork after…
Copy
Hide prev
```

The ellipsis means the action enters a fork composer mode or uses existing
composer text as instructions; it is not a wide modal opened from the notch.

### Anchor meanings

- **Fork before…** anchors before the selected user request. This is the retry
  path: discard the selected request's original assistant response and continue
  differently from that point.
- **Fork after…** anchors at the completed turn boundary for the selected user
  request: keep the user request and all assistant/tool output responding to it,
  then replace later history. In transcript terms, the anchor is the last
  active-branch message before the next user turn. If there is no later user
  turn, the anchor is the completed current tail once the session is idle.

The default for summary replacement is **Fork after…**, not **Fork before…**.
That preserves the original agent boot/orientation work: instruction-file load,
initial repository reads, planning, and any derived state already present in the
assistant/tool output responding to the initial request. Forking immediately
after the first raw user message risks making the successor repeat that work or
start before the evidence that the original agent used.

If the selected response is still being written, **Fork after…** must not
silently degrade to the pre-response anchor. Either wait for the assistant turn
to complete and then fork, or show a visible pending state with Cancel.

### Composer fork mode

Selecting **Fork before…** or **Fork after…** activates a visible composer mode.
If the composer already contains text, YA treats that text as summary
instructions. If the composer is empty, the mode changes the placeholder so the
user can enter summary instructions.

For **Fork after…**, the composer mode needs these actions:

```text
Fork after selected turn
Keeps this request and the agent response to it; replaces later turns with an
optional generated summary.

[Cancel] [No summary] [Fork with summary]
```

- **Cancel** returns the composer to normal and preserves the user's text.
- **No summary** creates a normal fork at the selected completed-turn anchor.
- **Fork with summary** sends the composer text as instructions for generating
  a handoff summary, creates the target fork at the selected completed-turn
  anchor, and submits the generated summary as the next user turn in that fork.

For **Fork before…**, the mode can share the same footer actions, but **No
summary** is the ordinary retry fork. A summary option is allowed but is less
central; its generated text would explain how to retry or modify the discarded
turn, not summarize a retained prefix.

### Keyboard shortcut

Add a composer shortcut for the fast path, tentatively `Ctrl+Alt+Enter`:

```text
Ctrl+Alt+Enter: fork after the initial turn with summary instructions
```

The shortcut uses the same composer fork mode and semantics as the context-menu
path, with the default anchor set to the completed first user turn — the first
user request plus the assistant/tool output that handled it. If the composer has
text, the shortcut sends it as summary instructions. If the composer is empty,
it activates the visible fork mode so the user can type instructions or choose
**No summary**.

The shortcut must be listed in the session keyboard-shortcuts popover. It must
not change normal Enter / Ctrl+Enter send behavior, and it must not send the
composer text to the current session.

### Summary generation flow

The current source session must not be polluted by a "summarize yourself" turn.
Generate the summary in a bounded helper path:

1. Create a temporary/full-context fork of the source session at the current
   source tail, or otherwise use the shared side-session helper envelope if that
   exists for this feature.
2. Submit a YA template plus the composer instructions to that summary-generator
   fork.
3. Capture the assistant's generated handoff summary.
4. Create the target fork at the selected **Fork after…** anchor.
5. Submit the generated summary as the next user turn in the target fork and
   navigate there.

The summary-generator fork is implementation scaffolding, not the user's target
branch. It should be cancellable, bounded by the helper-session lifecycle rules,
and either auto-archived or clearly marked so it does not clutter normal session
lists.

### Summary template contract

The generated prompt should make the retained prefix explicit so the summary
does not repeat work already present in the fork:

```text
Summarize the useful state after the retained fork boundary for a peer-agent
handoff. The target fork already includes the original request and the
assistant/tool work through the selected completed turn. Do not repeat setup,
instruction loading, initial repository orientation, or investigation already
present in that retained prefix.

The summary will be submitted as the next user turn in the target fork. Preserve
decisions, constraints, current state, changed files, verification evidence,
open risks, and the next useful action. Do not continue the task.

Additional user instructions:
<composer text, if any>
```

The submitted summary should be visibly distinguished from an ordinary
user-authored request in YA, e.g. as a collapsed or labeled **Fork handoff
summary** block, even if the provider receives it as a user-role message.

### Capability and default posture

Show these actions only where YA has a real prefix-fork primitive. Claude is the
validated provider today. Do not emulate a button named fork with a template
handoff on providers that cannot actually fork; that would hide a different cost
and context shape behind the same label.

This is an advanced explicit action. Normal composer send behavior remains
verbatim and unchanged; the feature is invoked only by the notch context menu or
the documented shortcut.

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
