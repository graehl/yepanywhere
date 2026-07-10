# Claude idle reap can flip read sessions unread

**Date:** 2026-07-06
**Reported symptom:** a Claude session manually marked read became unread again
around one hour later.
**Observed session:** `964c7574-cce3-4e63-a8dc-8b75a5b6a3a2`
**Project:** `/Users/kgraehl/code/mclone`
**Reported URL:** `https://latest.yepanywhere.com/macbook/projects/L1VzZXJzL2tncmFlaGwvY29kZS9tY2xvbmU/sessions/964c7574-cce3-4e63-a8dc-8b75a5b6a3a2`

## Decision (2026-07-10)

Use content-derived freshness for Claude session summaries:

- keep file mtime and size as internal session-index invalidation keys;
- derive Claude `SessionSummary.updatedAt` from the latest meaningful
  `user` or `assistant` row on the selected active branch;
- therefore use that content-derived `updatedAt` for list recency, Inbox
  tiering, sorting, and unread comparison;
- do not add idle-reap-specific suppression or mutate last-seen state during
  process teardown;
- do not proactively invalidate already-cached Claude summaries when this
  change ships. Existing cached summaries may retain their old mtime-derived
  `updatedAt` until the corresponding session file next changes and is parsed
  again. That gradual correction is acceptable; exact preservation of
  read/unread state across the YA upgrade is not required.

This is deliberately source-agnostic. A later mtime-only touch by YA, Claude
CLI, Claude Desktop, or another filesystem actor should cause index validation
without advancing content `updatedAt`. We are not investigating the precise
CLI/Desktop write behavior as a prerequisite. If those applications append a
row that the first content classification treats as meaningful, any remaining
false unread behavior can be investigated separately with evidence from that
case.

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

The chosen direction is a split between "storage freshness" and "content
freshness":

- keep mtime/size as the index invalidation key;
- for Claude, make the existing summary `updatedAt` represent the latest
  meaningful active-branch content timestamp rather than adding a second
  public freshness field;
- continue using `updatedAt` for unread, list recency, Inbox age windows, and
  sorting, so an mtime-only lifecycle touch creates neither unread attention
  nor false recent activity;
- keep a provider content cursor/revision as a possible later strengthening if
  timestamp ordering proves insufficient; it is not part of this fix;
- accept gradual correction of persisted cached summaries instead of adding a
  cache migration or forced rebuild for this change.

Any fix should include a regression fixture where a Claude JSONL file's mtime
advances after the last visible message timestamp without appending a visible
row. The expected result is that `hasUnread` remains false when the last-seen
marker is after the last visible content but before the mtime-only touch.

## First Implementation Slice

Keep the first slice Claude-only and confined to summary freshness:

1. In `packages/server/src/sessions/claude-summary.ts`, derive `updatedAt` from
   the latest timestamped `user` or `assistant` node on the selected active
   branch. Fall back to file mtime only when the non-empty parsed session has no
   usable content timestamp.
2. Leave `CachedSessionSummary.fileMtime` and `indexedBytes` unchanged. They
   continue to decide whether the file must be reparsed; no index schema bump,
   cache-version marker, or notification-state migration is included.
3. Add focused Claude summary coverage proving that:
   - mtime later than the last meaningful row does not advance `updatedAt`;
   - appending a later meaningful row does advance `updatedAt`;
   - internal/non-conversation tail rows do not advance `updatedAt`.
4. Add one route- or notification-level regression showing that a last-seen
   timestamp between content time and a later file touch leaves the session
   read. Prefer Inbox coverage if it can also cheaply prove the session does
   not enter `recentActivity` because of the touch.

Do not change other providers, the idle-reap lifecycle, `NotificationService`
persistence, client mark-seen payloads, or Claude CLI/Desktop integration in
this slice.

### Implementation Result (2026-07-10)

The first slice is complete:

- `packages/server/src/sessions/claude-summary.ts` now scans the selected active
  branch backward and uses the latest valid `user` or `assistant` timestamp as
  summary `updatedAt`;
- non-conversation tail rows and mtime-only touches no longer advance Claude
  summary freshness;
- sessions without any usable content timestamp retain the existing mtime
  fallback;
- index mtime/size validation, persisted notification state, Inbox tiering,
  client mark-seen behavior, idle reaping, and other providers were left
  unchanged;
- no proactive persisted-index invalidation was added, per the decision above.

Focused regressions cover a file whose mtime postdates its content, an internal
system tail row, a newly appended meaningful row, and Inbox classification when
the storage touch is later than last-seen but content is older. The targeted
Claude reader and Inbox route suites pass with 77 tests and no warnings.
