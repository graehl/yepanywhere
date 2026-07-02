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
- search match and selected-anchor projection;
- latest correctable prompt derivation;
- visible timeline entry derivation and timestamp ordering for turn groups plus
  `/btw` aside metadata;
- progressive timeline entry weighting and render-item target count derivation;
- progressive timeline visibility projection, including effective entry count,
  sliced entries, and progress percent;
- thinking duration derivation from render items plus `nowMs`;
- thinking count and latest-thinking-id derivation from render items;
- display render item filtering from render items plus the local thinking
  visibility flag;
- thinking id and text-length summary derivation for local expansion/follow
  effects.

`MessageList` still owns the stateful and DOM-local pieces: the previous item
ref, thinking expansion state, search session state and keyboard navigation,
correct-prompt action wiring, progressive reveal, selection, scroll anchoring,
and actual rendering.

## Still Local To MessageList

- Thinking visibility and expansion policy.
- Search session state, keyboard/repeat navigation, and selected-match updates.
- Correct-prompt action wiring.
- `/btw` aside ownership and rendering.
- Progressive reveal state, status UI, and timers.
- Scroll snapshots, follow-tail behavior, selection quote UI, and navigation.
- DOM measurement and row anchoring.

## Next Preflight Slice

Keep the Developer setting dogfood path default-off while moving one more pure
projection out of `MessageList`. The next low-risk candidate is visible
thinking text-delta detection from thinking text-length summaries plus the
local expansion predicate, while keeping follow/scroll effects local.
