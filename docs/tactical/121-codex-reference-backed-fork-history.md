# Codex Reference-Backed Fork History

Status: Completed 2026-09-03

Topic: codex-rollout-lineage

Related topics: [codex-sessions](../../topics/codex-sessions.md),
[fork-from-turn](../../topics/fork-from-turn.md),
[provider-fork-support](../../topics/provider-fork-support.md),
[server-capabilities](../../topics/server-capabilities.md), and
[session-list-hidden-duplicates](../../topics/session-list-hidden-duplicates.md).

## Objective

Make every successful native Codex Clone or Fork immediately listable,
readable, resumable, and eligible for another fork when Codex persists the
child as a paginated rollout whose `history_base` references an immutable
prefix of another rollout.

The fix must recover already-created reference-backed children. It must not
force new sessions into legacy history mode, materialize copies into
provider-owned storage, or change the public YA session id.

## Incident And Upstream Contract

On 2026-09-03, Codex CLI 0.152.1 successfully forked source thread
`01a0654e-cf6b-7ec0-b72f-77d5edd0c53c` into
`01a065be-99a9-70a0-b1d0-cce87122bf21`. The child rollout contained canonical
child metadata plus local settings, while its inherited transcript lived in a
bounded parent prefix:

```json
{
  "history_mode": "paginated",
  "history_base": {
    "thread_id": "01a0654e-cf6b-7ec0-b72f-77d5edd0c53c",
    "end_ordinal_exclusive": 2100,
    "end_byte_offset": 17406804
  }
}
```

YA's persisted schema stripped those fields and `CodexSessionReader` parsed
only the child file. With no local user or assistant message, summary building
returned `null`; session detail therefore answered 404 even though
`thread/fork` had succeeded.

Pinned upstream Codex source defines the required behavior in
`thread-store/src/local/rollout_lineage.rs` and tests it in
`app-server/tests/suite/v2/thread_fork.rs`:

- `history_base.thread_id` is an immutable rollout id, not necessarily the
  stable thread id used by resume after a revert;
- the byte and ordinal cutoffs freeze the inherited prefix, so later parent
  appends do not enter the child;
- each lineage segment contributes only its local delta and the requested
  child's `session_meta` remains canonical; and
- lineage may be nested, archived, or compressed.

No pending `gaps/` entry covers reference-backed rollout reads. The completed
fork-unification tactical established native `thread/fork` as the public
Clone/Fork mechanism, while `session-list-hidden-duplicates.md` covers
preserving already-extracted fork provenance rather than reconstructing
provider history.

## Compatibility Decision

This is optional session-copying functionality. The reviewed stable-server
corpus is `v0.8.0` and `v0.7.0`; no other stable release falls in the preceding
14 days. Both lack reference-backed Codex history reconstruction, and `v0.8.0`
already advertises `session-fork-turn-intents`.

Add a distinct transitional, version-implied server capability named
`codex-paginated-rollout-lineage`, beginning with `0.8.1`. It attests that the
server can list, summarize, load, resume, and re-fork a reference-backed Codex
child created by the existing fork route. Do not broaden
`session-fork-turn-intents` or provider `supportsForkSession`; older servers
have already advertised those narrower meanings.

A current client requires the new capability only for Codex and Codex OSS
Clone/Fork. When it is absent, retain the visible action in disabled form with
an update-required explanation and make no fork request. Claude, Pi, and other
provider behavior is unchanged. Missing capability is a server compatibility
fact; the client must not infer safety from an installed Codex version because
history mode is persisted per rollout.

Old clients against the repaired server continue sending the existing request
and succeed. New clients against old servers decline the unsafe request. An
old client/server pair cannot be repaired by negotiation.

## Implementation Plan

### 1 — retain Codex paginated-history metadata

Extend the shared persisted-rollout schemas with the outer `ordinal`,
`history_mode`, `history_base`, and `forked_from_ordinal_exclusive` fields.
Keep unknown future fields permissive through the existing raw-entry fallback.

### 2 — resolve immutable rollout lineage

Add one server-owned resolver modeled on pinned Codex Core. Starting with the
selected child path, recursively follow `history_base`, locate ancestors by
rollout id across active and archived roots, prefer plain JSONL when both plain
and zstd representations exist, and reject cycles, missing ancestors,
mismatched identities, unsafe numeric bounds, and cutoffs that do not end at
the declared ordinal.

Return ordered immutable segments. Each segment exposes only records after its
own `session_meta`/inherited base and before the descendant's byte and ordinal
cutoff. Emit the selected child's metadata once as the canonical first record.

