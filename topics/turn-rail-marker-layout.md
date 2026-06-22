# Turn-rail marker layout (hit targets + de-cluster spread)

> The scrollbar turn-rail (`UserTurnNavigator`) draws a dash + dot per user
> turn. Their hit/hover targets must match the visible marks — no oversized
> zones that activate blank space, and no z-order confusion in dense clusters.
> This is option **B** (targets sized to neighbor gaps) shipped, plus option
> **A** (de-cluster spread) enabled at a cozy min-gap via one internal constant.

Topic: turn-rail-marker-layout

See also: [fork-from-turn](fork-from-turn.md) (the notch context menu these
markers carry), [scrollback-view-stability](scrollback-view-stability.md).

## The bug (root cause)

Each marker's hit/hover target was a **fixed 22px box** (`height:22px;
margin-top:-11px`) centered on a ~3px dash. Markers render at their true scroll
positions with no de-clustering, so in a cluster the 22px boxes overlap heavily;
their union reaches ~9px above the topmost dash and ~13px below the bottommost
and blankets the gaps — blank space activates a marker. Overlap + stacking (later
= lower markers on top) means hovering a cluster activates the *lower* overlapping
marker, so the blue activation sits below the pointer. It was never a coordinate
offset — the `%` hitbox, the dash, and the tooltip all share `topPct ×
trackHeight`; the target was simply far larger than the mark and never tiled.

## B — hit targets sized to neighbor gaps (shipped)

Per marker, the hit/hover target height = `clamp(min(gapAbove, gapBelow),
MARKER_HIT_MIN_PX, MARKER_HIT_MAX_PX)`, centered on the dash (set inline; the dash
line and dot center via `top:50%`). So targets tile without overlap, never reach
past the midpoint to a neighbor, and are capped for isolated/edge markers — blank
space no longer activates, and the topmost overlapping marker no longer wins a
cluster. Dashes stay at their **true** positions.

## A — de-cluster spread (enabled, cozy)

`MARKER_SPREAD_PX` is the single tuning constant: **0** = accurate/status quo;
**9** (current) = a cozy gap just above the dot footprint (~6px circle + ~1px
shadow) so dashes/dots stay tight but non-overlapping. When > 0, dense markers
are pushed apart to at least that px gap before targets are sized, so the dashes
spread to match their targets. Sparse markers keep true positions; in extremely
long sessions `N×gap` can exceed the rail and markers pile up at the bottom.

The spread is **L2-optimal and local**: it minimizes total squared displacement
from true positions subject to `pos[i+1] − pos[i] ≥ gap`. Substituting `w_i =
y_i − i·gap` turns the gap constraint into "w non-decreasing", i.e. isotonic
regression, solved by **pool-adjacent-violators** in O(n) (`spreadMinGap`).
Consequence the user asked for: far-apart clusters keep their true positions and
spreading one cluster never shoves it into the next — only genuinely colliding
runs are pooled and spread (to exactly `gap`, centered on their centroid).

Both paths feed a per-marker `renderTopPct` (= `topPct` when spread is off); the
dash, dot, hit target, and preview label all use it, so they stay aligned.

## Config visibility

`MARKER_SPREAD_PX`, `MARKER_HIT_MIN_PX`, `MARKER_HIT_MAX_PX` are internal tuning
constants in `UserTurnNavigator.tsx`, **not** user-facing settings. If a setting
is ever wanted, expose `MARKER_SPREAD_PX` (0 → max) as the one knob.
