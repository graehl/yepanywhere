# Claude API Failures and Retries

> The Claude SDK auto-retries transient API failures internally (observed:
> `max_retries: 10`, exponential backoff, ~3.3 min for a 529 Overloaded
> episode). When that budget is exhausted it emits a terminal synthetic
> assistant message. On the live stream YA does **not** detect that terminal
> error (it transitions to idle); the error is only recognized later on the
> read/resume path. This doc records verified observations toward building a
> YA-side auto-retry.

See also:
- [`CLAUDE.md`](CLAUDE.md) — "Transcript Structure" documents the SDK's
  internal retry bookkeeping (`api_error` connector rows) and the
  resume-context-loss bug it can cause.
- [`provider-state-machine.md`](provider-state-machine.md) — process lifecycle.
- [`compact-and-handoff.md`](compact-and-handoff.md) /
  [`resume-compaction.md`](resume-compaction.md) — the resume-at-message-id
  prefix-resume mechanism a retry could reuse.

Topic: claude-api-failures-and-retries

## Context

Codex was reported (by the user, not verified here) to recover transient server
failures automatically at the harness/SDK level, keeping the turn alive. The
question was whether the Claude SDK does the same. The evidence below shows it
**does** retry transient failures internally — but after exhausting its budget
it surfaces a terminal error that YA currently does not handle live, so the turn
ends. All observations come from session
`84aae708-b140-483b-a324-9e0603b5028d` (a 529 on 2026-06-17, claude CLI
2.1.170 / `@anthropic-ai/claude-agent-sdk@0.3.170`) plus an aggregate scan of
local session jsonl, except where noted.

## Verified: the SDK's internal retry (Layer 1)

The Claude CLI/SDK retries transient failures itself and **streams progress
live** as `system` messages with `subtype: "api_retry"`. Each carries:

```jsonc
{ "type": "system", "subtype": "api_retry",
  "attempt": 10, "max_retries": 10, "retry_delay_ms": 37281.4,
  "error_status": 529, "error": "overloaded" }
```

For the observed 529: **10 attempts** (`attempt` 1→10, `max_retries: 10`, all
`error_status: 529` / `error: "overloaded"`), exponential backoff that doubles
then saturates a **~37s cap**, taking **~3.3 minutes** end to end (first
`api_retry` ≈ 15:18:39Z → terminal error 15:21:59.171Z = 199.8s):

| attempt | `retry_delay_ms` | wall gap to next |
|--:|--:|--:|
| 1 | 616 | 3.9s |
| 2 | 1086 | 3.8s |
| 3 | 2414 | 4.3s |
| 4 | 4775 | 7.4s |
| 5 | 8226 | 10.8s |
| 6 | 16888 | 19.1s |
| 7 | 36407 | 38.8s |
| 8 | 32097 | 35.2s |
| 9 | 33178 | 37.3s |
| 10 | 37281 | (gives up ~39s later) |

So a single overload episode pins the turn "thinking" for ~3 minutes before any
terminal error appears. The `retry_delay_ms` numeric code (`error_status`) **is**
present on these live `api_retry` messages.

A separate verified case in [`CLAUDE.md`](CLAUDE.md) (Cloudflare 502, session
`c5b32eda`) shows this layer **succeeding** after a transport error, recorded as
a `system` `api_error` connector row.

## Verified: the terminal failure signal

After the retry budget is spent, two messages stream:

```jsonc
// assistant (synthetic) — NOTE: no isApiErrorMessage / apiErrorStatus on the stream
{ "type": "assistant", "error": "server_error",
  "request_id": "req_011Cc94BqVu5Q84wZ8AscCVc",
  "message": { "model": "<synthetic>", "stop_reason": "stop_sequence",
    "usage": { /* zeros */ },
    "content": [{ "type": "text",
      "text": "API Error: 529 Overloaded. … try again in a moment. …" }] } }
// immediately followed by:
{ "type": "result", "subtype": "success", "is_error": true }
```

Verified live markers (from `sdk-raw.jsonl`, logged pre-`convertMessage`):
- terminal `assistant`: top-level `error: "server_error"`, `request_id`,
  `message.model: "<synthetic>"`, the text. **No `isApiErrorMessage`, no
  `apiErrorStatus`.**