### 3 — make Codex detail and summary reads lineage-aware

Route full detail, summary streams, recovered launch settings, normalization,
message counting, model/context extraction, and turn-boundary resolution
through the logical entry stream. Keep ordinary legacy and standalone
paginated rollouts on the existing single-file fast path.

Retain leaf-file cache ownership: ancestor prefixes are immutable at their
recorded cutoffs, while child appends remain incremental reads from the leaf.
An initial reference-backed cache miss reconstructs the prefix once; later
leaf appends extend the retained logical entry array exactly as today.

### 4 — preserve correct paging and child projections

Do not run the physical-file compact-window optimization on a reference-backed
leaf. Use the established complete-read/in-memory compact-boundary fallback,
which preserves ordinary opaque message cursors and can return older history
without treating a leaf byte offset as a whole logical-session offset.

Provider-child projection remains physical for actual child ownership.
Logical detail reads still populate the existing agent mapping cache, so
historical inherited spawn results remain navigable without relabeling those
agents as children newly created by the fork.

### 5 — advertise safe Codex fork products

Allocate the next global server capability id, register and export
`codex-paginated-rollout-lineage`, advertise it from the version route, and
document its complete existing-route behavior. Advertisement lands only with
the reader support and route proof.

Replace the client's fork-support boolean with a reasoned availability result.
Require `session-fork-turn-intents`, provider `supportsForkSession`, and, for
Codex providers, `codex-paginated-rollout-lineage`. Render an accessible
disabled/update-required explanation and send no unsupported request when the
new gate is absent.

### 6 — prove native Clone, turn Fork, and nested history

Add deterministic fixtures for single-hop and nested lineage, later parent
appends past the frozen cutoff, missing/cyclic/mismatched ancestry, archived
ancestors, and compressed ancestors when the runtime supports zstd. Prove
summary/list and detail behavior, incremental child appends, compact-window
fallback, inherited provider-turn ids, and a nested native fork boundary.

Keep the adapter test for `excludeTurns: true`, but add a matching-CLI
app-server contract smoke because response hydration does not describe the
physical child rollout.

### 7 — verify an isolated local server

Launch a fresh server from the final worktree on unused ports with disposable
`YEP_DATA_DIR` and `CODEX_HOME`. Create a Codex source turn, exercise header
Clone plus a turn-boundary Fork through YA's route, and verify each target via
session list/detail and a resumed child turn. Preserve logs and response
evidence under the ignored UI-testing artifact directory, stop all isolated
processes, and leave the user's port-3400 server and normal Codex home
untouched.

## Completion Checks

- Shared schema, capability encoding, server version, reader, summary-worker,
  route, provider, and client availability tests pass without warnings.
- A real Codex 0.152.1 app-server fixture produces reference-backed children
  that the reader reconstructs.
- Isolated-profile YA Clone and turn Fork both open and can be resumed.
- `pnpm codex:protocol:check`, `pnpm references:check`, capability audit,
  typecheck, lint, format check, and client console scan pass.
- The owning topic contracts describe lineage, failure behavior, paging
  fallback, and capability negotiation.

## Completion Evidence

- [x] Persisted schemas retain paginated lineage and ordinals.
- [x] One bounded resolver reconstructs single-hop and nested ancestry.
- [x] Session detail, summaries, indexing, and nested forks consume logical
  history.
- [x] New clients explain and decline unsafe Codex forks on older servers.
- [x] Isolated-profile native Clone, turn Fork, and resume verification pass.
- [x] Warning-free repository checks pass.

The deterministic reader suite covers frozen parent prefixes, incremental and
partial leaf appends, archived and compressed ancestry, nested lineage, and
fail-closed validation. The full server suite passed 4,563 tests with 50
skipped opt-in/platform cases. Focused client and shared suites passed 23 and
24 tests respectively.

The real Codex 0.152.1 smoke created source, Clone, direct Fork, and nested
Clone threads in disposable storage. Both first-generation children used a
two-record physical rollout, appeared immediately in list/detail responses,
and preserved inherited context; the direct Fork resumed and answered from
that context. Final 1000x600 and 375x812 captures confirm that omission of
capability ID 54 disables Clone/Fork with readable update guidance.

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm capabilities:audit`, `pnpm codex:protocol:check`, and
`pnpm references:check` passed. The client console budget remained unchanged;
the touched-CSS inventory found only coupled/global ownership in the legacy
components and no bounded stylesheet extraction for this behavior-only UI
change.
