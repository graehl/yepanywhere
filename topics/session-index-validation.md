# Session Index Validation

> How the session index decides a cached summary is still fresh, why
> shared-container providers (OpenCode's `opencode.db`) must not be
> stat-validated, and why WS-tunneled requests must not queue behind a slow
> validation.

Topic: session-index-validation

See also:

- [`opencode-backend.md`](opencode-backend.md) — the OpenCode reader whose DB
  anchor motivated the shared-file rules here.
- [`sidebar-session-ordering.md`](sidebar-session-ordering.md) — the main
  consumer of `/api/sessions` freshness.

## Validation paths

`SessionIndexService` keeps one persisted index per (provider, project) scope
(`{dataDir}/indexes/*.json`) and revalidates it two ways:

- **Incremental** (watcher-driven): dirty sessions go through the reader's
  `getSessionSummaryIfChanged(sessionId, projectId, cachedMtime, cachedSize)`.
- **Full validation**: on first request per scope and whenever the last full
  validation is older than `SESSION_INDEX_FULL_VALIDATION_MS` (default 30s).
  Every enumerated session is checked; this is what a fresh browser window
  pays after the server has been idle.

## The freshness contract

- **Per-file sessions** (Claude/Codex/pi jsonl, Gemini json, OpenCode
  file-tree json): the entry's `filePath` is exclusive to the session, so
  full validation compares `stat(filePath)` mtime/size against the cached
  `fileMtime`/`indexedBytes`. Cheap and exact.
- **Shared-container sessions** mark their enumeration entries
  `sharedFilePath: true` (`ISessionReader.listSessionFiles`). The container's
  stat says nothing about one session — its mtime moves on any write, and the
  cached keys are *row-derived*, so a stat compare can never match. Full
  validation must instead call `getSessionSummaryIfChanged`, whose units the
  reader owns end to end (OpenCode: session row `time_updated` + message
  count). Unchanged rows count as cache hits; changed rows re-summarize
  through the same cheap row read, never the heavy parse queue.
- **Reader `IfChanged` contract**: "unchanged" must be terminal. The OpenCode
  chain (DB row → file tree → CLI) previously returned the same `null` for
  "row unchanged" and "not in DB", so an unchanged DB session fell through to
  a per-session `opencode export` spawn on every validation.
- **Legacy CLI sessions** (pre-1.16 projects with no DB row) are probed from
  one shared `opencode session list` spawn (module-level cache,
  `OPENCODE_CLI_LIST_CACHE_TTL_MS`), whose output is global — verified not
  cwd-scoped — so N legacy projects no longer pay N spawns per burst, and
  per-session `export` spawns are out of the validation path entirely.

Violating any of these re-derives every affected summary once per full
validation. Measured on the primary dev machine (2026-07-03, ~40 OpenCode
sessions across 6 scopes): first `/api/sessions` after 30s idle cost 8.2s
before, 2.2s after (remaining cost ≈ one 1.1s CLI list spawn plus serialized
scope walks); calls inside the TTL are ~10ms either way.

## Cold scans

A brand-new data dir still parses every session once (31s measured for the
full dev-machine corpus): summary parsing is serial by default
(`SESSION_INDEX_SUMMARY_PARSE_CONCURRENCY=1`, in-process worker mode off).
Raising the default is the obvious follow-up lever, but it needs its own
contrastive run — the concurrency=1 default protects the event loop while
parses run in-process.

## Transport head-of-line blocking

The WS transports (direct WS and relay) serialize inbound message handling
per connection (`ws-relay.ts` messageQueue) — required for SRP handshake
order, replay sequence checks, and upload chunk order. Tunneled HTTP
`request` messages are the exception: each is independent and self-answering
(`handleRequest` matches responses by id and never throws), so the router
dispatches them without awaiting. Otherwise a slow `/api/sessions`
revalidation blocks `/api/settings` and every other tunneled call behind it —
plain-HTTP clients never had that coupling, and hosted/relay clients showed
it as "settings waits for the sidebar to populate". Covered by
`ws-relay-request-concurrency.test.ts`.
