# Session Catch-up Must Not Fetch Full Transcripts

Topic: session-detail-data-layer
Topic: session-liveness

Status: Problem statement from the 2026-07-04 mobile freeze investigation.
The first client-side mitigation makes catch-up fall back to a compact tail
when the last-message cursor is missing, and requires client callers to mark
intentional full-history reads explicitly.

## Problem

A mobile client can enter a disconnected session-stream state and, around a
reconnect or catch-up transition, request a whole session transcript. For long
Codex sessions this can return thousands of normalized messages, spend seconds
in server-side session augmentation, and plausibly freeze a phone browser while
the client parses, stores, and renders the response.

The unsafe shape is:

```text
GET /api/projects/:projectId/sessions/:sessionId
```

with no bounding or cursor query:

- no `afterMessageId`
- no `tailCompactions`
- no `tailTurns`
- no `tailFrom`
- no explicit full-history intent

Catch-up paths should be incremental and bounded. If the client cannot identify
the last seen message, the fallback should be a bounded recent window, not an
unbounded transcript read.

## Incident Evidence

The uploaded screenshot
`.attachments/019f2e3f-34c3-74b2-85e0-51bccae8b827/4af68296-0639-485f-97fc-c19a3a45f036_Screenshot_20260704-194554-sd.png`
shows the mobile session page on `latest.yepanywhere.com` in a stuck state:

- Session title: `textures dressed hewn`
- Project: `mclone`
- Provider/model pill: Codex `5.5`
- Red session connection bar above the composer
- Composer placeholder: `Send a message to resume...`

The title maps in local session metadata to:

```text
sessionId: 019f28d9-2dff-7dd2-8326-4b0e6093aed4
provider: codex
project: /Users/kgraehl/code/mclone
```

The server log around the screenshot time shows normal bounded session-detail
requests immediately before the problematic request:

```text
2026-07-04 19:43:53 CEST session_detail_slow
sessionId=019f28d9-2dff-7dd2-8326-4b0e6093aed4
tailCompactions=2
returnedMessageCount=1080
normalizedMessageCount=6629
processState=idle
owned=true
totalMs=529.5
augmentMs=446.2

2026-07-04 19:45:02 CEST session_detail_slow
sessionId=019f28d9-2dff-7dd2-8326-4b0e6093aed4
tailCompactions=2
returnedMessageCount=1082
normalizedMessageCount=6631
processState=idle
owned=true
totalMs=515.6
augmentMs=440.8
```

Then the same session receives an unbounded request:

```text
2026-07-04 19:45:05 CEST session_detail_slow
sessionId=019f28d9-2dff-7dd2-8326-4b0e6093aed4
afterMessageId=null
tailCompactions=null
beforeMessageId=null
returnedMessageCount=6631
normalizedMessageCount=6631
processState=idle
owned=true
totalMs=2032.1
augmentMs=1954.5
```

That request returned the entire normalized session instead of the compact tail.
It is the clearest evidence for the freeze mechanism.

There are no July 4 client logs under
`~/.yep-anywhere/logs/client-logs/`, so we do not have a browser stack, heap
sample, or long-task record from the phone. The absence of client logs limits
proof of the exact main-thread operation that froze Chrome, but the server log
does prove that the client requested the whole transcript in the incident
window.

Background server churn was also present: the Codex JSONL session file was
large, and the summary parser worker restarted around the same session. That
may have increased latency, but it is not required to explain the browser
freeze. The unbounded session-detail response is sufficient.

## Likely Failure Shape

The likely client-side path is `fetchNewMessages()` in
`packages/client/src/hooks/useSessionMessages.ts`.

That path reads the current local cursor:

```text
const afterMessageId = readStoreLastMessageId();
```

If the cursor exists, the client requests an incremental update:

```text
sourceApi.getSession({ projectId, sessionId, afterMessageId })
```

If the cursor is missing, the current call shape can omit both the cursor and
all tail bounds. The source API client then sends an unbounded `getSession`
request.

`fetchNewMessages()` is used from reconnect and catch-up-adjacent paths,
including activity reconnect, visibility refresh, session-watch changes, file
activity changes, and post-completion refresh. A disconnect therefore does not
need to directly cause the full fetch. It only needs to put the client into a
catch-up path while the retained message cursor is unavailable.

Possible reasons the cursor might be unavailable:

- Initial reveal or store hydration has not completed.
- The retained message store was evicted or not admitted.
- A source/runtime transition temporarily points at an empty store.
- A session-watch or reconnect event fires before the session-detail window is
  restored.
- A reducer or cache path loses the last visible message id during idle/resume
  state changes.

## Existing Guards That Did Not Cover This

Initial session load is already bounded:

```text
tailCompactions=2
```

