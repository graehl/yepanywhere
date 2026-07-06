# Session Compact-Tail Pagination

> `tailCompactions` on the session-detail API names the number of compact
> boundary markers to include at the top of the returned tail window, not the
> number of post-compaction message spans to count.

Topic: session-compact-tail-pagination

## Contract

For `GET /api/projects/:projectId/sessions/:sessionId?tailCompactions=N`,
the returned transcript window should start at the Nth compact boundary from
the end when at least N compact boundaries exist. The boundary message itself
is included so the client has an explicit "Context compacted" divider at the
top of the window.

If fewer than N compact boundaries exist, the endpoint returns the full
transcript. That preserves the intuitive "N compact windows" behavior for
short sessions: with `tailCompactions=2`, a session that has only one compact
boundary has only two windows total, so returning the beginning, the boundary,
and the current tail is acceptable.

For `tailCompactions=2`, the intended shapes are:

| Total compact boundaries | Returned shape |
| ---: | --- |
| 0 | full session |
| 1 | beginning, `C1`, tail |
| 2 | `C1`, middle, `C2`, tail |
| 3 | `C2`, middle, `C3`, tail |
| 100 | `C99`, middle, `C100`, tail |

## Why This Matters

The previous boundary condition used `totalCompactions <= tailCompactions` as
the full-history case. That made a session with exactly two compact boundaries
return the initial prompt and all pre-compaction history for the default
`tailCompactions=2` request, then abruptly shrink once a third compaction
arrived.

That discontinuity is user-visible on long Codex sessions because provider
JSONL can expand a modest number of user turns into hundreds or thousands of
normalized render rows. A syntactically bounded `tailCompactions=2` request can
still be expensive if the exactly-two-boundary case returns the entire
transcript.

## Older-Page Pagination

`beforeMessageId` uses the same rule on the prefix before the cursor. If that
prefix contains at least N compact boundaries, the older page starts at the
Nth boundary from the end of that prefix and reports `hasOlderMessages: true`.
The next older-page request can then fetch the pre-boundary prefix. This may
make one additional older-page click necessary compared with the former full
prefix behavior, but it keeps every page shaped like the requested compact
tail.
