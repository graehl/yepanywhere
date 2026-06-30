# Codex Session Index Memory Spikes

Status: Implementation chunk 2 landed 2026-06-30 and was measured against a
real cold YA index over the local provider histories. Codex summary reads now
stream JSONL instead of materializing full transcript entries; the remaining
measured peak is from concurrent cold summary parsing and very large individual
JSONL lines, not retained Codex entry-cache arrays.

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
- [x] Checked whether Claude and other provider readers have the same
  summary-index cold-fill shape.
- [x] Replace summary reads with a streaming Codex summary parser.
- [x] Run a post-chunk-2 cold-index harness against a temporary
  `YEP_DATA_DIR` and the real local provider histories.
- [ ] Replace Claude summary reads with a compact DAG summary parser.
- [ ] Bound `CodexSessionReader.entryCache` by byte budget and session count.
- [x] Decide whether a parse queue is still needed after the streaming-summary
  cold-index harness.
- [ ] Add a summary parse queue/semaphore for cold summary-index fills.

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

## Provider Parity Check

Checked on 2026-06-30 before implementation chunk 2.

Claude:

- `ClaudeSessionReader.getSessionSummaryFromDir()` reads the whole JSONL file,
  trims and splits it, parses every line into `ClaudeSessionEntry[]`, builds a
  DAG with `buildDag(messages)`, then derives active-branch title, message
  count, model, context usage, and recent-agent text.
- `ClaudeSessionReader` does not have a full-transcript `entryCache` equivalent.
  Its parsed messages are local to the summary/detail call and should be
  collectible after the request.
- The risk is therefore transient cold-fill memory and CPU, not indefinite
  retention from an unbounded reader cache.
- Exact Claude summaries are harder to make purely rolling than Codex summaries
  because active-branch selection depends on `uuid`/`parentUuid`, branch tips,
  timestamps, progress-message exclusions, compaction boundaries, and active
  branch context usage. A compact DAG parser can still retain much less than the
  full raw transcript by storing only per-node summary fields needed for branch
  selection and summary derivation.

Local Claude history snapshot:

- `~/.claude/projects`: 3277 JSONL files, about 2.7 GB total.
- Largest project bucket:
  `/Users/kgraehl/.claude/projects/-Users-kgraehl-code-jstorrent`, 1164 files,
  about 1079.8 MB total, largest file about 61.6 MB.
- Other large buckets include webvam at about 444.3 MB and yepanywhere at about
  357.8 MB.

Gemini:

- `GeminiSessionReader.getSessionSummary()` reads and parses the whole Gemini
  session JSON file for summary fields.
- This has the same cold-fill class, although the storage format is not JSONL
  and local sizing was not the incident driver.

OpenCode/Grok/Pi:

- OpenCode's SQLite reader is more selective for summaries. The legacy
  file-backed OpenCode path reads per-session and per-message JSON files, but it
  is not the same single huge JSONL transcript path.
- Grok summaries use a small native `summary.json`; full `updates.jsonl` parsing
  is for detail.
- Pi parses JSONL and keeps a parsed-session cache keyed by file/mtime; that is
  a separate provider-specific retention concern, but not the Codex
  `entryCache` issue.

Conclusion:

- The summary cold-fill fix should become a provider-reader hardening theme.
- Start with Codex because it caused the observed incident, its summaries are
  linear, and it still has the largest local rollout bucket.
- Follow with a Claude compact-DAG summary parser because local Claude history
  is also multi-GB and the shared session index calls every provider's
  `getSessionSummary()` on cache misses.
- Keep the `entryCache` byte/session cap Codex-specific unless another provider
  shows equivalent long-lived parsed-transcript retention.

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
cache. Before implementation chunk 1 it paid the full parse cost and stored
parsed entries in `entryCache`. It now skips cache writes for summary reads, but
it still goes through `readJsonlLines()` and materializes a full
`CodexSessionEntry[]` before deriving the summary. Add a summary-only path that
either:

- parses entries without storing them in `entryCache`; or
- streams JSONL records and computes summary state incrementally.

Streaming is more realistic for summaries than for full detail normalization and
is now the preferred next step. Title, full title, message count, model,
provider, launch turn context, context usage, and parent metadata can be tracked
while walking the file. Full detail loading may still need more
ordering/deduplication context and can remain a separate problem.

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

- Completed by implementation chunk 2. The next recommended code chunk is the
  Claude compact-DAG summary parser; run the Codex cold-index harness when
  measuring before/after memory behavior or before tuning cache limits.

## Concrete Implementation Steps