- terminal `result`: `is_error: true` (note `subtype: "success"` is present and
  therefore not a reliable error discriminator).

## Verified: structured fields live only in the persisted transcript

The same 529 as written by the CLI to
`~/.claude/projects/<proj>/<id>.jsonl` (line 558) **does** carry the structured
fields:

```jsonc
{
  "type": "assistant",
  "isApiErrorMessage": true,   // only in the persisted jsonl, not the stream
  "apiErrorStatus": 529,       // only in the persisted jsonl, not the stream
  "error": "server_error",
  "requestId": "req_011Cc94BqVu5Q84wZ8AscCVc",
  "message": { "model": "<synthetic>", "stop_reason": "stop_sequence",
    "content": [{ "type": "text", "text": "API Error: 529 Overloaded. …" }] }
}
```

These fields originate in the CLI binary that writes the transcript, not from
YA and not from the streamed object. Verified three ways:
- `sdk-raw.jsonl` (the raw streamed message) lacks both fields.
- No code in `packages/server/src` or `packages/shared/src` assigns them (grep:
  only reads/comparisons). `claude.ts wrapIterator` logs the raw message, then
  `convertMessage` only normalizes content blocks — it adds no fields.
- `@anthropic-ai/claude-agent-sdk@0.3.170` does not contain those identifiers in
  its shipped files.
- One older transcript entry (2026-02-10) had `apiErrorStatus` absent entirely,
  with the code present only in the message text (`API Error: 500 {…}`).

## Verified: observed error codes (aggregate local scan, 2026-06-17)

From all session jsonl under `~/.claude/projects/`:

| `apiErrorStatus` | `error` | seen | message text |
|---|---|---|---|
| **500** | `server_error` | 6 | "Internal server error. … usually temporary — try again in a moment." |
| **529** | `server_error` | 1 | "Overloaded. … usually temporary — try again in a moment." |
| **429** | `rate_limit` | 4 | "Usage credits required for 1M context · turn on usage credits…" |
| **401** | `authentication_failed` | 2 | "Failed to authenticate. API Error: 401 Invalid authentication credentials" |
| **404** | `model_not_found` | 1 | "There's an issue with the selected model (claude-fable-5). It may not exist or you may not have access to it." |
| *(absent)* | `unknown` | 1 | "API Error: 500 {\"type\":\"error\",\"error\":{\"type\":\"api_error\"…}}" |

This is only what was observed on this machine; it is not an exhaustive list of
what Anthropic can return.

