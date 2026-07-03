# Thinking expansion: "latest-only" mode

Status: implemented 2026-06-13; right-click enriched 2026-07-03 (expand-all
now also seeds history and reveals hidden thinking). Right-click / long-press
the thought-transcript toggle in `ProcessingIndicator`; mode persists in
`localStorage` (`sessionThinkingLatestOnly`), off by default. A subtle dot on
the toggle marks latest-only when thinking is visible; the tooltip explains it.
Resolver `resolveThinkingItemExpanded` in `MessageList.tsx` is the single
source feeding both the render path and the streaming scroll-follow effect.

A second auto-expand policy for the thinking transcript, reachable by
**right-click / long-press on the thought-transcript toggle** in
`ProcessingIndicator` (the same button whose left-click hides/shows all
thinking). See also [`session-ui-customization.md`](session-ui-customization.md)
for the right-click/long-press hidden-control convention.

## Contract

Two auto-expand policies for thinking blocks, with manual per-block toggles
always winning:

- **all-new** (current default): every thinking block that arrives *after the
  view mounts* auto-expands and stays expanded (accumulating). Historical
  blocks present at mount start collapsed — until the right-click gesture
  seeds them (below).
- **latest-only** (the requested old behavior): only the single most-recent
  thinking block is auto-open; it auto-collapses the moment a newer block
  appears. Blocks the user manually opened/closed keep that explicit state.
  At mount with history, the last historical block is the one shown open.

"Last active one temporarily open" + "auto-collapse the entries that weren't
manually toggled" = exactly latest-only.

Left-click of the toggle still flips global visibility (`thinkingItemsVisible`).

## Right-click gesture (2026-07-03 semantics)

Right-click / long-press is the explicit "show me everything" ↔ "latest only"
gesture, not a bare policy bit-flip:

- **From hidden** (any policy): turn visibility on, set the policy to all-new,
  and auto-expand every thinking block currently in the transcript (historical
  included). Previously right-click while hidden flipped an invisible policy
  bit — clunky, observable only later.
- **From visible latest-only**: set all-new and auto-expand the full history
  the same way.
- **From visible all-new**: back to latest-only (non-pinned blocks collapse to
  just the latest).

The expand-all seeds `autoExpandedThinkingItemIds` with all current thinking
ids (`expandAllThinkingItems` in `MessageList.tsx`) — the same mechanism as
the pi provider's historical seeding. It also *clears manual-collapse
(`false`) overrides*: an explicit expand-all outranks an old per-block
collapse, and keeping the stale `false` would leave one confusing closed
block. Manual-open pins (`true`) are untouched. Scroll is preserved by the
existing `preserveScrollAfterTranscriptHeightChange` wrapper: at bottom the
view stays pinned to bottom (the toggle lives in the transcript's last line,
so its visibility implies at-bottom/follow); otherwise the first visible row
is re-anchored.

The tooltip now describes the *action* right-click will take from the current
state (`processingThinkingRightClick*` i18n keys), not the current mode.

## State model (current, all in `MessageList.tsx`)

| State | Type | Role | Persisted |
|---|---|---|---|
| `thinkingItemsVisible` | `boolean` | global render gate; when false, thinking items are filtered out of `displayRenderItems` entirely | yes (`sessionThinkingVisible` key, via `loadSessionThinkingVisible`/`saveSessionThinkingVisible`) |
| `autoExpandedThinkingItemIds` | `ReadonlySet<string>` | the all-new policy itself: seeding `useLayoutEffect` adds every newly-*observed* thinking id, prunes vanished ids | no (rebuilt each mount) |
| `thinkingExpansionOverrides` | `Record<string,boolean>` | explicit per-block user toggles; wins over auto | no |

Resolution today (`getThinkingItemExpanded`, and duplicated in the
streaming-scroll-follow `useLayoutEffect` ~L1419):

    overrides[id] ?? autoExpanded.has(id)        // else collapsed

## State the contract needs

**Exactly one new piece of stored state**, plus one derived value:

1. **New, persisted:** an auto-expand *mode* — `thinkingAutoExpandLatestOnly:
   boolean` (or a 2-value enum). One `useState` cell + one new `storageKeys`
   entry, seeded at construction and saved on right-click, mirroring how
   `thinkingItemsVisible` is persisted. This is the *only* genuinely new state.

2. **Derived, not stored:** `lastThinkingItemId` — a `useMemo` over
   `renderItems` returning the id of the last `type === "thinking"` item. No
   persistence, no extra `useState`.

Everything else the contract needs already exists:

- "manual toggles from earlier persist" → `thinkingExpansionOverrides` already
  does this and is already kept distinct from auto-expansion.
- "auto-collapse the others" → in latest-only the auto branch returns
  `id === lastThinkingItemId`; any non-last, non-overridden block resolves to
  collapsed with no stored state.
- "last one *temporarily* open" → because the auto branch is recomputed against
  the live `lastThinkingItemId`, a block that was last flips to collapsed when a
  newer block arrives **without mutating anything**. The "temporary" falls out
  for free; latest-only never needs to write to a set.

New resolver (single helper, replaces the two duplicated reads):

    override = overrides[id]
    if override !== undefined: return override
    return latestOnly ? id === lastThinkingItemId
                      : autoExpanded.has(id)

## Call-site sweep (shared-facility duty)

Expansion is read in two places; both must route through the one new resolver:

1. `getThinkingItemExpanded` (render path, L1932).
2. the streaming scroll-follow `useLayoutEffect` (~L1419) that uses the same
   `overrides[id] ?? autoExpanded.has(id)` to decide whether a thinking delta
   keeps following scroll. Must use the new resolver so follow tracks the
   actually-open (latest) block.

## A manual expand is a permanent pin (absolute override, never cleared)

Hard rule: **if the user ever expands a block, it never auto-hides** when a
newer block (in-progress or completed) becomes most recent. Only auto-opened
blocks are temporary.

This is exactly what the *current* `toggleThinkingItemExpanded` already does:
it writes `overrides[id] = !resolve(id)` and never clears the key. Once
`overrides[id] === true`, the resolver returns it regardless of
`lastThinkingItemId`, so the block stays open forever. **No change to the
toggle write logic is needed.**

`thinkingExpansionOverrides` is therefore a genuine tri-state and must stay one:

- `true`  — user pinned it open; never auto-hides.
- `false` — user manually collapsed it.
- absent  — follow the active policy (all-new or latest-only).

Do **not** "prune overrides that currently match auto" as a map-size
optimization: that would silently downgrade a `true` pin whose block happens to
be the current latest, then auto-collapse it on the next turn — violating the
rule. A `true` override is never cleared. (`false` overrides are different:
the explicit right-click expand-all clears them deliberately — see the
right-click gesture section above.)

Worked example (latest-only): pin A open. B starts streaming → B is latest so it
auto-opens *and* A stays (pinned): both open. B completes, C starts → B
auto-collapses (not pinned, no longer latest), A stays, C auto-opens.

## Edge cases / decisions

- **Keep maintaining `autoExpandedThinkingItemIds` in latest-only mode** even
  though it is unused for resolution there — costs nothing and makes a
  right-click back to all-new lossless (accumulated expansions return).
- **Mount divergence is intended:** latest-only opens the last historical block
  at mount; all-new opens none at mount (its seeding effect only auto-expands
  blocks observed *after* mount). This matches "always has the last active one
  open" — call it out, it is not a bug.
- **Persistence scope** should match `thinkingItemsVisible`: one global
  localStorage key applied to every session view, not per-session.