### Chunk 2: Streaming Codex Summary Parser

Priority: highest.

Goal:

- Make `CodexSessionReader.getSessionSummary()` avoid whole-file
  `readFile -> trim -> split`, full `CodexSessionEntry[]` allocation, and
  transcript dedupe work.
- Keep `getSession()` on the existing full-entry path because visible detail
  loading still needs normalized transcript data and append caching.

Implementation shape:

- Add a Codex JSONL streaming/line-iteration helper for plain rollout files.
  Either extend it to compressed rollouts immediately, or explicitly fall back
  to the current non-caching path for compressed files until zstd streaming is
  implemented.
- Parse one line at a time with `parseCodexSessionEntry()` and update rolling
  summary state instead of pushing entries into an array.
- Track the first `session_meta` entry for id, created time, source,
  originator, CLI version, parent/fork id, and model-provider fallback.
- Track title with the current duplicate-user-message rules:
  - remember the first non-system `event_msg.user_message`;
  - remember the first non-system `response_item` user message;
  - if any response-item user message exists, use the response-item title path
    and ignore event user-message titles.
- Track message count with the same duplicate-user-message rules:
  - count `event_msg.user_message` entries separately;
  - count `response_item` message entries with role `user` or `assistant`;
  - final count is `responseMessageCount` plus event user-message count only
    when no response-item user message was seen.
- Track last `turn_context.payload.model` for the model, first `turn_context`
  for launch approval/sandbox policy, and latest usable `token_count` for
  context usage. Compute provider and context-window fallback after the scan so
  they use final model/provider state.
- Add a `codex_summary_stream` metric, or equivalent `codex_entry_read`
  replacement, with file size, line count, max line length, parse duration, and
  memory deltas.

Acceptance:

- Summary path does not call `readJsonlLines()` for plain rollout files.
- Summary path never writes to or grows `entryCache`.
- Tests compare streaming summaries against the existing entry-array summary
  behavior for title, message count, model, context usage, provider, parent id,
  approval policy, and sandbox policy.
- Tests cover mixed `event_msg.user_message` and `response_item` user messages
  so the duplicate-count/title rules stay stable.
- Empty temporary summary indexes over large local Codex history no longer show
  `codex_entry_read` events with `purpose: "summary"` for plain files.

Validation:

```bash
pnpm --filter @yep-anywhere/server test -- \
  test/sessions/codex-reader-oss.test.ts \
  test/indexes/SessionIndexService.test.ts
pnpm --filter @yep-anywhere/server build
```

Then run a cold-index harness with a temporary data directory:

```bash
SESSION_INDEX_LOG_PERF=true \
CODEX_READER_LOG_PARSE=true \
YEP_DATA_DIR=/tmp/ya-cold-index-streaming \
pnpm --filter @yep-anywhere/server dev
```

Request `/api/inbox` and at least one project session-list route after startup.
Record peak RSS, summary-index miss bytes, summary parse durations, and whether
any summary path still uses `readJsonlLines()`.

## Implementation Chunk 2

Implemented 2026-06-30:

- Added `iterateJsonlLines()` in the JSONL utility layer so callers can stream
  plain and zstd JSONL lines without materializing the full file string or a
  full line array.
- `CodexSessionReader.getSessionSummary()` now builds summaries from streaming
  state instead of calling `readEntries()` / `readJsonlLines()`.
- The streaming summary state tracks only session metadata, first launch
  context, title candidates, message counters, latest model, and latest usable
  token-count context candidate.
- Summary duplicate suppression is preserved for exact duplicate user/assistant
  message records, but uses fixed-size hashes instead of storing full message
  text as Set keys.
- Detail, subagent, and agent-mapping reads still use the existing full-entry
  path; visible session detail still benefits from append caching.
- Added `codex_summary_stream` metrics with file size, line count, parsed and
  deduped entry counts, duplicate skips, max line length, memory deltas, and
  current entry-cache stats.
- Added a regression test that compares streaming summary output against the
  full detail-summary path for title selection, duplicate handling, message
  count, provider/model, parent/source metadata, approval/sandbox policy, and
  context usage.

Validation:

```bash
pnpm --filter @yep-anywhere/server test -- \
  test/sessions/codex-reader-oss.test.ts
pnpm --filter @yep-anywhere/server test -- \
  test/indexes/SessionIndexService.test.ts
pnpm --filter @yep-anywhere/server build
pnpm lint
pnpm --filter @yep-anywhere/server test
```

Result:

- Focused Codex reader tests passed: 19 passed, 1 skipped.
- Focused session-index tests passed: 23 passed.
- Server build passed.
- `pnpm lint` exited 0; it still reports the existing unrelated advisory items
  in `packages/server/src/routes/sessions.ts` and
  `packages/server/test/augments/task-list-augments.test.ts`.
- Full server test suite passed: 154 files, 2356 passed, 6 skipped.

## Cold-Index Harness After Chunk 2

Ran on 2026-06-30 with a temporary YA data directory and the real local
provider histories:

```bash
PORT=4500 \
MAINTENANCE_PORT=0 \
YEP_DATA_DIR=/tmp/ya-cold-index-cCXtKp \
LOG_TO_FILE=true \
LOG_LEVEL=info \
SESSION_INDEX_LOG_PERF=true \
CODEX_READER_LOG_PARSE=true \
pnpm --dir packages/server run dev
```

The temporary data dir forced cold YA summary indexes while preserving the real
provider stores:

- `/Users/kgraehl/.codex/sessions`
- `/Users/kgraehl/.claude/projects`
- `/Users/kgraehl/.gemini/tmp`

Cold `/api/inbox` result:

- HTTP 200 in 32.8 seconds, 8507 bytes.
- Response tiers: 0 needs-attention, 0 active, 6 recent-activity, 13 unread-8h,
  8 unread-24h.
- Server RSS sampled from about 378 MB before the request to a 1.50 GB peak.
- RSS immediately after the request was about 683 MB.
- The run wrote 56 summary index files containing 4421 cached sessions:
  3271 Claude, 6 Claude-Ollama, and 1144 Codex.

Warm `/api/inbox` against the same temp data dir:

- HTTP 200 in 0.75 seconds, 8507 bytes.
- Same response-tier counts as the cold request.
- RSS samples stayed around 440 MB during the warm request.

Codex reader metrics from `codex_summary_stream`:

- 1147 streamed summary reads.
- About 4.50 GB of rollout bytes streamed.
- About 1.52 million JSONL lines parsed.
- Aggregate Codex summary parse duration was about 124 seconds while the cold
  request completed in 32.8 seconds, proving multiple project-scope summary
  streams were running concurrently.
- Largest rollout streamed: 173.3 MB.
- Largest single JSONL line: 32.2 MB.
- Slowest single summary stream: 5.4 seconds.
- Highest recorded RSS after a Codex stream: 1.55 GB.
- Highest recorded heap after a Codex stream: 1.23 GB.
- `entryCache.sessions` stayed at 0 for every Codex summary stream.
- The run produced 0 `codex_entry_read` events, so plain Codex summary-index
  cold fill did not call the full-entry reader.

Largest Codex project buckets during the cold run:

| project | sessions | streamed MB | aggregate parse ms | largest file MB | largest line MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/Users/kgraehl/code/webvam` | 159 | 1282.0 | 21723 | 173.3 | 32.2 |
| `/Users/kgraehl/code/mclone` | 141 | 1118.0 | 26854 | 74.2 | 9.8 |
| `/Users/kgraehl/code/playbox` | 194 | 794.0 | 24175 | 86.8 | 15.7 |
| `/Users/kgraehl/code/yepanywhere` | 351 | 541.6 | 16692 | 34.0 | 24.8 |

Interpretation:

- Implementation chunk 2 fixed the unbounded summary-retention mechanism for
  Codex. The cold run streamed multi-GB history with no summary-path
  `entryCache` growth and no full-entry summary reads.
- The remaining cold peak is still high enough to justify a concurrency cap.
  Streaming limits retained memory, but it does not prevent several project
  scopes from parsing huge files or huge individual lines at the same time.
- A parse queue is no longer conditional. It is the next direct mitigation for
  restart/reconnect bursts and cold `/api/inbox` fan-out.
- `SessionIndexService` perf records were visible in the dev terminal during
  the run, but did not persist into `logs/server.log`. The service currently
  captures a module-scope logger, so if the module is imported before startup
  logger initialization, perf records can use the early console-only logger.
  Fix this before relying on file-log-only harness aggregation for
  `session_index_perf`.

### Chunk 3: Summary Parse Queue

Priority: highest after the cold-index harness.

Goal:

- Prevent restart/reconnect bursts and cold `/api/inbox` fan-out from running
  many expensive provider summary parses at the same time.
- Keep warmed index reads fast and keep visible session detail higher priority
  than background summary fill.

Implementation shape:

- Add a small provider-summary parse scheduler/semaphore used by
  `SessionIndexService` around cache-miss `reader.getSessionSummary()` calls.
- Start with a conservative global or provider-root concurrency of 1 for
  summary-index cold fills, with an env override for measurement.
- Coalesce identical file/session summary parses when the same miss is requested
  concurrently.
- Keep the queue scoped to summary/index work first; do not route ordinary
  warmed cache reads through it.
- Prioritize visible detail reads and explicit project/session views over
  background inbox backfill if they ever share the same scheduler.
- Fix the `SessionIndexService` logger capture so `session_index_perf` is
  persisted to the configured JSON log file as well as the dev terminal.

Acceptance:

- A cold `/api/inbox` over the current real local histories still completes and
  writes complete summary indexes.
- Aggregate parse work may remain large, but sampled peak RSS is bounded by one
  or a small number of active summary parses instead of the full project fan-out.
- `codex_summary_stream` still reports `entryCache.sessions: 0` and
  `codex_entry_read` remains absent for plain Codex summaries.
- `session_index_perf` is present in `logs/server.log` for future harness
  aggregation.
- Warm `/api/inbox` remains sub-second on the temp data dir after indexes are
  built.

### Chunk 4: Claude Compact-DAG Summary Parser

Priority: high after the summary parse queue.

Goal:

- Make Claude summary-index cold fill avoid retaining full raw
  `ClaudeSessionEntry[]` objects and full message/tool content while computing
  the same `SessionSummary`.
- Preserve detail loading as-is until there is evidence that visible Claude
  detail reads, not cold summary fills, are the bottleneck.

Implementation shape:

- Add a Claude summary parser that walks JSONL lines and stores compact DAG
  nodes: uuid, parent uuid, line index, timestamp, type, progress exclusion,
  compact logical-parent metadata, first timestamp, first user-title candidate,
  model candidate, usage candidate, and last-agent excerpt candidate.
- Reuse the branch-selection semantics from `buildDag()`:
  - skip entries without uuid and progress nodes for branch selection;
  - choose tip by latest timestamp, then branch length, then line index;
  - follow `parentUuid` and compact-boundary logical parents;
  - keep the existing fallback for missing logical/progress parents.
- After selecting the active branch, derive conversation message count, latest
  model, context usage including compaction overhead, and recent-agent excerpt
  from compact node summaries.
- Compare compact summaries against current full-parse summaries in tests before
  replacing the production path.

Acceptance:

- Claude summary cold fill no longer builds a full raw message array for each
  miss.
- Tests cover rewinds/branches, compaction metadata, model changes, context
  usage, IDE metadata title filtering, and last-agent excerpt behavior.
- The compact parser intentionally remains a summary parser; `getSession()`
  still returns full raw messages.

### Chunk 5: Bounded Entry Cache

Priority: high after the summary parse queue and still valuable before broad
detail-cache use.

Goal:

- Prevent visible session detail loads, subagent reads, and agent-mapping scans
  from permanently pinning many parsed transcripts in one process.

Implementation shape:

- Replace the unbounded `Map<string, CodexEntryCache>` with an LRU-like cache
  that tracks approximate source bytes, entry count, last access time, and
  session count.
- Add conservative defaults, for example:
  - max cached source bytes;
  - max cached sessions;
  - optional max single-file cacheable size;
  - optional TTL for old entries.
- Allow env overrides for local diagnosis, but keep the default safe without
  user configuration.
- Skip storing a detail parse when the file is larger than the configured
  single-entry or total budget. Return the parsed entries to the current request
  but do not retain them.
- Preserve append behavior for cacheable active sessions.
- Log evictions and expose cache stats through the existing diagnostics path.

Acceptance:

- Repeated detail loads of large historical sessions cannot leave RSS growing
  without bound.
- A cache entry larger than the budget is not retained.
- Tests cover hit, append, stale invalidation, size eviction, count eviction,
  and non-cacheable large files.

### Chunk 6: Detail Parse Queue, Only If Still Needed

Priority: conditional after the summary parse queue and bounded entry cache.

Streaming summaries remove the broadest summary-retention spike, and the chunk
3 queue addresses cold summary-index fan-out. Bounded entry caching removes the
clearest remaining retention leak. Add a separate detail parse queue only if
instrumentation shows many expensive full-detail parses running at once after
those fixes.

Implementation shape if needed:

- Add a provider-root-scoped semaphore for expensive full JSONL parses.
- Coalesce identical file parses by session/file identity.
- Prioritize visible detail loads above background index or historical
  metadata scans.
- Consider byte-aware scheduling so two very large rollouts do not parse at the
  same time.

Acceptance:

- Restart/reconnect bursts cannot start many large full-transcript parses
  concurrently.
- Visible session detail is not starved behind background list/index work.
