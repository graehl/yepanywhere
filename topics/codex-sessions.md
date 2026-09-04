# Codex Sessions

> Codex sessions are provider-owned rollout files that YA reads as durable
> transcript state, grouped by `session_meta.cwd` rather than by directory
> layout; YA must preserve that provider storage model without turning rollout
> discovery into unbounded repeated work.

Topic: codex-sessions

Related topics: [codex-metadata-scanner](codex-metadata-scanner.md),
[provider-refresh](provider-refresh.md),
[session-context-actions](session-context-actions.md),
[session-ownership](session-ownership.md),
[architecture-mandates](architecture-mandates.md).

## Storage Shape

The active Codex provider path is the installed Codex CLI/app-server. Codex
owns local durable history under the Codex home directory, normally:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl
```

Each rollout is append-oriented JSONL. The first record is expected to be
`session_meta`, carrying the session id, cwd, timestamp, and related provider
metadata. YA uses that head metadata to answer questions Codex's directory
layout does not answer by itself:

- which project/worktree a rollout belongs to;
- which rollout id should be listed and opened;
- how to seed a session summary before reading the whole transcript.

This differs from Claude. Claude's local session path already encodes the
project directory, so project discovery can start from directory names. Codex
stores by date, so project discovery requires metadata.

### Reference-backed fork history

Paginated Codex rollouts may store a fork as a small child file whose
`session_meta.history_base` points to an immutable prefix of another rollout.
The reference contains the source rollout id plus exclusive ordinal and byte
cutoffs. YA treats that chain as the child's logical transcript:

- the selected child's `session_meta` is the sole canonical metadata record;
- each root-to-leaf segment contributes only its local ordinal range, bounded
  by the descendant's exact frozen cutoff;
- later appends to an ancestor never enter an existing child; and
- ancestors may themselves be reference-backed, archived, or zstd-compressed.

The history reference identifies the immutable rollout id encoded in the
provider filename, not a YA URL id substitution or a stable provider session
tree id. Resolution searches active and archived Codex roots, prefers the
plain representation when both plain and compressed copies exist, and fails
closed on a missing ancestor, cycle, identity mismatch, unsafe ordinal/byte
value, split JSONL record, or inconsistent cutoff. Detail surfaces report such
a lineage problem as a reader error after the leaf was found; summary/list
surfaces omit a session they cannot safely summarize.

Standalone and legacy rollouts retain the single-file read path. A
reference-backed detail cache reconstructs the immutable prefix on its first
read and then extends only from new leaf bytes. Physical compact-window
scanning is ineligible because leaf offsets are not logical-history offsets;
compact-tail and older-page requests use the established complete logical read
plus in-memory boundary selection. Provider-child ownership projection remains
physical to avoid assigning inherited subagents to the fork, while logical
detail parsing still recovers inherited agent mappings for navigation.

One deliberate exception to "YA never rewrites provider-owned rollouts": when
the user explicitly Kills a Codex session, YA renames its rollout with a
`.killed-<timestamp>` suffix so no resume path (YA or Codex app-server) can
find it. The rename is reversible and the content untouched; see
`topics/heartbeat.md` § Unowned Resume Exemptions and
`packages/server/src/sessions/resume-exemption.ts`.

## Process-Scoped Subagent Depth

The server-wide **Subagent nesting limit** is snapshotted for each newly started
or resumed Codex provider process. Numeric values `0` through `4` are sent as
`agents.max_depth` in the app-server config for `thread/start`, `thread/resume`,
and `thread/fork`; **Provider default** stores `null` and omits that key. YA
defaults the setting to `1` and never writes `~/.codex/config.toml`.

Pinned Codex core source describes `agents.max_depth` as a V1 multi-agent-thread
limit and explicitly says V2 ignores it. The Providers caption must retain that
limitation; YA must not imply that the setting constrains Codex V2 or Codex OSS
without a separately verified control.

## App-server notification correlation

YA stamps every app-server notification at the stdout boundary with a
monotonic receipt sequence, receipt time, queue depth, and provider/synthetic
source. Immediately before each `turn/start`, including an overload retry, it
captures the latest receipt sequence as that turn's queue barrier.

A turn-scoped notification whose different turn id was already received at or
before that barrier is stale backlog. YA suppresses it rather than replacing
the active turn or publishing old content as fresh activity. Consecutive stale
records produce one structured aggregate warning. A different turn id received
after the barrier remains eligible to replace the submission id because Codex
Core can report an active id that differs from the `turn/start` response; that
resynchronization warning includes the receipt sequence, barrier, queue age,
queued-ahead count, source, and provider-reported start time. This boundary is
sequence-based rather than a timing heuristic.

## Read Surfaces

There are two main YA surfaces over the same rollout tree:

- `packages/server/src/projects/codex-scanner.ts` discovers Codex projects by
  recursively finding rollout files, reading first-line `session_meta`, and
  grouping by canonical cwd.
- `packages/server/src/sessions/codex-reader.ts` lists and loads Codex sessions
  for a project. Listing also needs rollout metadata. Detail loading normalizes
  either a complete rollout or an authorized compact-tail source window for
  rendering.

`ProjectScanner` and route-level provider catalogs try to share this work
within a request path, while `SessionIndexService` persists provider-neutral
session summaries. `SessionDiscoveryIndex` now persists normalized provider
head metadata for observed rollout files under
`{dataDir}/indexes/session-discovery/`, including optional source fingerprints
for replacement detection. These layers reduce duplicate reads, but only
provider-owned files are authoritative.

### Detail entry-cache concurrency

`CodexSessionReader` may retain parsed detail entries for a rollout and extend
that cache when the provider appends JSONL. The cache update is a read as well
as a write: a detail request that observes cached byte boundary `S` and source
size `T` reads `[S, T)`, parses it, appends the entries, and advances the cached
boundary.

That transition has one in-flight owner per reader and session id. Concurrent
detail requests join the owner and recheck the cache after it finishes; they
must not independently read and append the same source range. The owner covers
the source check, bounded file read, parse, and cache publication. The retained
flat entry array is internal to the reader: only the owner mutates it, and
callers receive array copies.

Array-copy isolation must not discard exact-snapshot normalization reuse.
Copies issued from one accepted retained snapshot share a normalization
identity, so repeated detail projections reuse the same normalized messages.
An append, replacement, invalidation, or caller-side structural mutation
changes the entry sequence and must not reuse that projection. A caller can
therefore mutate its private array without poisoning the reader's retained
entries or making a different snapshot appear unchanged.

Plain-JSONL cold and incremental reads decode bounded byte chunks while
carrying incomplete JSONL records as raw bytes across both chunk boundaries and
cached append passes. They decode only complete lines or a complete final
record, and never materialize a whole rollout or appended suffix as one
JavaScript string. Each pass consumes exactly the byte count from its source
stat. Bytes appended after that observation belong to a later pass. A short
read fails rather than publishing entries under a byte boundary the reader did
not consume. A complete JSON record without its final newline may be accepted;
an incomplete trailing record remains provisional and is combined with the
next append without corrupting a split UTF-8 code point. Once head metadata has
identified a rollout, a detail-read failure is reported as a reader failure
rather than being converted into session absence.

A reference-backed warm cache also retains the leaf's expected next ordinal.
Every appended complete record must continue that ordinal sequence before the
reader publishes any of the new entries, so warm and cold reads reject the same
malformed lineage.

### Compact-tail source reads

For an uncursored compact-tail detail request over a large plain rollout, the
reader can avoid parsing and retaining the hidden prefix. The optimization is
eligible when the file is larger than 2 MiB times the requested compact-boundary
count and a cached session summary matches the captured rollout activity time.
It scans backward from the captured end of file in fixed 1 MiB blocks, carrying
only the JSONL fragment that crosses each block boundary, until it finds the
requested Nth `compacted` record.

If the boundary exists, the reader parses only from that record through the
captured end. It tags parsed entries with their absolute source byte offsets so
normalized fallback identities remain stable across bounded and complete reads.
Compact-boundary ids encode that offset explicitly. If the route's turn selector
starts later than the compact boundary, it returns a source cursor for the first
visible row without replacing that row's durable message identity. The bounded
suffix is not published as a complete-entry cache snapshot. The route also
requires an omitted prefix to retain an older-history cursor; it fails rather
than presenting the suffix as the start of the session.

A source-backed `beforeMessageId` continues the same reverse scan from the
cursor byte instead of the end of file. The reader finds the requested Nth
preceding `compacted` record and parses only the range from that boundary up to,
but not including, the cursor. If fewer than N preceding boundaries exist, it
reads only `[0, cursor)` and marks that page as the beginning of history. The
ordinary Load older control and older-history reverse search both use this path
through the same two-boundary session-detail request.

If the initial file has fewer requested boundaries, the summary is absent or
stale, the size crossover is not met, the source is compressed, or the located
range does not begin with a compact record, the reader uses the complete forward
path. Old or unparseable older-page cursors also use that established fallback.
This preserves the contract that fewer than N initial boundaries returns the
complete transcript while keeping valid plain-rollout pages blockwise.

A three-repetition diagnostic on the 538,524,921-byte recovery rollout measured
the detail read after an equivalent full-summary warm-up. The complete reader
took 4.07–4.38 seconds, retained 192,108 entries, and added 1.03–1.04 GB RSS.
The two-boundary tail took 30.5–30.7 ms for 855 entries and added 13–17 MB RSS;
the preceding two-boundary page took 37.7–39.4 ms for 1,503 entries and added
22–24 MB RSS. Both bounded modes retained zero complete-entry cache bytes. The
shared host had one non-overlapping agent and production services, so these are
diagnostic relative results rather than ratchet-grade absolute timings.

Cache invalidation advances the reader's cache revision before clearing
retained entries. Work started under an older revision may finish its file read
but cannot publish; the active request re-observes the source and retries. An
invalidation does not remove the in-flight owner and thereby permit a second
writer to race it.

Compressed rollouts remain full-read snapshots because their representation is
not append-derived. Cache retention is still bounded separately by the reader
memory work in tactical 038; eviction policy and concurrency ownership are
independent contracts.

## Compression And Representation

Upstream Codex can compress cold rollout files from:

```text
rollout-....jsonl
```

to:

```text
rollout-....jsonl.zst
```

The Codex Rust source treats this as a representation change, not a deletion:
compressed files are read through a line reader, and a compressed rollout can
be materialized back to plain `.jsonl` before append. Upstream also gives
plain `.jsonl` precedence when both representations exist.

YA should mirror the same logical identity rule:

- the canonical rollout identity is the plain `.jsonl` stem;
- `.jsonl` and `.jsonl.zst` are two representations of that rollout;
- if both exist, read the plain `.jsonl`;
- a compression transition must not make a session disappear.

## Current Gaps

Codex session support is correct for ordinary small local trees, but the
current shape has important scale and representation gaps:

- The durable `rollout file -> session_meta` catalog exists as a
  provider-neutral discovery index. It now detects common replacement and
  shrink/truncation cases through source fingerprints and cached file size,
  but a same-path overwrite that keeps the same file identity and
  non-shrinking size can still keep cached head metadata until a stronger
  validation pass exists.
- `CodexSessionScanner` now records project-scan metrics and slow logs for
  file walking, discovery-index behavior, plain/zstd precedence, and
  cache-backed compressed discovery. `FileWatcher` now records rescan duration,
  files walked, emitted create/modify/delete counts, overlap skips, and
  adaptive periodic-rescan delay. `CodexSessionReader` now records
  session-list scan metrics for shared-cache status, file walking,
  discovery-index behavior, plain/zstd precedence, parsed/skipped metadata,
  and filtered subagent sessions.
- `session_meta` is effectively append-immutable, and the Codex adapter now
  reuses cached metadata across ordinary append/mtime/size changes.
- Recursive discovery is still O(number of rollout files). Date-bucket layout
  is not yet used as a first-class pruning/indexing primitive.
- Provider archived sessions are not modeled as a first-class YA source. Codex
  has an archived-session concept; YA's ordinary Codex session path currently
  centers on the configured active sessions directory.
- Compression is a representation detail, but YA must not pay whole-transcript
  decompression cost just to rediscover head metadata. Because YA still
  declares Node `>=20.12`, `.jsonl.zst` rollouts are supported only when the
  active Node runtime exposes native `node:zlib` zstd APIs; older runtimes skip
  compressed rollouts cleanly.
- The session id visible in YA must remain explicit. Provider-native resume
  handles, filename ids, and `session_meta.id` mappings must not silently swap
  the user-facing YA session id without a documented provider contract.
- Provider-child discovery is an unbounded read surface today.
  `CodexSessionReader.listProviderChildSessions` bypasses the streaming
  `readAgentMappings` projection and calls full `readEntries` with caching
  disabled. Because the process-list route invokes it for every active and
  recently terminated row, client `session-updated` revalidation repeatedly
  parses unchanged parent rollouts. This is the demonstrated owner of the
  2026-08-04 sustained server CPU incident, not a speculative scanner cost;
  see [provider-child-sessions](provider-child-sessions.md) for the correction
  contract.

## Near-Term Direction

The next durable improvements should build on the provider-neutral discovery
index without letting it diverge from provider-owned history:

1. Add an explicit validation strategy for same-identity, non-shrinking header
   overwrites. Current source-fingerprint and shrink checks cover common
   replacement/truncation cases without rereading ordinary appends.
2. Extend metrics and watcher-path coverage around canonical-stem
   rename/compression/delete reconciliation; scanner tests and metrics now
   cover a `.jsonl -> .jsonl.zst` transition preserving the session.
3. Re-read head metadata only when the rollout is new, cached metadata is
   missing or invalid, the file appears replaced/truncated, or an explicit
   validation pass marks the cache suspect.
4. Extend scanner instrumentation before broadening scope: dirty scopes and
   skipped date buckets once date-bucket probing exists.
5. Replace full-entry provider-child discovery with one shared, versioned
   child-summary projection. Coalesce identical in-flight versions, retain only
   child lifecycle facts, and inspect ordinary appends incrementally.

Invariant: the discovery index is derived and non-authoritative. YA must first
observe a provider file and only then reuse indexed metadata for that file. A
deleted or rotated provider file must disappear from YA lists immediately even
if its discovery shard still contains a stale record.

This keeps YA faithful to Codex's local transcript model while preserving the
resource-quiescence requirement from
[architecture-mandates](architecture-mandates.md).
