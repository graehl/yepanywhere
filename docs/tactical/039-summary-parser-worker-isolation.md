# Summary Parser Worker Isolation

Status: implementation chunk 2 completed locally. Claude summary parsing can
now route through the child-process worker behind the default-off
`CLAUDE_SUMMARY_PARSER_WORKER=off|on|required` gate. Codex summary parsing is
still not routed through the worker.

Related: [`038-codex-session-index-memory.md`](038-codex-session-index-memory.md),
especially "Chunk 5: Summary Parser Worker Isolation".

Topic: codex-session-index-memory

## Problem Statement

Chunks 1 through 4 removed the known summary-index retention paths:

- Codex summary reads now stream rollout JSONL and do not populate the full
  transcript `entryCache`.
- Claude summary reads now stream into compact DAG nodes instead of retaining
  full raw `ClaudeSessionEntry[]` arrays.
- `SessionIndexService` now coalesces cache misses and runs summary parses
  through a global queue, with default concurrency 1 and warmup/status
  reporting.

The remaining measured risk is not many retained transcript arrays. It is a
single active summary parse temporarily allocating very large `JSON.parse()`
inputs and parsed objects inside the main app-server process. Chunk 4 measured:

- Claude: 3277 summary streams, about 2.71 GB total, largest file 61.6 MB,
  largest JSONL line 60.0 MB, slowest single parse 7.45 seconds.
- Codex: 1147 summary streams, about 4.54 GB total, largest file 173.3 MB,
  largest JSONL line 32.2 MB.
- Process-tree RSS still peaked around 1.80 GB even with summary parse
  concurrency 1.

This still has two user-visible failure modes:

- Giant single-line `JSON.parse()` work can block the server event loop long
  enough to make maintenance, API, and reconnect paths feel wedged.
- V8 may retain expanded heap in the app-server process after the cold fill,
  even when the parsed summary data is no longer retained by YA code.

The next mitigation should isolate the summary parse heap and failure domain
from the main app server.

## Why A Child Process

Use `child_process.fork()` over `worker_threads` for the parser boundary.

Worker threads are lighter, but they still live in the same OS process and
share the process lifetime, RSS, native allocator pressure, and catastrophic
process-OOM failure domain. They can reduce event-loop blocking, but they are
not the strongest answer to "release all heap touched by this pathological
parse" or "survive an out-of-memory parser."

A forked Node child gives the property this stream now needs:

- the child owns the transient JSON strings, parsed objects, and parser-side
  V8 heap;
- exiting the child releases that heap to the OS independently of the app
  server's V8 heap behavior;
- a parser crash or OOM can be contained to one summary job instead of taking
  down the app server;
- Node IPC gives structured messages without shell quoting or a new runtime
  dependency.

The trade-off is lifecycle and packaging complexity. That complexity should stay
behind a narrow parser adapter, not spread into provider readers or route code.

## Scope

In scope:

- Summary parsing only.
- Start with Claude and Codex, because both now have streaming summary-only
  parsers and both showed giant individual JSONL lines in the chunk-4 harness.
- Keep `SessionIndexService` as the owner of queueing, request coalescing,
  cache writes, warmup progress, recent job history, and
  `/api/session-index/status`.
- Keep existing API behavior and complete-list semantics for `/api/inbox` and
  session-list routes.
- Return `SessionSummary | null` and parser metrics from the child.
- Roll the worker path out behind an env/config gate. The initial default stays
  main-process parsing until the worker harness and real cold-history runs prove
  the path reliable enough to promote.
- Keep a deliberate in-process fallback path for rollout safety. The fallback
  must be observable in logs/metrics so a broken worker does not silently hide
  behind old behavior.

Out of scope:

- Detail transcript loading, subagent reads, agent-mapping scans, and
  `getSession()` behavior.
- Replacing the `SessionIndexService` queue, cache, warmup status endpoint, or
  complete-list contract.
- Changing provider-visible session IDs. YA URL session IDs remain canonical;
  provider-native IDs must not replace them in URLs, metadata, REST/WebSocket
  payloads, or UI copy.
