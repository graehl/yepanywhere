# Codex Session Index Memory Spikes

Status: First implementation chunk landed 2026-06-30.

Progress:

- [x] Reconstructed the reload/OOM window from server logs.
- [x] Verified that Codex project/session metadata scanning is first-line and
  discovery-index-backed in the observed window.
- [x] Verified that whole-file JSONL `readFile -> trim -> split` belongs to the
  Codex session reader, not the metadata scanner.
- [x] Measured current `~/.codex/sessions` size distribution against the local
  history that triggered the issue.
- [x] Ran a standalone memory probe against the active rollout and one large
  mclone rollout.
- [x] Ran a low-risk warm `/api/inbox` concurrency probe against the current
  server.
- [x] Add production-quality instrumentation around summary-index cache misses,
  reader parse phases, and entry-cache retention.
- [x] Stop summary-only Codex reads from populating the full transcript
  `entryCache`.
- [x] Keep intentional session detail loads cache-backed by building the detail
  response summary from the same cached entry read.
- [x] Add a focused regression test for summary-read non-retention.
- [x] Validate with server build and focused reader/index tests.
- [x] Decide and land the first implementation chunk.

## Incident

Clicking the dev reload banner's `Reload Server` button around
2026-06-30 11:43:24 CEST restarted the server. The new server process then
hit a V8 heap OOM near 4 GB roughly 20-25 seconds later.

Observed log sequence:

- 2026-06-30 11:43:24.864 CEST: old process pid `37659` logged
  `[ServerAdmin] Restart requested via API`.
- 2026-06-30 11:43:27.739 CEST: new process pid `16671` served session detail
  for mclone session `019f17c7-cf36-7c83-8033-2a41b2b95a5d`.
- 2026-06-30 11:43:27-11:43:49 CEST: pid `16671` logged repeated
  `CODEX_SCANNER` slow scans, all with `discoveryIndexHits: 1145` and
  `firstLineReadsPlain: 0`.
- 2026-06-30 11:43:48.665 CEST: session detail for the same mclone session had
  `projectMs: 2029.5`, `readMs: 75.2`, and `totalMs: 2384.1`.
- The crashing stack included `StringPrototypeTrim`, matching the whole-file
  JSONL reader path.

The reload button itself is not heavy: the client posts to `/server/restart`,
and the server marks reload requested and exits after a short delay. The risky
work is what reconnecting clients ask the new process to do immediately after
restart.

## Confirmed Code Paths

Metadata discovery:

- `CodexSessionScanner.scanAllSessions()` enumerates rollout files and calls
  `readSessionMeta()` in batches of 50.
- `readCodexRolloutMetadata()` first checks `SessionDiscoveryIndex`.
- On cache miss, plain JSONL metadata uses `readFirstLine()`, a bounded partial
  read.

Whole-file transcript parsing:

- `CodexSessionReader.getSessionSummary()` calls `readEntries()`.
- `CodexSessionReader.getSession()` calls `getSessionSummary()` and then
  `readEntries()` again, usually hitting the same reader's entry cache.
- `readEntries()` cold path calls `readJsonlLines()`.
- `readJsonlLines()` does:

```ts
const raw = await readUtf8File(filePath);
return stripBom(raw).trim().split("\n");
```

Summary-index fan-out:

- `/api/inbox` fetches sessions from all projects in parallel.
- `listSessionsForSource()` uses `SessionIndexService.getSessionsWithCache()`
  when available.
- `SessionIndexService.runFullValidation()` enumerates files, stats them, and
  calls `reader.getSessionSummary()` for every summary cache miss.
- Codex summary indexes are scoped by `codex::<sessionsDir>::<projectPath>`.
  Different project paths therefore have separate summary indexes and separate
  reader instances.
- `app.ts` globally caches up to 500 reader instances. `CodexSessionReader`
  has an unbounded `entryCache` per instance.

This means a cold or stale Codex summary index can parse and retain many full
rollouts during a session-list request, even when the visible page is only one
session.

## Current Local History

