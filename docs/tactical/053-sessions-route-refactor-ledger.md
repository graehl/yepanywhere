# Sessions Route Refactor Ledger

Status: Active running list for small, reviewable refactors in
`packages/server/src/routes/sessions.ts`.

## Purpose

`sessions.ts` is one of the largest maintained source files in the repo. It is
also load-bearing: it bridges persisted provider transcripts, live Supervisor
processes, metadata, notifications, recovered queues, restart/fork workflows,
and client-facing REST responses.

This ledger tracks simple refactors that can reduce file size or duplication
without changing the session API contract. Each item should be explicitly
accepted, deferred, or dropped before implementation.

## Guardrails

- Prefer behavior-preserving extraction over redesign.
- Keep each implementation small enough to review in one pass.
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

Status: proposed.

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
