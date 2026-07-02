# Session Detail Render Selector Preflight

Topic: session-detail-data-layer

This note supports
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md).
It records the render-selector boundary split from `MessageList`.

## Extracted Boundary

The pure render boundary is now in
`packages/client/src/lib/sessionDetail/renderSelectors.ts`.

Covered inputs:

- `messages`;
- `markdownAugments`;
- `activeToolApproval`;
- `transcriptDisplayObjects`;
- optional `previousRenderItems` for stable object reuse.

Covered outputs:

- preprocessed `RenderItem[]`;
- inserted transcript display objects;
- stable render item object reuse;
- turn grouping for user, assistant, and standalone display-object entries;
- assistant render segments, including explored tool runs;
- user-turn navigation anchors;
- user-turn, all-turn, and full-session search anchors;
- search-driven visible turn-group filtering.

`MessageList` still owns the stateful and DOM-local pieces: the previous item
ref, thinking expansion state, search state, search match selection,
progressive reveal, selection, scroll anchoring, and actual rendering.

## Still Local To MessageList

- Thinking visibility and expansion policy.
- Search query matching, selected-match state, and preview snippets.
- `/btw` timeline entries and aside rendering.
- Progressive timeline slicing and reveal timers.
- Scroll snapshots, follow-tail behavior, selection quote UI, and navigation.
- DOM measurement and row anchoring.

## Next Preflight Slice

Keep the Developer setting dogfood path default-off while moving one more pure
projection out of `MessageList`. The next low-risk candidate is search match
projection from anchors, query, and case-sensitivity into matches, match id
sets, selected anchors, and preview snippets while DOM navigation remains local
to `MessageList`.