Measured on 2026-06-30:

- `~/.codex/sessions`: 1146 rollout files, about 4.46 GB total.
- Top project buckets by total rollout bytes:

| cwd | files | total MB | >20 MB | >50 MB | largest MB | rough 3.1x retained heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/Users/kgraehl/code/webvam` | 159 | 1282.0 | 15 | 6 | 173.3 | 3974.2 MB |
| `/Users/kgraehl/code/mclone` | 140 | 1092.9 | 17 | 3 | 74.2 | 3388.0 MB |
| `/Users/kgraehl/code/playbox` | 194 | 794.0 | 12 | 1 | 86.8 | 2461.3 MB |
| `/Users/kgraehl/code/yepanywhere` | 351 | 529.1 | 1 | 0 | 34.0 | 1640.4 MB |

The active session from the incident was not large enough by itself to explain
a 4 GB heap:

- path:
  `~/.codex/sessions/2026/06/30/rollout-2026-06-30T11-06-38-019f17c7-cf36-7c83-8033-2a41b2b95a5d.jsonl`
- size: 7.3 MB
- lines: 661
- max line: 1.6 MB
- first `session_meta` line: 21,971 bytes

## Memory Probe

A standalone Node `--expose-gc` probe reproduced the cold reader shape:

1. `fs.readFileSync(file, "utf8")`
2. `trim().split("\n")`
3. `JSON.parse()` every line into entries
4. run a local equivalent of Codex entry dedupe keys
5. retain parsed entries as the reader cache would

Results:

| file | size | RSS peak | heap after parse | heap after GC retaining entries |
| --- | ---: | ---: | ---: | ---: |
| active incident session | 7.3 MB | 83.2 MB | 25.5 MB | 25.3 MB |
| large mclone rollout | 74.2 MB | 508.9 MB | 231.1 MB | 231.1 MB |

The large rollout retained about 3.1x its file size as parsed heap, before
counting reader-instance overhead, concurrent requests, normalized session
objects, response construction, or V8 fragmentation.

The dedupe key path is also a potential transient amplifier because it builds
Set keys from full message text for selected `response_item` and `event_msg`
entries.

## Inbox Probe

Current on-disk indexes are warm, so live `/api/inbox` no longer reproduces the
cold failure.

Measured against the running local server on 2026-06-30:

- before probe: pid `19778` RSS about 3515 MB.
- six concurrent `GET /api/inbox` calls: all 200, about 96-128 ms, 2238 bytes.
- after probe: RSS about 3526 MB.

Interpretation:

- Warm inbox is fast and does not show an obvious incremental spike.
- The current process is already retaining several GB, which is consistent
  with retained reader/session state rather than a purely transient scanner
  spike.
- A faithful cold reproduction needs a temp data directory or forced summary
  index misses, not the current warmed live process.

## Hypotheses

### Scanner Reads Whole Files

Status: unlikely for the observed scanner logs.

The scanner logs during the crash window show 1145 discovery-index hits and no
first-line reads. Source inspection confirms scanner metadata discovery is
first-line-only on misses. Scanner duration can still be noisy because many
stats and project enumerations happen under reconnect load, but it is not the
path matching `StringPrototypeTrim`.

### Visible Session Detail Alone OOMed

Status: unlikely.

The visible incident session is 7.3 MB and retained about 25 MB in the probe.
It can contribute to post-restart pressure, but it is not a standalone 4 GB
explanation.

### Reconnect/Inbox Triggered Broad Codex Enumeration

Status: supported.

Logs around the restart show `CODEX_READER` scans for roughly 20 project paths.
The shared metadata scan coalesces well, but each project path has its own
summary index and reader cache. `/api/inbox` explicitly fans out over projects
in parallel.

### Cold/Stale Summary Index Parsed Many Large Rollouts

Status: plausible and high-risk.

`SessionIndexService.runFullValidation()` calls `reader.getSessionSummary()` for
every summary cache miss. For Codex, `getSessionSummary()` currently parses the
whole rollout through `readEntries()`, and `readEntries()` caches parsed entries.
On this local history, a full cold summary pass for mclone alone can plausibly
retain multiple GB.

The missing evidence is per-request summary-index cache-miss bytes and per-file
parse memory. Current logs only expose scanner metrics by default; session-index
perf logging is env-gated and does not include byte totals.

### Unbounded Entry Cache Retained the Spike

Status: strongly supported.

`CodexSessionReader.entryCache` is an unbounded `Map`, and `app.ts` keeps reader
instances in a global reader cache. The live process remained around 3.5 GB RSS
after the crash/restart sequence and after warm inbox requests.

## First Changes To Consider

### 1. Add Targeted Instrumentation

This is the safest first chunk.

Add structured metrics for:

- `SessionIndexService` full validation:
  - scope key, provider/source, project id;
  - mode: fast, incremental, full;
  - file count, cache-hit count, cache-miss count;
  - cache-miss total bytes and top N largest misses;
  - parse calls, parse duration, save duration;
  - `process.memoryUsage()` at start/end and optionally around high-byte parses.
- `CodexSessionReader.readEntries()` cold path:
  - session id, file size, line count, max line length;
  - read, split, parse, dedupe, cache-store durations;
  - heap/RSS deltas;
  - whether the read is for summary or detail.
- `CodexSessionReader.entryCache`:
  - entry count, cached session count, approximate cached bytes;
  - evictions once bounded caching exists.

Acceptance:

- One restart/reconnect run can answer whether OOM was caused by scanner
  metadata, summary-index cache misses, detail reads, or retained entry cache.
- The existing `SESSION_INDEX_LOG_PERF=true` path reports byte totals, not just
  `parseCalls`.

### 2. Stop Summary Reads From Retaining Full Entry Arrays

This is the clearest behavioral fix.

`getSessionSummary()` needs summary fields, not a reusable full transcript
cache. It currently pays the full parse cost and then stores parsed entries in
`entryCache`. Add a summary-only path that either:

- parses entries without storing them in `entryCache`; or
- streams JSONL records and computes summary state incrementally.

Streaming is more realistic for summaries than for full detail normalization:
title, full title, message count, model, provider, turn context, context usage,
and parent metadata can be tracked while walking the file. Full detail loading
may still need more ordering/deduplication context and can remain a separate
problem.

Acceptance:

- A cold summary-index validation can parse large rollouts without retaining
  parsed transcript arrays after each summary is cached.
- Session detail still benefits from entry caching where it is intentionally
  loading a transcript.

### 3. Bound `CodexSessionReader.entryCache`

Unbounded per-reader transcript caching is unsafe with multi-GB histories.

Add an LRU or byte-budgeted cache, preferably shared in policy across provider
readers:

- cap by approximate retained bytes and session count;
- treat active/owned visible sessions as more cache-worthy than old summaries;
- expose cache stats in logs or a debug endpoint;
- clear or shrink caches under memory pressure if Node reports high heap usage.

Acceptance:

- Loading several historical large sessions cannot permanently pin several GB
  in one server process.
- Cache behavior is visible enough to debug future regressions.

### 4. Add a Memory-Aware Parse Queue

This addresses concurrent spikes.

The existing coalescing dedupes identical loads, but inbox and global session
routes can trigger different project scopes at the same time. Add a shared
queue/semaphore for expensive whole-file JSONL parses:

- global or per-provider-root concurrency limit, initially 1;
- optional byte-aware scheduling so huge files do not run together;
- request coalescing by file identity for identical parse work;
- ability to prioritize visible session detail over background summary fill.

Acceptance:

- A restart/reconnect burst cannot launch many large JSONL parses at once.
- Visible session detail is not starved behind low-priority inbox backfill.

### 5. Make Cold Summary Index Fill Incremental

This is larger because it changes list freshness behavior.

For an empty or obviously cold summary index over a huge provider tree, avoid
parsing every miss synchronously in `/api/inbox`:

- return known summaries immediately when available;
- parse recent or small files first;
- schedule older/larger misses in a background fill queue;
- mark the response/index as partial in internal diagnostics;
- keep default user-visible completeness for normal warmed operation.

This should be designed carefully because YA's default lists should remain
complete. Hidden recency filtering is not an acceptable silent default. An
explicit `SESSION_AUTO_ARCHIVE_DAYS`-style option can help some users, but it
does not replace safe default behavior.

### 6. Consider an Isolated Summary Parser Worker

This is a later hardening step.

A worker thread or child process can parse huge rollouts and return only summary
objects. A child process gives the strongest isolation because its heap can be
released when it exits and an OOM is less likely to take down the app server.

Trade-off:

- More robust against pathological files and V8 fragmentation.
- More moving parts, serialization overhead, and cancellation complexity.

## Stress Plan

Use three levels, in order:

1. Standalone parser harness:
   - parse selected real local rollout files;
   - record phase timings and memory;
   - cap file sets at first, then scale to top-N project buckets.
2. App-level cold-index harness:
   - run YA against a temporary data directory with empty indexes;
   - enable session-index and reader parse instrumentation;
   - request `/api/inbox` and `/api/sessions`;
   - compare peak RSS and response behavior before/after fixes.
3. Live warm-path regression:
   - repeat small concurrent `/api/inbox` probes on the normal dev server;
   - verify warmed requests stay fast and do not grow retained RSS over time.

Do not use the current warmed live process as the primary cold reproducer. It is
already high-RSS and its current indexes are hot.

## Suggested First Chunk

Start with instrumentation plus summary-read non-retention.

Reasoning:

- Instrumentation removes the remaining uncertainty around exact cache-miss
  bytes and per-file parse memory.
- Summary-read non-retention is directly connected to the measured 3.1x heap
  amplification and does not require changing user-visible list semantics.
- A parse queue is valuable, but it is easier to tune once the logs show how
  much parsing occurs and which routes initiate it.

Initial acceptance target:

- With empty temporary summary indexes over the current local Codex history,
  `/api/inbox` should not retain parsed entries for summary-only cache fills.
- Peak memory during cold fill should be bounded by the largest active parse
  plus normal app overhead, not by the sum of all historical rollouts parsed so
  far.
- Warm `/api/inbox` behavior should remain at roughly current speed.

## Implementation Chunk 1

Implemented 2026-06-30:

- `CodexSessionReader.getSessionSummary()` now reads entries with
  `cache: false`, so summary/list/index paths no longer populate
  `entryCache`.
- `CodexSessionReader.getSession()` now reads detail entries once with
  `cache: true` and builds the response summary from those same entries,
  avoiding a summary read followed by a detail reread.
- `CodexSessionReader.getAgentMappings()` now uses non-retaining entry reads
  because it scans historical sessions for metadata rather than intentionally
  loading transcripts for display.
- `CodexSessionReader.getEntryCacheStats()` exposes entry-cache session count,
  source bytes, and entry count for tests and diagnostics.
- `CODEX_READER_LOG_PARSE=true` logs `codex_entry_read` metrics with purpose,
  cache mode/status, file size, phase timings, memory deltas, and entry-cache
  stats. Slow entry reads also log without the env gate.
- `SESSION_INDEX_LOG_PERF=true` session-index logs now include structured
  `session_index_perf` fields for total files, cache hits/misses, miss bytes,
  and the largest cache misses.

Validation:

```bash
pnpm --filter @yep-anywhere/server build
pnpm --filter @yep-anywhere/server test -- \
  test/sessions/codex-reader-oss.test.ts \
  test/indexes/SessionIndexService.test.ts
```

Result:

- Server build passed.
- Focused reader/index tests passed: 41 passed, 1 skipped.

Next recommended chunk:

- Run the cold-index harness against a temporary `YEP_DATA_DIR` with
  `SESSION_INDEX_LOG_PERF=true CODEX_READER_LOG_PARSE=true`, then use the new
  logs to size and prioritize an `entryCache` byte cap and/or memory-aware
  parse queue.
