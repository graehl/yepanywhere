# Session Resize Performance

Status: Implemented; manual breakpoint verification pending

Progress:

- [x] 2026-06-13: Captured a reproducible Chromium profile on a long local
  Codex session.
- [x] 2026-06-13: Identified resize-driven route/session re-rendering as the
  first fix target, ahead of transcript virtualization.
- [x] Reduce resize propagation from per-pixel viewport width state to
  breakpoint state.
- [x] Stabilize session transcript props that currently change identity during
  layout-only parent renders.
- [x] Re-profile the same long session and record before/after observations.
- [ ] Manually verify sidebar breakpoints, mobile overlay behavior, and desktop
  expanded/collapsed sidebar behavior.

## Context

Users can see very slow transcript width updates when resizing a browser window
while viewing a long session. The worst reports are inconsistent: they depend
on session length, row mix, whether the session is live, and whether the
resize is a single jump or many small intermediate width changes.

The architectural background is already captured in
`ARCHITECTURE.md` and `packages/client/RENDERING_PERFORMANCE.md`:

- `MessageList` renders the full mounted transcript today.
- Client transcript virtualization is a large-scope proposal, deferred until a
  real long-session profile shows row count is the dominant cost.
- Resize/scroll preservation must respect the scrollback stability rules in
  `topics/scrollback-view-stability.md`.

This tactical slice intentionally avoids transcript virtualization and avoids
changing `MessageList` scroll-anchor behavior. It targets unnecessary React
work caused by layout state changing on every intermediate resize width.

## Baseline Profile

Profile target:

- URL:
  `https://127.0.0.1:3400/projects/L1VzZXJzL2tncmFlaGwvY29kZS95ZXBhbnl3aGVyZQ/sessions/019e8863-41cc-7083-a08a-056df1355a04`
- Session provider: Codex
- Session ownership during profile: `owner: none`
- API message count: 2,175 raw messages
- Rendered DOM rows: 1,366 `data-render-id` elements
- Grep summary rows: 51
- Transcript height: roughly 99k px at 1400px viewport width
- Browser: Playwright Chromium, headless, local HTTPS with
  `ignoreHTTPSErrors`
- Build mode: dev/Vite, so React dev runtime overhead is present

Clean stepped resize profile, `1400 -> 800` in 10px steps:

- Wall time: 4,576 ms
- Browser task time: 3.85 s
- Script time: 2.04 s
- Layout time: 0.63 s
- Style recalculation: 0.25 s
- Layout count: 4,637
- Recalc style count: 4,583
- Top sampled JS included:
  - React dev JSX runtime
  - `MessageAge`
  - `formatCompactRelativeAge`
  - `getBoundingClientRect`
  - React context propagation / begin work

Clean single-jump profile, `1400 -> 800`:

- Browser task time: 0.28 s
- Script time: 0.04 s
- Layout time: 0.12 s
- Style recalculation: 0.08 s
- Layout count: 300
- Recalc style count: 301

Instrumented stepped profile:

- `window.resize` listeners installed by the app: 6
- `ResizeObserver` instances installed by the app/renderers: 55
- ResizeObserver callbacks during stepped resize: 869
- `getBoundingClientRect()` calls during stepped resize: 6,264
- `scrollHeight` reads during stepped resize: 131

Diagnostic controls:

- Suppressing `window.resize` listeners before app startup reduced stepped
  script time from roughly 2.04 s to roughly 0.35 s.
- Suppressing both `window.resize` listeners and `ResizeObserver` callbacks
  reduced script time to roughly 0.16 s, while full-transcript browser layout
  cost remained.

Interpretation:

- The full mounted transcript is expensive to lay out at every intermediate
  width.
- YA also adds avoidable script work by propagating every pixel of viewport
  width through React route/layout state.
- The immediate tactical target is to make layout-only resizing behave closer
  to the single-jump case by updating React only when responsive breakpoints
  actually change.

## Suspected Mechanism

`NavigationLayout` currently calls `useViewportWidth()`, which stores
`window.innerWidth` in React state on every resize event. The layout only needs
coarse decisions:

- whether desktop layout is active;
- whether the expanded sidebar can fit;
- whether a mobile overlay should close after crossing into desktop layout.

Those decisions change at thresholds, not at every pixel.

Because `SessionPage` consumes the navigation outlet context, per-pixel layout
state changes can re-render the session route. `MessageList` is memoized, but
some props passed from `SessionPage` are inline callbacks, so a layout-only
parent render can still invalidate the transcript component and walk the full
message list.

The CPU profile corroborates this: timestamp formatting and React dev JSX work
appear near the top of stepped-resize samples, while a single resize jump is
much cheaper.

## Implementation Direction

First slice:

1. Replace `NavigationLayout`'s per-pixel viewport-width dependency with a
   small responsive state object:
   - `isWideScreen`
   - `canShowExpandedSidebar`
2. Recompute that state on resize, but commit React state only when one of the
   booleans changes.
3. Recompute immediately when `sidebarWidth` changes, because the expanded
   sidebar threshold depends on the user's configured sidebar width.
4. Memoize `NavigationLayout` outlet context and callbacks so route consumers
   do not see a fresh context object on every parent render.
5. Stabilize the obvious inline callbacks passed from `SessionPage` to
   `MessageList`.

Out of scope for this slice:

- Transcript virtualization.
- Changing `MessageList` scroll-anchor/auto-follow behavior.
- Removing renderer-specific `ResizeObserver` paths.
- Caching `MessageAge` formatting.

## User-Visible Expectations

Expected visible change:

- Browser/sidebar resizing should update the transcript width with less
  visible lag, especially in long sessions.

Intended non-changes:

- Same desktop breakpoint.
- Same expanded-sidebar fit threshold.
- Same mobile sidebar overlay behavior.
- Same scroll-to-bottom and scrolled-back anchor behavior.
- Same transcript content, grouping, and renderer behavior.

Potential subtle visible differences:

- During a drag, route content should no longer re-render for every intermediate
  pixel while the responsive state remains in the same breakpoint band.
- If the implementation misses a threshold transition, the sidebar could remain
  expanded/collapsed for one resize step too long. Manual verification should
  focus there.

## Risks

Primary risks:

- Breakpoint regression around the desktop threshold.
- Expanded-sidebar fit regression around `sidebarWidth + MIN_CONTENT_WIDTH`.
- Mobile overlay auto-close regression when crossing into desktop layout.
- Stale callback dependencies if memoization is too aggressive.
- False confidence from dev/Vite profiles; production should be faster, but
  the relative stepped-vs-single comparison is still the useful signal.

Why this is lower risk than virtualization:

- It does not change transcript row ownership, search anchors, browser
  find-in-page behavior, loaded-message pagination, or scrollback anchoring.
- It only reduces when coarse layout state is committed to React.

## Verification Plan

Automated:

- TypeScript check for client code.
- Project lint wrapper for edited files or whole project if practical.
- Repeat the Playwright Chromium stepped and single-jump resize profiles on the
  same long session.

Manual:

- Verify desktop breakpoint around 1100px.
- Verify expanded sidebar collapses when the viewport is too narrow for
  `sidebarWidth + MIN_CONTENT_WIDTH`.
- Verify mobile/constrained desktop overlay opens and closes correctly.
- Verify dragging the sidebar still updates the content width and persists the
  chosen sidebar width.
- Verify a long session can resize without obvious delayed transcript width
  updates.

## Implementation

Edited files:

- `packages/client/src/layouts/NavigationLayout.tsx`
- `packages/client/src/pages/SessionPage.tsx`

`NavigationLayout` now derives and stores only the responsive decisions the
layout actually needs:

- `isWideScreen`
- `canShowExpandedSidebar`

The resize listener is still present, but it is coalesced through
`requestAnimationFrame` and commits React state only when one of those booleans
changes. The layout still recomputes immediately when `sidebarWidth` changes,
because the expanded-sidebar threshold depends on that width.

The navigation outlet context and layout callbacks are memoized so route
consumers do not receive a new context object during layout-only parent renders.
The session page also now passes stable handlers for the `MessageList`
BTW-aside callbacks that were previously inline lambdas.

Checks run:

- `pnpm --filter @yep-anywhere/client exec tsc --noEmit`: passed
- `pnpm exec biome format --write docs/tactical/016-session-resize-performance.md packages/client/src/layouts/NavigationLayout.tsx packages/client/src/pages/SessionPage.tsx`: formatted edited files
- `pnpm exec biome check docs/tactical/016-session-resize-performance.md packages/client/src/layouts/NavigationLayout.tsx packages/client/src/pages/SessionPage.tsx`: passed

## After Profile

Same profile target, same dev/Vite build, same Playwright Chromium setup.

After stepped resize profile, `1400 -> 800` in 10px steps:

- Wall time: 2,597 ms
- Browser task time: 1.75 s
- Script time: 0.15 s
- Layout time: 0.62 s
- Style recalculation: 0.23 s
- Layout count: 4,732
- Recalc style count: 4,698
- CPU profile:
  `/tmp/ya-resize-profile-after-1781369789728-stepped-1400-800.cpuprofile`

After single-jump profile, `1400 -> 800`:

- Browser task time: 0.32 s
- Script time: 0.01 s
- Layout time: 0.10 s
- Style recalculation: 0.07 s
- Layout count: 299
- Recalc style count: 302
- CPU profile:
  `/tmp/ya-resize-profile-after-1781369789728-single-1400-800.cpuprofile`

Profile summary:

- `/tmp/ya-resize-profile-after-1781369789728-summary.json`

Before/after comparison for stepped resize:

- Wall time: 4,576 ms -> 2,597 ms, about 43% lower
- Browser task time: 3.85 s -> 1.75 s, about 55% lower
- Script time: 2.04 s -> 0.15 s, about 93% lower
- Layout time: 0.63 s -> 0.62 s, effectively unchanged
- Style recalculation: 0.25 s -> 0.23 s, slightly lower
- Layout/recalc counts: roughly unchanged

Before/after comparison for single-jump resize:

- Script time: 0.04 s -> 0.01 s
- Layout time: 0.12 s -> 0.10 s
- Browser task time: 0.28 s -> 0.32 s, effectively comparable at this scale

Observed profile shape after the change:

- `MessageAge`, `formatCompactRelativeAge`, and React dev JSX runtime are no
  longer dominant samples during the stepped resize.
- Residual cost is now mostly browser layout work and scroll/measurement paths,
  including `getBoundingClientRect()` and `MessageList` near-bottom checks.
- Layout and style recalculation still happen for each intermediate browser
  viewport width. This slice reduces avoidable React work; it does not make the
  full transcript cheap for the browser to reflow.

## Residual Risks And Follow-Up

Residual risks:

- Manual breakpoint verification is still required around the desktop threshold
  and the expanded-sidebar fit threshold.
- The mobile overlay auto-close behavior should be checked after crossing from
  narrow to desktop widths.
- The changed context/callback memoization is intentionally narrow, but stale
  dependency bugs are the main implementation risk.

Known remaining performance ceiling:

- A long session still has a full mounted transcript, so raw browser layout
  work remains proportional to the visible DOM and renderer measurement paths.
- The tactical improvement is meaningful for resize responsiveness, but it does
  not replace the larger virtualization proposal in
  `packages/client/RENDERING_PERFORMANCE.md`.
