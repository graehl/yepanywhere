# Sessions Route Refactor Ledger

Status: Active running list for small, reviewable refactors in
`packages/server/src/routes/sessions.ts`.

See also: `topics/core-service-api.md` — the sessions REST surface this
ledger refactors is the surface that topic proposes exposing as an
embeddable core API, so ownership-boundary moves here shape that
extraction.

## Purpose

`sessions.ts` is one of the largest maintained source files in the repo. It is
also load-bearing: it bridges persisted provider transcripts, live Supervisor
processes, metadata, notifications, recovered queues, restart/fork workflows,
and client-facing REST responses.

This ledger tracks simple refactors that can reduce file size or duplication
without changing the session API contract. Each item should be explicitly
accepted, deferred, or dropped before implementation.

Line deltas below are rough `sessions.ts` deltas. New-file extractions usually
add a similar number of lines elsewhere; the goal is smaller ownership
boundaries, not necessarily fewer total repository lines.

## Guardrails

- Prefer behavior-preserving extraction over redesign.
- Keep each implementation small enough to review in one pass.
- Do not create generic "helpers" buckets. A new file should have a narrow
  domain name and ownership boundary, such as `session-metadata-patch.ts` or
  `session-compact-thresholds.ts`; otherwise prefer a same-file helper or
  defer the refactor.
- Treat line-count reduction as supporting evidence, not the reason to move
  code. A move is worthwhile only when it removes duplication, improves a
  route/test boundary, or isolates provider-specific behavior.
- Do not reshape `Process`, `Supervisor`, WebSocket streaming, replay buffers,
  or provider protocol behavior as part of this ledger.
- Run focused sessions-route tests and server typecheck for code changes.
- If an item touches background loops, session liveness, reconnect behavior, or
  server catch-up paths, first read `topics/architecture-mandates.md`.

## Status Values

- `done`: implemented and verified.
- `proposed`: ready for user decision.
- `accepted`: user chose it; ready to implement.
- `deferred`: keep the note but do not implement now.
- `dropped`: no longer worth tracking.

## Refactor Items

### SRR-001: Extract Request Parsing Helpers

Status: done.

Commit: `d7227af9` (`Extract session request helpers`).

Destination: new file
`packages/server/src/routes/session-request-helpers.ts`.

Line delta: about `-300` lines from `sessions.ts`, `+325` lines in the helper
file.

Moved pure request-boundary helpers from `sessions.ts` to
`packages/server/src/routes/session-request-helpers.ts`:

- executor parsing;
- optional service tier normalization;
- resume mode parsing;
- recap/prompt-suggestion/helper-side-model parsing;
- user-message metadata shaping.

Why it was safe:

- no `Hono`, `Supervisor`, reader, filesystem, or live process dependency;
- direct move of pure helpers plus imports;
- no route behavior changes.

Verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-request-helpers.ts
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts test/routes/sessions-clone-codex.test.ts
git diff --check
pnpm lint
```

### SRR-002: Deduplicate Provider-Resolution Dependencies

Status: done.

Destination: same file; all callers now use the existing top-level
`providerResolutionDeps(deps)` helper.

Line delta: `-65` lines from `sessions.ts`.

Problem:

`sessions.ts` has a `providerResolutionDeps(deps)` helper and also a local
`getProviderResolutionDeps()` closure with the same shape, while several
`findSessionSummaryAcrossProviders(...)` calls still build the object inline.
That duplication makes each provider-source addition easy to miss in one path.

Likely change:

- keep one helper for building `ProviderResolutionDeps`;
- replace inline object literals and the duplicate closure with that helper;
- keep provider lookup order and preferred-provider arguments unchanged.

Implemented:

- removed the duplicate `getProviderResolutionDeps()` closure inside
  `createSessionsRoutes`;
- replaced inline `ProviderResolutionDeps` literals with
  `providerResolutionDeps(deps)`;
- left every `project`, `projectId`, `sessionId`, and preferred-provider
  argument unchanged.

Value:

- reduces drift risk across Claude/Codex/Gemini/Grok/pi resolution paths;
- small line reduction;
- makes future provider changes less error-prone.

Risk:

- low, but every changed call site should be checked so the same `project`,
  `projectId`, `sessionId`, and preferred provider are still passed.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts test/routes/sessions-clone-codex.test.ts test/routes/recents.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts
```

