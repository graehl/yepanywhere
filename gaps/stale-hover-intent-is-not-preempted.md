# Stale pointer-region intent is not preempted

During active Conversation View updates, sidebar item highlights, tooltips,
and transcript hover affordances appeared for areas the pointer had already
crossed, with the visible result falling progressively farther behind the
pointer. Eventual rendering of every intermediate hover is not success: hover
represents current pointer intent, so an older target becomes valueless as soon
as a newer target or pointer-leave exists.

The exact sidebar owner is not yet attributed. Session-row highlighting is
CSS `:hover`, while the rich preview uses
`packages/client/src/hooks/useSessionHoverCardController.ts`, which owns
pointer-rest timers and clears them on processed pointer leave. Either surface
can still appear stale when unrelated synchronous work prevents the browser
from processing current pointer state and painting it. The demonstrated
transcript amplifier is recorded separately in
`gaps/transcript-hover-rerenders-message-list.md`: crossing 20 mounted rows
caused 19 full `MessageList` commits totaling 293.3 ms.

Treat preemption and skipping as a UI correctness requirement for ephemeral
pointer state, whether the pointer is hovering or a button is held:

- handlers record only the newest target and remain constant-time;
- pending hover publication is replaceable and occurs in one sweep per frame;
- expensive work carries an intent generation and drops its result when a
  newer target or leave supersedes it;
- work too large to cancel once started is split or yielded so current pointer
  state can be processed and painted; and
- after recovery from a stall, the UI may show only the current target, or no
  target after leave, never a FIFO replay of crossed targets.

For a single-selection hover surface, define `publishedRegion` as the region
whose highlight was emitted in the previous sweep and `latestRegion` as the
most recent normalized mouse-region event, including `null` for leave. Events
before the next animation frame only overwrite `latestRegion`. The frame sweep
compares those two values:

1. If they match, emit no edge.
2. If `publishedRegion` is non-null, emit exactly one essential
   `off(publishedRegion)` edge.
3. If `latestRegion` is non-null, emit exactly one `on(latestRegion)` edge.
4. Store `latestRegion` as the new `publishedRegion`.

The off edge precedes the on edge so the surface never has two selected
regions. Thus one frame performs at most one off edge and at most one on edge,
regardless of how many regions the pointer crossed. For example, a published
`A` followed by `A -> B -> C` before the frame becomes only `off(A), on(C)`;
`B` receives no work. A published `A` followed by `B -> outside` becomes only
`off(A)`. Entering and leaving while nothing was published emits nothing.

A mouse-down highlight-region sweep follows the same rule with a range or
region set as its replaceable value. Before each frame, intermediate pointer
positions or selection snapshots only replace `latestRange`. A YA-owned
highlight update clears at most the previously published range and paints at
most the latest range; if no application feedback is needed during the drag,
pointer release publishes the completed range once instead. Native text
selection paint remains browser-owned, but YA `selectionchange` observers must
not perform React, source-extraction, or geometry work for every intermediate
native range.

This is already the intended selection contract in
`topics/selection-comment-ui.md`: primary-pointer dragging keeps selection
controls absent, intermediate selection changes do no React state work, and
release publishes once. `tasks/070-selection-action-lag.md` records why: before
that suppression, 30 selection-change events in a large file viewer took
618–779 ms. That prior defect is evidence that mouse-down sweeps belong to the
same latest-intent class. It does not yet prove that the currently observed
stale highlight sweep reaches the same implementation path.

This is the default interaction contract for all YA-themed pointer-driven
tooltips, highlights, hover cards, and action reveals. Native tooltips remain
owned by the browser or platform engine and are outside this gap. In the
transcript it specifically includes the per-paragraph quote-reply column
(`.text-block-quote-rail`) and the turn-wide action row beside it
(`.text-block-actions`, with analogous user turn actions under
`.user-prompt-actions`): crossing one paragraph or turn must make every
superseded rail target ineligible to appear. It also applies to sidebar row
highlight and hover cards, transcript row age, turn-rail previews, and future
pointer-driven previews. It does not require speculative computation for every
area the pointer crossed; knowing the current pointer target is the
cancellation signal.

Use bounded slowdown injection for the regression because the defect is the
ordering under backlog, not steady-state handler duration. Delay a known
non-urgent transcript/render phase while moving across several sidebar rows,
transcript rows, tooltip targets, and both transcript action rails, then repeat
while holding the primary button across highlight regions. Record pointer
target or range, intent generation, publication, and paint order. Acceptance
requires zero obsolete post-recovery tooltips, highlights, actions, or cards,
bounded work independent of the number of crossed regions, and immediate
settling on the final target or range. Pointer-leave and pointer-release arms
must settle with no target and the final range respectively. The deterministic
cases above must also prove edge count and order, including child-to-child
pointer transitions that normalize to the same owning region.

This was recorded rather than fixed because the requested scope was to retain
the UI correctness principle and its diagnostic requirement. The sidebar's
specific blocking owner and the causal identity of the remaining mouse-down
highlight symptom still need the targeted injected trace.

Found 2026-08-31 while diagnosing delayed mouseover feedback during active
session rendering.
