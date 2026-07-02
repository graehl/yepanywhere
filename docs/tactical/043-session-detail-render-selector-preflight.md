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
- turn grouping for user, assistant, and standalone display-object entries;
- user-turn navigation anchors;
- user-turn and all-turn search anchors.

`MessageList` still owns the stateful and DOM-local pieces: the previous item
ref, thinking expansion state, search state, full-session explored search
assembly, progressive reveal, selection, scroll anchoring, and actual
rendering.

## Still Local To MessageList

- Thinking visibility and expansion policy.
- Full-session search anchor construction for explored assistant segments.
- `/btw` timeline entries and aside rendering.
- Progressive timeline slicing and reveal timers.
- Scroll snapshots, follow-tail behavior, selection quote UI, and navigation.
- DOM measurement and row anchoring.

## Next Preflight Slice

Keep the Developer setting dogfood path default-off while moving one more pure
projection out of `MessageList`. The next low-risk candidate is full-session
search anchor derivation, including explored assistant segments, because it is
still data-shaped but depends on `MessageList`'s current assistant-segment
projection helpers.