Two observations grounded in the text above:
- `server_error` (500, 529) self-describes as transient ("usually temporary —
  try again in a moment").
- The observed `rate_limit` (429) is a **billing** condition ("usage credits
  required"), not a backoff signal — re-issuing it would loop. `error` (semantic
  string) is therefore a better discriminator than the numeric code, and it is
  present in both the live stream and the persisted form.
- `authentication_failed` (401) and `model_not_found` (404) require user action.

## Verified: current YA handling

- **Schema** — `packages/shared/src/claude-sdk-schema/entry/AssistantEntrySchema.ts`
  declares `isApiErrorMessage` (optional bool). `apiErrorStatus` is **not** in
  the schema; it is read as an untyped field.
- **Live path** — `packages/server/src/supervisor/Process.ts`:
  - The only live error-termination hook is `isClaudeSdkApiErrorMessage()`
    (L184), which requires `message.isApiErrorMessage === true`; on match (L2676)
    it `abortFn()` + `markTerminated("Claude SDK API error; restart required")`.
  - **For the observed 529 this hook did not fire**: the live terminal message
    lacks `isApiErrorMessage`, so the predicate is false. The trailing `result`
    message then runs `transitionToIdle()` (L2724); the `result` handler does
    **not** inspect `is_error`. Net live behavior: the session goes **idle**, not
    terminated, and no API error is surfaced to YA's state machine.
  - (The L2676 termination path is real and unit-tested in `process.test.ts`,
    but the tests feed a message that already has `isApiErrorMessage: true`.)
- **Read/resume path** — `packages/server/src/routes/sessions.ts`
  `getClaudeResumeApiErrorBlocker()` (L143) reads the persisted jsonl (where the
  fields exist), detects a trailing API-error assistant row, and returns a
  blocker carrying `apiErrorStatus` plus a **`resumeAtMessageId`** (uuid of the
  last good assistant message before the error tail, a prefix-resume point).
  Recovery is `"handoff-required"` (`CLAUDE_RESUME_API_ERROR_RECOVERY`) and
  user-triggered. This is the contract noted in [`CLAUDE.md`](CLAUDE.md): an
  SDK API-error row blocks normal resume.

So the structured 529/500 signal is acted on **only on the read/resume path**,
not live.

## Verified: retries are not rendered (and why)

The `api_retry` messages never reach the UI, for two stacked reasons:

- **Not persisted.** The CLI writes the terminal error row to the transcript
  jsonl (as the `isApiErrorMessage` assistant row) but does **not** write the
  `api_retry` rows. Session `84aae708`'s only persisted `system` rows are
  `stop_hook_summary`; zero `api_retry`. So they are live-stream-only and absent
  from any reload / catch-up / resume (all of which read the transcript).
- **Dropped by the client even live.** The server forwards everything
  (`shouldEmitMessage()` is hardcoded `true`, Process.ts:159), so the client
  does receive `api_retry` on the live stream. But `preprocessMessages`
  (`packages/client/src/lib/preprocessMessages.ts`) renders only an allowlist of
  `system` subtypes (`compact_boundary`, `turn_aborted`, `config_ack`,
  `away_summary`, `subagent_activity`); all others hit "Skip other system
  entries … they're internal" (~L300) and are discarded. `api_retry` is in that
  dropped set.

The terminal error is visible only because it is an `assistant` message whose
text content is literally `"API Error: 529 Overloaded…"` — ordinary assistant
text. The client does not reference `isApiErrorMessage` in rendering, so there
is no error-styled card to attach retry context to.

### Scope decision (2026-06-17): not surfacing retries yet

Reliably showing retry info (a live "retrying…" indicator, or a "failed after N
retries over T" summary on the terminal error) cannot be done from the
transcript alone, because `api_retry` is ephemeral and the CLI-written transcript
cannot be amended. Doing it durably would require YA to **persist its own SDK
session enrichment sidecar to disk** and merge it at render time.

**Decision: we are not doing that yet.** The cost (a parallel persistence layer
mirroring/augmenting CLI transcripts) is not worth it for retry visibility alone.
Revisit if/when there is a broader need for YA-owned transcript enrichment, or
alongside the auto-retry mechanic (which would already be accumulating the
per-turn `api_retry` stats server-side).

## Observed recovery for this session

After the terminal error at 15:21:59Z the session produced no further activity
for ~20 minutes. At 15:41:15Z a new user message was enqueued and the session
then ran normal turns again (real model `claude-opus-4-8`, not `<synthetic>`) —
i.e. it recovered once the overload cleared, via a manual re-send.

## Implications for an auto-retry mechanic (design notes, not yet built)

Grounded in the verified observations above:

1. The SDK already does fine-grained first-tier retry (10 attempts, ~3 min). A
   YA mechanic is about recovering *after* that budget is exhausted, for outages
   that outlast it.
2. Live detection cannot use `isApiErrorMessage`/`apiErrorStatus` — they are
   absent on the live terminal message. The live signals available are the
   `result.is_error: true` flag, the synthetic assistant's top-level `error`
   field, and the preceding `system`/`api_retry` telemetry (`error_status`,
   `attempt`, `max_retries`). Today YA reads none of these as an error live.
3. Classification should key on the semantic `error` value: retry `server_error`
   (500/529); do not retry `authentication_failed` (401), `model_not_found`
   (404), or the billing `rate_limit` (429).
4. A retry could reuse the existing `resumeAtMessageId` prefix-resume point so it
   re-issues from the last good assistant message rather than replaying tool
   side effects, and fall through to the existing `handoff-required` recovery
   when its own budget is exhausted.

## Not yet observed / unknown

- Whether other status codes (e.g. 503, timeouts) appear, and what their
  `error` / `error_status` look like. Only `server_error` (500/529),
  `rate_limit` (429), `authentication_failed` (401), and `model_not_found` (404)
  have been seen.
- Whether `isApiErrorMessage` presence on the **live** stream varies by SDK
  version (it was absent for 2.1.170 / sdk 0.3.170; the L2676 hook and its tests
  imply some path expects it).
- Codex's actual retry mechanism — reported anecdotally, not inspected here.