- A parallel parser pool. Keep one parser child and one active parse by default
  unless measurements later show that a pool is worth the added memory and
  scheduling complexity.
- Treating fallback as a memory mitigation. Fallback preserves availability
  while the worker path is gated; it does not isolate heap for the fallback
  parse.

## Proposed Design

### Parent Ownership

The main server keeps the existing scheduling shape:

1. `SessionIndexService` discovers cache misses, starts or updates warmup jobs,
   and enqueues one summary parse task per cache miss.
2. The existing queue still coalesces identical
   `scopeKey::sessionId::mtime::size` parse work.
3. The queued task body calls a narrow `SummaryParserClient` adapter instead of
   directly calling `reader.getSessionSummary()` for supported providers.
4. The adapter sends one parse request to the child, waits for a response,
   returns `SessionSummary | null`, and reports metrics back to the existing
   warmup/status/log surfaces.

This keeps the child process stateless with respect to session-index policy.
The child parses one file and returns one result. It does not own caches,
warmup jobs, source discovery, route contracts, or retry policy.

### Rollout Gate And Fallback

Start with the worker disabled by default behind an environment/config setting.
A useful shape is:

- `off`: always use the existing in-process summary parser.
- `on`: prefer the child parser, but fall back to the in-process parser when
  the worker cannot be launched, cannot load its entrypoint, disconnects before
  accepting a job, or returns a protocol-level setup error.
- `required`: use the child parser and fail/skip the active summary if worker
  infrastructure fails. This is useful for harnesses and CI coverage that need
  to prove the worker path actually ran.

The fallback decision should be made in the parent adapter, before
`SessionIndexService` sees the result, so the existing queue/cache/status code
does not need separate fallback branches.

Do not automatically retry every child failure in-process. Retrying a child OOM,
timeout, or large-line crash in the main process reintroduces the exact memory
risk this change is meant to isolate. For the initial `on` mode:

- fallback is appropriate for worker launch, import, IPC setup, and early
  protocol failures;
- parser exceptions for ordinary malformed input should preserve existing
  `null` summary behavior;
- timeout, OOM-like exit, or crash during an active parse should default to
  `null`/empty-cache for that summary, with an explicit debug override if a
  maintainer wants to retry in-process for diagnosis.

Every fallback should emit a structured log event with provider, sessionId,
filePath, worker mode, fallback reason, and whether the fallback happened before
or after the child began parsing.

### Message Protocol

The parent sends one active request at a time by default.

Request fields:

- `requestId`: parent-generated ID used only for IPC correlation.
- `provider`: `claude` or `codex`.
- `filePath`: absolute path to the session JSONL or compressed Codex rollout.
- `sessionId`: YA-visible session ID for the summary being parsed.
- `projectId`: YA project ID to copy into the returned `SessionSummary`.
- `stats`: parent-observed size, mtime, and mtimeMs from the index validation
  pass.
- `sourceHints`: provider-specific read hints that are cheap to pass, such as
  Codex sessions directory, project path, compressed-file hint, source label
  inputs, or Claude config/project directory context.
- `contextWindowHints`: bounded model/provider context-window data needed to
  compute `ContextUsage` without consulting main-process reader state.
- `limits`: per-job timeout and recycle thresholds visible to the child for
  metric annotation. The parent remains the authority for enforcing timeout.

Response fields:

- `requestId`.
- `status`: `ok`, `empty`, or `error`.
- `summary`: `SessionSummary` for `ok`; `null` for `empty` and `error`.
- `metrics`: provider, sessionId, filePath, file size, mtime, line count,
  parsed entry count, malformed line count when available, deduped/skipped
  counts when available, max line length, parse duration, worker pid, worker
  generation, memory before/after inside the child, and recycle recommendation.
- `error`: sanitized error name/message for `error` responses.

No raw transcript entries, raw JSONL lines, full content blocks, or parsed
provider-entry arrays cross IPC in either direction.

### Child Parser Entrypoint

The worker entrypoint should be a small provider dispatcher:

