# Claude idle reap can flip read sessions unread

**Date:** 2026-07-06
**Reported symptom:** a Claude session manually marked read became unread again
around one hour later.
**Observed session:** `964c7574-cce3-4e63-a8dc-8b75a5b6a3a2`
**Project:** `/Users/kgraehl/code/mclone`
**Reported URL:** `https://latest.yepanywhere.com/macbook/projects/L1VzZXJzL2tncmFlaGwvY29kZS9tY2xvbmU/sessions/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2`

## Problem Statement

YA computes unread state by comparing the session summary `updatedAt` timestamp
against `NotificationService`'s per-session last-seen timestamp. For Claude
JSONL sessions, `updatedAt` is currently the transcript file mtime.

That means a mtime-only provider/session-file touch can make a previously read
session look unread, even when no new visible provider content was appended.
The observed trigger was YA's normal one-hour idle reap of an owned Claude
process. The idle reaper aborts the Claude SDK query; the Claude JSONL file was
touched during that teardown; YA then indexed the new mtime as provider
freshness.

## Evidence

### Timeline

All timestamps below are UTC.

```text
2026-07-06T19:20:55Z  Last visible Claude transcript rows.
2026-07-06T20:20:55Z  YA unregistered the process after idle timeout.
2026-07-06T20:20:55Z  File watcher observed a Claude JSONL modify event.
2026-07-06T20:20:55Z  Process logged "Operation aborted".
2026-07-06T20:21:51Z  The session was marked seen again.
```

The local API later reported the resulting state:

```json
{
  "id": "964c7574-cce3-4e63-a8dc-8b75a5b6a3a2",
  "updatedAt": "2026-07-06T20:20:55.082Z",
  "lastSeenAt": "2026-07-06T20:21:51.218Z",
  "hasUnread": false,
  "ownership": { "owner": "none" },
  "messageCount": 123,
  "provider": "claude"
}
```

The session is currently read only because the later `lastSeenAt` is after the
mtime bump. If the user's last-seen marker had remained before
`2026-07-06T20:20:55.082Z`, `hasUnread` would evaluate to `true`.

### Server log evidence

Relevant server log rows:

```text
1783365655053  2026-07-06T19:20:55Z  Emitting state-change to 2 listeners
1783365655167  2026-07-06T19:20:55Z  [FileWatcher] Raw event provider=claude type=change file=-Users-kgraehl-code-mclone/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2.jsonl
1783365655370  2026-07-06T19:20:55Z  [FileWatcher] Emitting file-change provider=claude changeType=modify fileType=session relativePath=-Users-kgraehl-code-mclone/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2.jsonl

1783369255078  2026-07-06T20:20:55Z  session_unregistered  Session unregistered: 964c7574-cce3-4e63-a8dc-8b75a5b6a3a2 after 5220374ms (reason: idle)
1783369255141  2026-07-06T20:20:55Z  [FileWatcher] Raw event provider=claude type=change file=-Users-kgraehl-code-mclone/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2.jsonl
1783369255342  2026-07-06T20:20:55Z  [FileWatcher] Emitting file-change provider=claude changeType=modify fileType=session relativePath=-Users-kgraehl-code-mclone/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2.jsonl
1783369255431  2026-07-06T20:20:55Z  process_error  Process error: 964c7574-cce3-4e63-a8dc-8b75a5b6a3a2 - Operation aborted
```

The `session_unregistered` duration was about 87 minutes after process start,
but the critical idle interval was one hour after the process reached idle at
`19:20:55Z`.

### Filesystem and index evidence

The Claude transcript file mtime and the indexed session `updatedAt` matched
the idle teardown time:

```text
2000559 bytes 2026-07-06 22:20:55 +0200
/Users/kgraehl/.claude/projects/-Users-kgraehl-code-mclone/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2.jsonl
```

The cached summary in
`~/.yep-anywhere/indexes/-Users-kgraehl-code-mclone.json` contained:

```json
{
  "updatedAt": "2026-07-06T20:20:55.082Z",
  "fileMtime": 1783369255082.1023,
  "indexedBytes": 2000559,
  "provider": "claude",
  "messageCount": 123
}
```

`~/.yep-anywhere/notifications.json` contained the later seen marker:

```json
{
  "timestamp": "2026-07-06T20:21:51.218Z"
}
```

### Transcript evidence

The main Claude JSONL still ended at the visible assistant turn around
`19:20:55Z`; no `20:20Z` shutdown, idle-reap, or abort row was found in the
transcript.

Tail summary:

```text
2026-07-06T19:20:29.382Z  assistant  tool_use
2026-07-06T19:20:30.972Z  assistant  tool_use
2026-07-06T19:20:32.569Z  assistant  tool_use
2026-07-06T19:20:33.374Z  user
2026-07-06T19:20:40.469Z  assistant  tool_use
2026-07-06T19:20:41.288Z  user
2026-07-06T19:20:55.019Z  assistant  end_turn
2026-07-06T19:20:55.036Z  assistant  end_turn
```