The server route also has a useful missed-anchor guard: when an
`afterMessageId` is present but the anchor is not found, it falls back to a
compact-tail response. That guard does not apply when the client omits
`afterMessageId` entirely.

The session-message coordinator dedupes concurrent refreshes, but it does not
require each refresh to be bounded.

The red connection bar itself is unlikely to be an invisible overlay problem.
The relevant CSS uses `pointer-events: none` for the connection bars.

Relay request head-of-line blocking is also less likely as the direct cause
for this incident. The current relay request handler dispatches request work
without awaiting it in the receive loop.

## Desired Invariants

Catch-up must never issue an unbounded session-detail request.

Every non-explicit-full-history session-detail request should include at least
one of:

- `afterMessageId`
- `tailCompactions`
- `tailTurns`
- `tailFrom`

If a catch-up caller cannot provide `afterMessageId`, it should fall back to a
bounded recent window, probably the same compact-tail default used for initial
load.

Any whole-transcript read should be explicit in code and reviewable by name,
for example with an option such as `fullHistory: true` or
`allowUnbounded: true`. Silent omission of all bounds should not mean "return
everything."

## Fix Ideas

### 1. Bound the catch-up fallback

In `fetchNewMessages()`, if `readStoreLastMessageId()` returns no cursor,
request a bounded compact tail instead of calling `getSession` without
options.

Likely behavior:

```text
afterMessageId exists -> incremental fetch after that id
afterMessageId missing -> tailCompactions=2 fallback
```

This is the narrowest fix and directly targets the incident shape. The reducer
semantics need care: a bounded fallback response may need to replace or
reconcile the current window differently from a true incremental response.

### 2. Make unbounded session reads explicit in the client API

Split or tighten the session-detail API so callers cannot accidentally omit all
bounds. Possible shapes:

- `getSessionIncremental({ afterMessageId })`
- `getSessionTail({ tailCompactions })`
- `getSessionFullHistory({ reason })`
- a single API that rejects missing bounds unless `allowUnbounded: true`

This adds more churn than the narrow fallback fix, but it creates the strongest
local invariant and prevents future accidental full-history reads.

### 3. Add a server-side defensive default

The server route could default browser session-detail requests to
`tailCompactions=2` unless an explicit full-history query flag is present.

This is a strong safety net, but it needs an API audit first. Some legitimate
callers may currently depend on the no-query route returning the entire
transcript, such as exports, share flows, or debugging tools.

### 4. Audit direct full-history callers

At least two direct client call sites currently use `api.getSession(projectId,
asideSessionId)` for `/btw` aside hydration or polling. They should be checked
to decide whether they truly need whole-session history or should use a
bounded recent window.

Other explicit full-history consumers should be named and documented rather
than relying on omitted query options.

### 5. Add diagnostics around unsafe requests

Add a warning or telemetry event when a browser-originated session-detail
request has no bounds and returns more than a small threshold.

Useful fields:

- session id
- project id
- caller tag, if available
- query bounds present or absent
- returned message count
- normalized message count
- response byte size, if cheap to compute
- timing buckets

This would make future incidents easier to tie back to a call site. The July 4
incident did not have remote client logs, so server-side detection would have
been especially useful.

### 6. Add regression tests

Useful tests:

- `fetchNewMessages()` with a last message id sends an incremental request.
- `fetchNewMessages()` without a last message id sends a bounded tail request.
- Reconnect or visibility-refresh catch-up without a retained cursor does not
  call unbounded `getSession`.
- If the server defensive default is chosen, a no-query browser session-detail
  request returns a bounded response unless full history is explicitly
  requested.

## Open Questions

- Which exact call site produced the 19:45:05 unbounded request? The strongest
  suspect is `fetchNewMessages()` with a missing cursor, but direct
  `api.getSession(projectId, sessionId)` callers should still be ruled out.
- Should a missing-cursor fallback replace the current visible window, merge
  into it, or trigger a fresh initial-load path?
- Should the first fix live only in the client catch-up path, or should the
  server route also enforce a bounded default?
- Is `tailCompactions=2` the right fallback for all catch-up contexts, or
  should some paths use `tailTurns` or another window shape?
- Do `/btw` aside sessions need full transcripts, or can they use compact
  tails?

## First Slice

The first client-side invariant is: `fetchNewMessages()` must not call session
detail without either `afterMessageId` or a bounded tail option. If the cursor
is missing, it falls back to `tailCompactions=2`. A regression test covers that
call shape.

The same slice also makes browser client full-history calls explicit at the
source API boundary. Direct `api.getSession(projectId, sessionId)` callers in
the session page now route through the source API with `fullHistory: true` and
a caller reason.

Remaining follow-up work is to decide whether the server route should also
enforce a bounded default or log large unbounded browser-originated responses.