- Claude path calls the existing `readClaudeSessionSummary()` pure summary
  parser, with an injected context-window resolver backed by the request's
  hints.
- Codex path should use an extracted pure summary parser equivalent to the
  current `CodexSessionReader.buildSessionSummaryFromStream()` path. Avoid
  constructing a full reader in the child if that pulls in discovery caches or
  unrelated provider state.
- The child should not import route code, `SessionIndexService`, app startup,
  WebSocket code, provider process supervisors, or maintenance server modules.
- The child may use provider schema/parsing helpers and logging-independent
  utilities.

The child should send metrics to the parent in the response. The parent should
emit structured logs through the configured app logger so file logging,
`LOG_PRETTY`, and production logging behavior remain consistent.

### Recycle Policy

Run one parser child with one active parse by default. Recycle the child:

- after a configurable parsed-byte budget;
- after a configurable file-count budget;
- after any job whose max line length crosses a large-line threshold;
- after a parse timeout;
- after a child crash, disconnect, protocol error, or OOM-like exit;
- during app-server shutdown.

Recommended initial posture:

- recycle after a giant-line job even when it succeeds, because that is the
  scenario most likely to leave inflated child heap;
- recycle before accepting the next job, not in the middle of a successful
  response path;
- keep an idle timeout so an app server with no active summary-index work does
  not keep a child process alive forever;
- expose recycle counts and last recycle reason in parser metrics/status.

The existing architecture mandate still applies: background work must have a
clear owner and teardown path. A child exists only because the global
summary-index queue has work, or because a short bounded idle timeout is keeping
it warm for the next queued parse.

## Dev And Production Packaging

The worker needs a resolver that works in both server modes:

- Development runs the server through `tsx --conditions source src/index.ts`.
  Try an explicit `child_process.fork()` of the TypeScript worker entrypoint
  with dev `execArgv` equivalent to `--conditions source --import tsx` as the
  first implementation strategy. Do not inherit parent `process.execArgv`
  blindly; verify the exact args in the first harness.
- If explicit `--import tsx` proves unreliable across package/cwd layouts, fall
  back to a tiny JavaScript bootstrap that exists only to load the TypeScript
  worker in dev and the built JavaScript worker in production.
- Production runs built JavaScript from `packages/server/dist/index.js`. The
  worker module must be emitted by `tsc`, included in the npm/bundle output, and
  resolved relative to the built server entrypoint.
- Prefer `child_process.fork(modulePath, args, { stdio: [..., "ipc"] })` with
  argument arrays. Do not spawn through a shell, and do not build command-line
  strings that require shell quoting.
- Keep `execArgv`, `env`, and `cwd` explicit enough that dev/prod behavior is
  reproducible. Do not leak provider-specific process env changes into the
  child unless the parser needs them.
- Cross-platform termination should be best-effort and bounded: request
  graceful exit, wait a short grace period, then force-kill. On Windows, signal
  names are not POSIX semantics; treat `kill()` as process termination and rely
  on timeouts rather than signal-specific behavior.

## Failure Handling

Parser failures must not crash the app server.

- A normal provider parse error should return `status: "empty"` or
  `status: "error"` with `summary: null`, matching the existing reader behavior
  where malformed or unreadable summaries are skipped and the index records an
  empty cached summary for that file.
- A child crash, disconnect, timeout, OOM-like exit, or protocol mismatch should
  fail only the active summary job. The parent should recycle the child and
  allow the session-index queue to continue.
- The adapter should resolve `null` for expected parser-process failures so
  `SessionIndexService` can preserve current skip/empty-summary behavior. It
  should reject only for parent-side bugs or invariants that should fail the
  warmup job loudly.
- Timeout must include process cleanup. The parent should not leave an orphaned
  parser child after returning `null` for the timed-out job.
- If the parent is shutting down, terminate the child before process exit and
  stop draining the summary queue.

Metric/log event shape should make parser isolation visible without replacing
existing stream metrics. Add a parent-emitted event such as
`summary_parser_worker_job`:

- provider, sessionId, projectId, filePath, fileSize, fileMtimeMs;
- status: `ok`, `empty`, `error`, `timeout`, `crash`, or `protocol_error`;
- durationMs, parseMs, queue wait when available;
- lineCount, parsedEntries, malformedLines, dedupedEntries,
  skippedDuplicateEntries, maxLineLength when available;
- workerPid, workerGeneration, workerStartedAt, recycleReason;
- child heap/RSS before/after and parent heap/RSS before/after;
- sanitized error name/message.

Continue emitting `claude_summary_stream` and `codex_summary_stream` fields, or
emit worker-scoped equivalents with field names close enough for the existing
cold-index harness to aggregate both before and after the change.

## Acceptance Criteria

- A cold `/api/inbox` over the real local Claude and Codex histories completes
  with complete lists and writes complete summary indexes.
- The main server remains responsive during a giant-line summary parse. At
  minimum, maintenance `/status` and `/api/session-index/status` should answer
  while the child is parsing.
- A synthetic giant-line fixture demonstrates that app-server heap/RSS does not
  remain inflated after the child is recycled.
- Parser crash, timeout, and malformed-input cases skip or empty-cache exactly
  one summary according to existing index behavior, then continue draining the
  queue.
- Existing `SessionIndexService` queue, warmup progress, recent jobs, status
  endpoint, cache behavior, and `/api/inbox` response contract are preserved.
- No raw transcript entries or large content arrays cross IPC.
- Dev and production launches both resolve the worker entrypoint without shell
  quoting or extra runtime dependencies.

## Implementation Chunks

1. Build a minimal child-process parser harness and message protocol.
   - Add the worker entrypoint resolver, IPC request/response types, parent
     lifecycle wrapper, timeout handling, and a standalone test/harness that can
     parse one Claude fixture and one Codex fixture without wiring production
     routes.
   - Start with explicit dev `execArgv` for `--conditions source --import tsx`,
     plus built-JS launch for production.
   - Include env/config gate handling and observable in-process fallback before
     touching `SessionIndexService`.
2. Wire Claude summary parsing through the child behind an env/config gate or a
   narrow adapter.
   - Keep main-process Claude parsing as the default until the gate is enabled,
     and as the observable fallback for worker setup failures.
   - Preserve `claude_summary_stream` fields or add equivalent worker-scoped
     fields.
3. Add Codex summary parser support.
   - Extract the streaming Codex summary parser into a reusable pure function if
     needed.
   - Preserve compressed rollout handling, metadata/source fields, provider
     inference, model/context usage, and duplicate-entry accounting.
4. Add recycle, timeout, crash, and OOM handling.
   - Enforce byte/file/large-line recycle budgets.
   - Add idle child teardown and app shutdown cleanup.
   - Surface recycle/crash/timeout counters in logs and
     `/api/session-index/status` if useful for the harness.
5. Add stress tests/harness coverage and update docs/status.
   - Include a synthetic giant-line fixture.
   - Re-run the cold `/api/inbox` harness over real histories.
   - Update `038-codex-session-index-memory.md` or this doc with measured
     before/after RSS, responsiveness, worker recycle counts, and any remaining
     follow-up.

## Implementation Chunk 1

Implemented locally on 2026-06-30:

- Added shared worker IPC protocol types for parse requests, parse responses,
  worker metrics, sanitized errors, modes, and parent events.
- Added a child worker entrypoint that sends a ready message over fork IPC,
  accepts one parse request at a time, dispatches to Claude or Codex summary
  parsing, and returns only `SessionSummary | null` plus metrics.
- Added a parent `SummaryParserClient` with:
  - modes `off`, `on`, and `required`;
  - explicit source-worker launch through
    `--conditions source --import tsx` only on Node >=20.6;
  - built-worker resolution for `packages/server/dist`;
  - launch timeout, per-job timeout, crash/disconnect handling, close cleanup,
    and observable in-process fallback for worker setup failures.
