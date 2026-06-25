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

## Read Surfaces

There are two main YA surfaces over the same rollout tree:

- `packages/server/src/projects/codex-scanner.ts` discovers Codex projects by
  recursively finding rollout files, reading first-line `session_meta`, and
  grouping by canonical cwd.
- `packages/server/src/sessions/codex-reader.ts` lists and loads Codex sessions
  for a project. Listing also needs rollout metadata; loading a session reads
  the full JSONL and normalizes entries for rendering.

`ProjectScanner` and route-level provider catalogs try to share this work
within a request path, while `SessionIndexService` persists provider-neutral
session summaries. These layers reduce duplicate reads, but they are not a
durable Codex rollout metadata catalog.

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

- There is no durable `rollout file -> session_meta` catalog. Short-lived
  scanner caches and persisted session summaries do not prevent first-line
  metadata from being read again after TTL expiry, restart, invalidation, or
  full validation.
- `session_meta` is effectively append-immutable, but current discovery is
  still tied to file freshness paths. A rollout append changes mtime and size,
  while the first line almost certainly did not change.
- Recursive discovery is still O(number of rollout files). Date-bucket layout
  is not yet used as a first-class pruning/indexing primitive.
- Provider archived sessions are not modeled as a first-class YA source. Codex
  has an archived-session concept; YA's ordinary Codex session path currently
  centers on the configured active sessions directory.
- Compression is a representation detail, but YA must not pay whole-transcript
  decompression cost just to rediscover head metadata.
- The session id visible in YA must remain explicit. Provider-native resume
  handles, filename ids, and `session_meta.id` mappings must not silently swap
  the user-facing YA session id without a documented provider contract.

## Near-Term Direction

The next durable improvement should treat Codex rollout metadata as its own
indexing problem:

1. Cache successful `session_meta` reads durably by canonical rollout stem and
   file identity.
2. Reuse cached metadata on append/modify events; only session summary or
   transcript detail needs to refresh.
3. Reconcile rename/compression/delete events against the canonical stem so a
   `.jsonl -> .jsonl.zst` transition preserves the session.
4. Re-read head metadata only when the rollout is new, cached metadata is
   missing or invalid, the file appears replaced/truncated, or an explicit
   validation pass marks the cache suspect.
5. Add scanner instrumentation before broadening scope: files walked, metadata
   cache hits/misses, compressed opens, zstd first-line reads, scan duration,
   and skipped date buckets.

This keeps YA faithful to Codex's local transcript model while preserving the
resource-quiescence requirement from
[architecture-mandates](architecture-mandates.md).