### SRR-003: Extract Session Ownership Response Shaping

Status: deferred.

Destination: likely same file, as a small helper near
`providerResolutionDeps(deps)`. A new file is not warranted unless more
ownership-response code accumulates.

Estimated line delta: about `-12` to `-18` lines from `sessions.ts`.

Problem:

Multiple read routes repeat the same ownership decision: live YA process wins,
then external tracker, then persisted/no-owner fallback. Each response also
repeats `processId`, `permissionMode`, `modeVersion`, and
`recapAfterSeconds`.

Likely change:

- add a small helper such as `buildSessionOwnership(process, isExternal,
  fallback?)`;
- use it in metadata/detail routes first;
- avoid changing process lookup timing or response fields.

Value:

- removes duplicated response-shaping logic;
- lowers the chance that a future ownership field is added to one route but not
  the other.

Risk:

- low to medium. The helper must preserve the persisted fallback used by the
  detail route when no process/external owner exists.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts
```

### SRR-004: Extract Launch Option Normalization

Status: proposed.

Destination: same file unless the extracted piece is pure request-boundary
parsing, in which case `session-request-helpers.ts` may be appropriate. A
larger cohesive builder would deserve a domain-named
`session-launch-options.ts`; do not grow `session-request-helpers.ts` into a
general launch/process helper bucket.

Estimated line delta: about `-30` to `-60` lines for a narrow first slice,
depending on which axis is extracted. A broad all-in-one launch builder is not
recommended as the first pass.

Problem:

Start, create, detached start, detached create, resume, and reactivate repeat
similar launch-option setup: model/default handling, service tier, thinking,
executor, helper settings, provider, permissions, global instructions, and
recap/prompt-suggestion inheritance.

Likely change:

- extract narrow helpers for one repeated axis at a time, such as
  `normalizeRequestedModel(...)` or `buildThinkingOptions(...)`;
- avoid one large "launch options builder" until the smaller helpers prove
  useful.

Value:

- meaningful size reduction;
- fewer inconsistencies between start/resume/reactivate paths.

Risk:

- medium. These paths have subtle differences, especially metadata fallback and
  resume inheritance.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts
```

### SRR-005: Move Recovered Queue Helpers

Status: proposed.

Destination: new file
`packages/server/src/routes/session-recovered-queue.ts`.

Estimated line delta: about `-180` to `-230` lines from `sessions.ts`, with a
similar-size helper module added.

Problem:

Recovered patient-queue behavior is cohesive but takes a large block inside the
route file: listing paused entries, ensuring a process, resuming groups in
order, steering through a target, and preserving compose order against newer
live patient entries.

Likely change:

- move recovered-queue helper functions into a nearby module;
- keep the Hono route handlers in `sessions.ts`;
- pass explicit dependencies instead of importing global services.

Value:

- better isolation for restart-paused queue behavior;
- easier focused tests for recovered-queue edge cases later.

Risk:

- medium. The code touches live process reactivation and durable queue
  persistence, so it is less "pure extraction" than SRR-002 or SRR-003.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-recovered-queue.ts
