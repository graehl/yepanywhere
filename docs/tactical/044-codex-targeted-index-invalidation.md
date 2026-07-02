# Codex Targeted Index Invalidation

Status: Implemented July 2026.

## Background

Codex stores rollout files under a shared date-based history tree:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-...-<session-id>.jsonl
```

YA project scope is not represented by that directory layout. A Codex project
is virtual: the first `session_meta` line in the rollout contains the `cwd`, and
YA scopes summary indexes as:

```text
codex::<sessionsDir>::<projectPath>
```

That means a raw watcher event for a Codex file starts out as a shared-history
file event, not a direct project event.

Before this fix, `SessionIndexService` handled every Codex session file-change
event by marking all loaded `codex::` scopes dirty. That was correct but too
broad. During long-running queued work, several active Codex rollouts can append
without any UI interaction. The macOS watcher periodic scan then emits modify
events, and each event can dirty every loaded Codex project scope. The next
session-list request for those scopes may perform avoidable reconciliation and
summary parsing.

This matched the July 2026 crash shape: YA was idle from the UI perspective,
but multiple resumed Codex sessions were still writing rollouts. The logs showed
repeated Codex scans and session-index activity shortly before a Node heap OOM.
The OOM stack still points at string flattening/trimming in JSONL parsing, so
this is an invalidation fan-out fix rather than the whole memory story.

## Existing Map

No new persistent map is needed. YA already maintains
`SessionDiscoveryIndex` shards for Codex metadata:

```text
~/.yep-anywhere/indexes/session-discovery/codex/<sourceRootHash>/YYYY/MM/DD.json
```

Those records are keyed by rollout filename and contain the immutable metadata
needed to map a file to a session and project:

- `metadata.id`
- `metadata.cwd`
- `metadata.timestamp`
- `metadata.isSubagent`

For a loaded summary index, the in-memory `SessionIndexService.indexCache` also
already knows whether a given `sessionId` is present in a loaded `codex::`
scope.

## Fix

Handle Codex watcher events in this order:

1. Parse the session id from the rollout filename.
2. If any loaded `codex::` scope already contains that session id, mark that
   scope precisely: per-session dirty for modifies, directory dirty for
   creates/deletes.
3. If the loaded-cache fast path cannot resolve it, consult the Codex discovery
   index, reading only the first metadata line on a cache miss.
4. Convert `cwd` to the same scope key the Codex reader uses and dirty that
   one scope with the same modify versus create/delete rule.
5. Fall back to the old broad `codex::` invalidation when the event is not a
   recognizable rollout, metadata is unavailable, or the changed file is a
   subagent rollout.

The fallback keeps correctness conservative: unknown cases still reconcile the
same way they did before.

## Expected Benefit

The fix should reduce avoidable summary-index work when several Codex sessions
are active at once, especially when the UI has loaded more than one Codex
project scope. A file append for one project should no longer make unrelated
loaded Codex scopes look stale.

This should lower parse pressure inside the app-server process. It complements
`CODEX_SUMMARY_PARSER_WORKER`; the worker isolates expensive summary parsing
from the main heap, while this change avoids scheduling unrelated parses in the
first place.

## Correctness Rationale

The Codex rollout filename includes the stable session id, and the first
`session_meta` line contains the stable `cwd`. YA already trusts those fields
for Codex project discovery and session listing. Reusing the same discovery
index and constructing the same `codex::<sessionsDir>::<projectPath>` key keeps
the invalidation path aligned with the reader path.

The targeted dirty state uses the existing incremental summary-index path:
`getSessionsWithCache()` reparses only the marked session when full validation
is not due. Creates/deletes use directory dirtying for the mapped scope because
session membership can change. Unknown file shapes and unresolved metadata still
retain broad fallback behavior.

## Limits And Follow-Up

This does not eliminate all Codex memory risk. A request that truly needs a
large stale summary, a cold project index, or a session detail response can
still parse large JSONL content. The remaining memory work is the same track as
`docs/tactical/038-codex-session-index-memory.md`: worker isolation, bounded
reader caches, and observation of real cold and warm workloads.