- Added focused tests for:
  - Node 20.6 source-worker guard behavior;
  - source worker parsing of one Claude fixture;
  - source worker parsing of one Codex fixture;
  - `on` mode fallback when worker launch is unsupported;
  - `required` mode failing instead of falling back;
  - explicit in-process parser execution for fallback.
- Verified a built-JS worker fork after `pnpm --filter @yep-anywhere/server
  build` with a one-off compiled-worker Claude fixture.

Validation:

```bash
pnpm --filter @yep-anywhere/server test -- \
  test/sessions/summary-parser-worker.test.ts
pnpm --filter @yep-anywhere/server build
```

Result:

- Focused summary-parser worker tests passed: 7 passed.
- Server build passed and emitted the worker entrypoint to `dist`.
- A one-off `node --input-type=module` harness forked the built worker and
  returned `status: "ok"` for a compiled-worker Claude fixture.

Not wired in this chunk:

- `SessionIndexService.enqueueSummaryParse()` still calls provider readers
  directly. Claude readers gained the worker gate in chunk 2.
- Codex support in the child uses the existing `CodexSessionReader` for the
  harness. Extracting the streaming Codex summary parser into a pure worker
  function remains chunk 3.
- Recycle budgets beyond timeout are not enforced yet. Large-line/file/byte
  recycle policy remains chunk 4.

## Implementation Chunk 2

Implemented locally on 2026-06-30:

- Added `CLAUDE_SUMMARY_PARSER_WORKER=off|on|required`, parsed into server
  config and documented in env settings / CLI help. The default remains `off`.
- Wired `ClaudeSessionReader.getSessionSummary()` to use `SummaryParserClient`
  when the gate is `on` or `required`. With the gate off, the existing
  in-process `readClaudeSessionSummary()` path runs directly.
- Kept the in-process path as the observable `on`-mode fallback for worker
  setup/import/IPC failures. `required` mode skips/fails the one summary rather
  than falling back.
- Passed the configured Claude worker mode through app reader construction,
  maintenance debug readers, and provider-resolution merged Claude readers, so
  session-index cache misses inherit the same startup gate through the existing
  reader API.
- Added parent-side `summary_parser_worker_result` logging and a bounded idle
  timeout for the child process, so enabling the gate does not keep a parser
  child alive indefinitely after summary work completes.
- Extended Claude summary parsing to return its existing stream metrics to the
  worker response: line count, parsed entries, malformed lines, compact node
  count, max line length, and parse duration.
- Added focused tests for reader-level worker routing, reader-level fallback,
  and config parsing/defaults.

Validation:

```bash
pnpm --filter @yep-anywhere/server test -- \
  test/sessions/summary-parser-worker.test.ts \
  test/sessions/reader.test.ts \
  test/config.test.ts
pnpm --filter @yep-anywhere/server build
```

Result:

- Focused worker/reader/config tests passed: 79 passed.
- Server build passed.
- A one-off `node --input-type=module` harness forked the built worker and
  returned `status: "ok"` with Claude line-count metrics.

Not implemented in this chunk:

- The gate is still default-off and has not been run against a real cold
  `/api/inbox` history.
- Codex summary parsing is still not routed through the worker.
- Large-line/file/byte recycle budgets remain a later chunk.
- The child currently relies on shared context-window heuristics rather than a
  full serialized `ModelInfoService` catalog. Because the worker path is
  default-off, this remains a measured rollout concern rather than a default
  behavior change.

## Open Design Questions

- When should the worker gate graduate from default-off to default-on for
  Claude/Codex summary-index work? The first implementation should stay
  default-off until a real cold-history run proves reliability and RSS benefit.
- Which initial recycle thresholds should be used? The measured large lines
  were 60.0 MB for Claude and 32.2 MB for Codex, so a threshold below those
  values should recycle on the known pathological cases.
- Should worker state remain only in structured logs for the Claude rollout, or
  should `/api/session-index/status` include current worker
  pid/generation/recycle counters before the cold-history harness?
- Should active-parse crash/timeout/OOM ever retry in-process behind an explicit
  debug override, or should the production adapter always skip/empty-cache that
  one summary?
