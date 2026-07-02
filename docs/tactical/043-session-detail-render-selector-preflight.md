# Session Detail Render Selector Preflight

Topic: session-detail-data-layer

This note supports
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md).
It records the first render-selector boundary split from `MessageList`.

## Extracted Boundary

The first pure render boundary is now in
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
- turn grouping for user, assistant, and standalone display-object entries.

`MessageList` still owns the stateful and DOM-local pieces: the previous item
ref, thinking expansion state, search state, progressive reveal, selection,
scroll anchoring, and actual rendering.

## Still Local To MessageList

- Thinking visibility and expansion policy.
- Search anchor construction.
- `/btw` timeline entries and aside rendering.
- Progressive timeline slicing and reveal timers.
- Scroll snapshots, follow-tail behavior, selection quote UI, and navigation.
- DOM measurement and row anchoring.

## Next Preflight Slice

Keep the Developer setting dogfood path default-off while moving one more pure
projection out of `MessageList`. The next low-risk candidate is search/nav
anchor derivation from render items, because it is data-shaped but still feeds
DOM navigation owned by `MessageList`.
