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
- search-driven visible turn-group filtering;
- search match and selected-anchor projection.
- latest correctable prompt derivation.

`MessageList` still owns the stateful and DOM-local pieces: the previous item
ref, thinking expansion state, search session state and keyboard navigation,
correct-prompt action wiring, progressive reveal, selection, scroll anchoring,
and actual rendering.

## Still Local To MessageList

- Thinking visibility and expansion policy.
- Search session state, keyboard/repeat navigation, and selected-match updates.
- Correct-prompt action wiring.
- `/btw` timeline entries and aside rendering.
- Progressive timeline slicing and reveal timers.
- Scroll snapshots, follow-tail behavior, selection quote UI, and navigation.
- DOM measurement and row anchoring.

## Next Preflight Slice

Keep the Developer setting dogfood path default-off while moving one more pure
projection out of `MessageList`. The next low-risk candidate is visible
timeline entry derivation from visible turn groups plus `/btw` aside metadata,
while keeping `/btw` ownership, progressive timers, and DOM rendering local.