A broad text search found the word `shutdown` only inside earlier user/tool
content, not as a teardown event. The observed mtime bump therefore appears to
be a teardown-side file touch, not a new user-visible provider message.

## Code Bearings

- `packages/server/src/defaults.ts`
  - `DEFAULT_IDLE_TIMEOUT_SECONDS = 60 * 60`.
- `packages/server/src/supervisor/Process.ts`
  - `startIdleTimer()` calls `reapIdleProcess()` when a process remains idle
    and is not retained.
  - `reapIdleProcess()` calls the provider `abortFn()`, emits `complete`, and
    clears listeners.
- `packages/server/src/sdk/providers/claude.ts`
  - Claude sessions pass an `AbortController` into the SDK `query()`.
  - The provider abort function calls `abortController.abort()`.
- `packages/server/src/sessions/claude-summary.ts`
  - Claude session summaries set `updatedAt` to `options.stats.mtime`.
- `packages/server/src/notifications/NotificationService.ts`
  - `hasUnread(sessionId, updatedAt)` returns `updatedAt > lastSeen.timestamp`.

Related context:

- `topics/inbox.md` defines the current unread meaning.
- `docs/tactical/015-claude-background-task-idle-reap.md` documents the
  owned Claude process idle-reap policy and why reaping must still exist.

## Current Behavior

The current system intentionally uses mtime for:

- cheap index invalidation;
- recents ordering;
- summary `updatedAt`;
- unread comparison.

Those uses are not equivalent. Mtime is useful for cache invalidation, but it
is not a reliable "new user-visible provider content" timestamp for unread
state.

`NotificationService.markSeen()` already guards one adjacent case by recording
the later of the client-provided timestamp and server `now`, so writes landing
between process stop and viewing do not immediately re-flip a session unread.
This incident is different: the user can mark the session read before the
one-hour idle reap, then the later teardown touch advances mtime.

## Potential Solution Ideas

### 1. Split cache mtime from provider-content freshness

Add a separate summary field such as `providerContentUpdatedAt` or
`lastVisibleMessageAt`, computed from parsed provider transcript rows rather
than file stat mtime. Use it for unread comparisons. Keep mtime for index
invalidation and maybe list recency.

This is the cleanest conceptual fix. It would make unread mean "new parsed
provider content" instead of "session backing file changed". It needs careful
provider-by-provider handling because Codex/Gemini/Grok/OpenCode may expose
better logical timestamps than file mtime.

### 2. Track a content cursor instead of a timestamp

Persist the last seen provider cursor: for Claude, the last visible message
uuid plus maybe active-branch message count; for providers without stable ids,
use a provider-specific logical sequence. Unread becomes "current content cursor
is ahead of last seen cursor".

This is more robust than wall-clock comparisons and handles clock skew, mtime
rounding, and mtime-only touches. It is a larger contract change for client
mark-seen calls, summaries, and migrations of existing `notifications.json`.

### 3. Detect mtime-only/no-summary-change updates in the index

When a dirty Claude session is reparsed because mtime changed, compare the
new parsed content-bearing fields to the cached summary:

- `messageCount`
- `lastAgentText`
- maybe last visible message id/timestamp if added
- title/model/context fields where relevant

If only `fileMtime` changed, update cache validation fields but do not advance
the timestamp used for unread.

This is smaller than a full cursor design, but it can be brittle. A summary can
remain unchanged while a real new message appears, for example if the last
visible excerpt happens to be the same or if only hidden/tool metadata changed.

### 4. Suppress idle-reap touch events as unread sources

Record that YA is intentionally idle-reaping a Claude process, and if the next
file-change event for that session arrives within a small window and produces
no new parsed visible content, do not let it advance unread freshness.

This targets the observed bug tightly. It has more special-case state and must
not hide legitimate late provider output after reap. It should only be safe if
combined with a parsed-content check.

### 5. Auto-advance last-seen on owned idle reap only when already read

If a session is already read at the moment YA idle-reaps it, and the subsequent
mtime bump has no new parsed visible content, advance `lastSeen` to cover that
specific teardown touch.

This preserves the user's read decision for the no-content-change case without
changing summary semantics. It is likely a tactical mitigation, not the right
long-term model, because it mutates notification state in response to a
provider lifecycle event.

## Suggested Direction

Prefer a split between "storage freshness" and "content freshness":

- keep mtime/size as the index invalidation key;
- add a provider-content freshness value derived from parsed transcript content;
- use provider-content freshness or a provider cursor for unread;
- leave list recency as a separate product decision, because mtime-only
  lifecycle touches may still be useful for diagnostics but should not create
  unread attention.

Any fix should include a regression fixture where a Claude JSONL file's mtime
advances after the last visible message timestamp without appending a visible
row. The expected result is that `hasUnread` remains false when the last-seen
marker is after the last visible content but before the mtime-only touch.