```

### SRR-006: Move Claude Resume API-Error Guard

Status: proposed.

Destination: new file
`packages/server/src/routes/session-claude-resume-guard.ts`.

Estimated line delta: about `-95` to `-115` lines from `sessions.ts`, with a
similar-size helper module added.

Problem:

Claude-specific resume blocking/recovery logic lives near the top of the
generic sessions route file. It walks the Claude transcript DAG to detect an
SDK API-error tail and either blocks resume or resumes at the last good
assistant message.

Likely change:

- move `ClaudeResumeApiErrorBlocker`,
  `getClaudeResumeApiErrorBlocker(...)`, and
  `getClaudeResumeBlockerFromReader(...)` into a small helper module;
- keep the route's existing log messages and response shape unchanged;
- import only `getClaudeResumeBlockerFromReader(...)` in `sessions.ts`.

Value:

- isolates a provider-specific resume quirk from the generic route;
- keeps a subtle safety check easier to test and review;
- removes top-of-file noise before the route dependency/interface section.

Risk:

- low. The logic is already pure except for reading a session through
  `ISessionReader`.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-claude-resume-guard.ts
```

### SRR-007: Move Worker Queue Routes

Status: proposed.

Destination: new file
`packages/server/src/routes/worker-queue.ts` or
`packages/server/src/routes/supervisor-queue.ts`; `sessions.ts` would mount it
with `routes.route("/", createWorkerQueueRoutes(deps.supervisor))`.

Estimated line delta: about `-35` to `-45` lines from `sessions.ts`, with a
small new route module added.

Problem:

`/status/workers` and `/queue` endpoints are Supervisor/worker-pool admin
routes, not session-detail routes. They currently live at the end of
`sessions.ts`.

Likely change:

- extract the four worker queue route registrations;
- pass only `deps.supervisor` to the new route factory;
- preserve the current public paths.

Value:

- removes unrelated admin endpoints from the sessions route;
- clarifies that these endpoints are process/queue status, not per-session
  transcript behavior.

Risk:

- low to medium. The implementation is tiny, but route mounting must preserve
  exact paths.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/worker-queue.ts
```

### SRR-008: Move Compact Threshold Lookup Helpers

Status: proposed.

Destination: new file
`packages/server/src/routes/session-compact-thresholds.ts`.

Estimated line delta: about `-40` to `-55` lines from `sessions.ts`, with a
small helper module added. Tests would import from the new helper, or
`sessions.ts` could temporarily re-export for compatibility.

Problem:

`resolveCompactPercent(...)` and `resolveCompactWindow(...)` are exported from
the large route file only so focused tests can cover threshold behavior. They
are pure compact-threshold helpers, not route handlers.

Likely change:

- move those two helpers and their comments to a compact-threshold module;
- update `sessions.ts` and the two focused tests to import from that module.

Value:

- removes exported utility code from the route surface;
- makes the threshold behavior easier to test without importing the whole
  route module.

Risk:

- low. This is pure helper extraction, but tests/imports must be updated.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/resolveCompactPercent.test.ts test/routes/resolveCompactWindow.test.ts test/routes/sessions-metadata.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-compact-thresholds.ts
```

### SRR-009: Extract Session Metadata Patch Parsing

Status: proposed.

Destination: new file
`packages/server/src/routes/session-metadata-patch.ts`.

Estimated line delta: about `-90` to `-130` lines from `sessions.ts`, with a
similar-size parser module added.

Problem:

`PUT /sessions/:sessionId/metadata` spends much of its route body validating
and normalizing heartbeat, parent-session, prompt-suggestion, and recap fields.
That parsing is mostly pure request-boundary logic.

Likely change:

- add a `parseSessionMetadataPatch(body)` helper returning either a normalized
  metadata patch or an API error message/status;
- keep metadata service updates and event emission in `sessions.ts`;
- preserve every existing validation range and error string.

Value:

- leaves the route handler focused on read body -> update metadata -> emit
  event;
- makes validation rules easier to unit test later.

Risk:

- medium. The parser is pure, but the route has many small validation branches
  and error strings that need to stay identical.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build && pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts
node scripts/biome.cjs lint packages/server/src/routes/sessions.ts packages/server/src/routes/session-metadata-patch.ts
```
