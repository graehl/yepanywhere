# Transcript row hover rerenders the message list

Desktop pointer movement across transcript rows updates
`hoveredRowTimestampMs` in `packages/client/src/components/MessageList.tsx`.
Each row whose timestamp differs therefore rerenders the `MessageList` root so
the composer can display the hovered turn's relative age. Turn-rail marker
hover and settled scroll position use the same root-owned timestamp selection,
which is then published through `SessionPage` state to the composer.

A browser-debug trace against current commit `3449d4f482fb` captured the
reported long-session tab after it had become idle. A bounded synthetic hover
over 20 mounted transcript rows caused 19 complete `MessageList` commits:

- 293.3 ms aggregate commit time over 598.5 ms wall time;
- zero conversation-projection or transcript-preprocessing passes; and
- zero browser long tasks during the control.

The preceding lease history had recorded 275 `MessageList` commits consuming
2,258.1 ms, while 14 Conversation View projections consumed 80.8 ms and peaked
at 11.3 ms. A separate 20-second idle control produced no stream events,
projections, preprocessing, prop changes, or message-list commits. This
supports two distinct conclusions: Conversation View projection is not the
dominant measured owner, and ordinary row hover independently invalidates the
transcript root. The latter can delay paragraph-hover quote-reply appearance
when active session work is already competing for the main thread.

The user also observed successful hover updates appearing for rows the pointer
had already passed, with delay increasing along the trail. This affected both
the right-side per-paragraph quote-reply column and the adjacent turn-wide
action row that appears on hover. The current row handler gives every crossed
timestamp ordered React state rather than marking older targets obsolete. This
transcript-specific amplification is one source of the broader latest-pointer
correctness gap recorded in
`gaps/stale-hover-intent-is-not-preempted.md`.

The selected optimization boundary is a small position-context store or
equivalent leaf-owned controller. Transcript row hover, turn-marker hover, and
settled scroll measurements should update refs and publish only a changed
effective timestamp; only the composer status leaf should subscribe. Preserve
the current precedence of marker hover over row hover over settled scroll
position. Moving only the row setter into `SessionPage` is insufficient if it
continues to rerender the session page on every crossed row.

Publication must be latest-wins rather than FIFO. The pointer handler should
overwrite one pending target and schedule at most one replaceable frame
publication. After a main-thread stall, obsolete intermediate targets must be
discarded instead of painted in sequence.

Acceptance should prove that crossing timestamped transcript rows causes zero
`MessageList`, historical-row, projection, and preprocessing renders while the
composer age changes and restores correctly. Repeat in Conversation View and
full transcript mode, with paragraph-hover quote reply enabled, and during an
active streaming turn. No slowdown injection is needed to select this fix. A
bounded slowdown injection is needed for the backlog contract: cross several
rows while the main thread is delayed, then prove that only the current target
can publish after recovery and that pointer-leave cancels every pending target.

The simultaneous sidebar-hover delay was observed by the user but was not
causally reproduced by this control. Treat it as shared main-thread starvation
unless a sidebar-specific trace demonstrates expensive hover-card work. The
rapid-activity/session-switching case in
`gaps/cached-sidebar-high-cadence-catch-up.md` is a separate open cross-product.

This was recorded rather than fixed because the requested scope was to retain
the diagnostic findings and candidate optimization.

Found 2026-08-31 while diagnosing mouseover latency in a consented real-work
browser tab.
