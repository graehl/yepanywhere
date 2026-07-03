# Session Detail Cache Admission

Topic: session-detail-data-layer

Status: First fix landed 2026-07-03. Over-budget cache admission failures no
longer delete a mounted session detail entry. The larger
active-store/cache-boundary cleanup remains open.

## Problem

A large Codex session could load successfully from the local server but render
as an empty session in the local development browser while still showing
independent Project Queue rows. The browser console showed:

- `[SessionDetailStore]` with
  `event: "session-detail-store-missing-after-reveal"`;
- `[SessionDetailStore] dropped action for missing entry`.

The same session rendered on a phone using the hosted client. Disabling the
local transcript cache fixed the local browser immediately:

```js
localStorage.setItem("yep-anywhere-session-transcript-cache-budget-mb", "0");
localStorage.setItem("yep-anywhere-session-transcript-cache-enabled", "false");
location.reload();
```

The server was not the source of truth failure. A direct local API read returned
HTTP 200 with 1118 messages and a 14.3 MB JSON response. The session-detail
memory estimator charged the returned message rows at about 27.4 MiB, which
exceeds the legacy transcript-cache budget seeded at 24 MB.

## Root Cause

`defaultSessionDetailStore` currently owns two related but distinct concerns:

- the mounted session-detail state used by the active Session page;
- same-tab warm route snapshots admitted under TTL and byte-budget policy.

On cold initial load, `useSessionMessages` dispatches
`loadPersistedTranscript`, reads a store-backed reveal snapshot, completes
reveal, and then calls the warm-cache write path. If transcript caching is
enabled and the reveal snapshot estimates over the configured byte budget,
`SessionDetailCache.writeRouteSnapshot` rejects admission by calling
`deleteRecordByKey(key)`.

That is correct for an unmounted warm-cache entry but wrong for the active
mounted page. The cache rejection deletes the live retained store record that
the just-revealed UI needs to render. After that, returned transcript selectors
see no state, so the page renders empty transcript surfaces while unrelated
state, such as Project Queue rows, can still render.

## First Fix Shape

Treat cache admission failure as non-destructive while the entry is retained by
a mounted consumer:

- if a route snapshot is over budget and no retained record exists, reject it
  and clear any stale unretained cache record;
- if a route snapshot is over budget and the entry has a positive retain count,
  reject cache admission but preserve the current record;
- keep ordinary TTL/LRU eviction behavior for unretained entries;
- keep incremental actions from fabricating entries after a genuinely missing
  record.

The key invariant is:

> Cache admission failure must not delete a retained/mounted session detail
> entry.

Focused regression coverage should include:

- retained entries survive over-budget `writeRouteSnapshot`;
- unretained over-budget snapshots are still rejected;
- `useSessionMessages` returns loaded messages when transcript cache is enabled
  but the loaded reveal snapshot is over budget.

## Larger Boundary Issue

The underlying design smell is that one API, `writeRouteSnapshot`, can mean both
"replace active reducer-backed detail state" and "admit this route snapshot to a
warm cache." Those are different operations with different failure semantics.

The first fix can be small and should restore correctness. A later cleanup
should consider making this boundary explicit, for example:

- active store writes are allowed while retained and are not rejected by warm
  cache budget policy;
- cache admission is a separate operation that can fail without mutating live
  state;
- diagnostics distinguish "live retained bytes" from "warm-cache-admitted
  bytes" so Performance settings remain understandable.

## Status Notes

- 2026-07-03: Reproduced by loading session
  `019f285c-54ef-79e1-95c2-2ac5c84ac3a7` in project
  `/Users/kgraehl/code/mclone` with transcript cache enabled. Server returned
  1118 messages; disabling transcript cache made the transcript visible.
- 2026-07-03: First implementation chunk preserves retained entries when an
  over-budget route-snapshot write is rejected. Focused coverage now checks
  retained and unretained store behavior plus the `useSessionMessages` initial
  load path with transcript cache enabled and an intentionally tiny byte budget.
