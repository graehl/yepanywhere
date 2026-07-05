# Workstreams

Topic: workstreams

Status: First three preparatory chunks landed. Workstreams remain hidden/no-op
by default; no workstream API route, scheduler change, lane checkout creation,
or sync action has landed yet. The pending plan was re-cut after the topic
switched from branch-backed git worktrees to ordinary repo checkouts.

Product rationale and the target user workflow live in
[`topics/workstreams.md`](../../topics/workstreams.md). This tactical document
tracks the implementation sequence for getting there without disturbing the
current Project Queue default behavior.

## Goal

Add an experimental, default-off workstreams mode where Project Queue can target
separate topic lanes under one YA project. A lane may be the canonical main
checkout or a separate real checkout — an ordinary local clone, not a git
worktree (see `topics/workstreams.md` "Lane Checkouts and Branches").
Workstreams should let prepared, known-independent topics make progress
without one active main/project session blocking every queued item.

The first implementation slices should make the model visible and testable
before they mutate Git or change Project Queue scheduling. Later slices should
make real checkout lanes useful before adding deferred branch/local-landing
machinery.

## Non-Negotiables

- Workstreams are hidden/no-op by default.
- Existing Project Queue behavior is unchanged unless the experimental gate is
  explicitly enabled.
- The preparatory API/UI slices do not create lane checkouts or run setup
  scripts, rebase, merge, cleanup, sync, or landing operations.
- Queue items must not be popped before start preflights pass.
- YA URL session ids remain the public/session-facing ids. Provider-native ids
  must not replace them in URLs, metadata, API payloads, or UI copy.
- Main checkout branch switching is never part of workstream execution. If a
  branch-backed lane is needed, create or import a separate checkout.
- User-facing copy says workstream, lane, or checkout. Reserve "git worktree"
  for technical comparisons, `.worktreeinclude`, and import of external git
  worktrees.
- PR creation is optional export, not the required local workflow.

## Relevant Context

- [`topics/workstreams.md`](../../topics/workstreams.md) - product model,
  metadata sketch, queue semantics, Workstreams page, sync, and deferred
  landing constraints.
- [`topics/project-queue.md`](../../topics/project-queue.md) - current
  single-lane Project Queue semantics.
- [`docs/tactical/023-project-queue.md`](023-project-queue.md) - original
  Project Queue implementation ledger.
- [`topics/vanilla-defaults.md`](../../topics/vanilla-defaults.md) - YA-novel
  user-visible behavior must be configurable and default-off.
- [`topics/architecture-mandates.md`](../../topics/architecture-mandates.md) -
  read before changing scheduler loops, retry timers, session liveness, or
  catch-up paths.
- [`topics/hard-development-rules.md`](../../topics/hard-development-rules.md)
  - read before changing deployment-sensitive defaults or configuration
  precedence.

## Progress

- [x] WS-001: Extract Project Queue response assembly.
- [x] WS-002: Add default-off experimental workstreams gate.
- [x] WS-003: Add shared workstream types and server metadata service.
- [ ] WS-004: Add read-only workstream API behind the gate.
- [ ] WS-005: Add hidden Workstreams page shell.
- [ ] WS-006: Associate sessions with workstreams.
- [ ] WS-007: Add Project Queue target metadata and hidden target picker.
- [ ] WS-008: Add lane checkout lifecycle API.
- [ ] WS-009: Make Project Queue scheduling workstream-aware.
- [ ] WS-010: Add shared-upstream lane sync and repair turns.
- [ ] WS-011: Add optional `.workstream` readiness checks.
- [ ] WS-012: Defer branch mode and local landing plan.

## Chunk Details

### WS-001: Extract Project Queue Response Assembly

Status: done.

Implemented:

- Moved Project Queue response/enrichment helpers from
  `packages/server/src/routes/project-queue.ts` to
  `packages/server/src/routes/project-queue-response.ts`.
- Left `project-queue.ts` focused on Hono routes, request parsing, validation,
  mutation calls, and status codes.
- Kept API response shapes and scheduler behavior unchanged.

Goal: prepare the Project Queue route boundary for workstream display metadata
without changing behavior.

Likely change:

- Move response/enrichment helpers from
  `packages/server/src/routes/project-queue.ts` into a narrow module such as
  `packages/server/src/routes/project-queue-response.ts`.
- Keep `project-queue.ts` focused on Hono route mounting, request parsing,
  validation, status codes, and calling services.
- Move or expose these existing helpers through the new module:
  - recovered session-queue summary shaping;
  - target title enrichment;
  - global/project queue response assembly;
  - scheduler project-status response lookup.

Out of scope:

- no API response shape changes;
- no scheduler changes;
- no workstream fields;
- no route behavior changes.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/project-queue.test.ts
node scripts/biome.cjs lint packages/server/src/routes/project-queue.ts packages/server/src/routes/project-queue-response.ts
```

Verified 2026-07-04 with the commands above.

### WS-002: Add Default-Off Experimental Gate

Status: done.

Implemented:

- Added a persisted server setting named `workstreamsEnabled`, defaulting to
  `false`.
- Added a Development settings UI toggle for the server setting. This is a
  developer-only UI surface, not an env var or deployment default.
- Allowed `PUT /api/settings` to update the setting when the request body
  supplies a boolean.
- Added client/server setting types and focused tests for the default, route,
  and UI visibility.

Goal: introduce the feature flag/config surface before any user-visible or
scheduler-visible behavior exists.

Likely change:

- Add a server setting named `workstreamsEnabled`.
- Expose that setting through the existing dev-only Development settings UI.
- Do not add an env-var override.
- Keep the default false.
- When disabled:
  - no Workstreams page/link;
  - no Project Queue target selector;
  - no session workstream badges;
  - no workstream API fetches from the client;
  - no Git commands;
  - no scheduler behavior changes.

Open decision:

- Deferred to the first real API/UI chunk: whether `/api/version` should expose
  a `workstreams` capability, or whether the client should treat
  `workstreamsEnabled` as the sole early gate.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/client exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/services/ServerSettingsService.test.ts test/routes/settings.test.ts
pnpm --filter @yep-anywhere/client test -- src/pages/settings/__tests__/DevelopmentSettings.test.tsx
pnpm i18n:scan
node scripts/biome.cjs lint packages/server/src/services/ServerSettingsService.ts packages/server/src/routes/settings.ts packages/server/test/services/ServerSettingsService.test.ts packages/server/test/routes/settings.test.ts packages/client/src/api/client.ts packages/client/src/pages/settings/DevelopmentSettings.tsx packages/client/src/pages/settings/__tests__/DevelopmentSettings.test.tsx packages/client/src/i18n/en.json docs/tactical/054-workstreams.md
```

Verified 2026-07-04 with the commands above. `pnpm i18n:scan` reported three
pre-existing advisory raw-copy warnings in `packages/client/src/main.tsx`; no
new i18n warning was introduced by this chunk. Also ran `pnpm lint`.

### WS-003: Add Shared Types And Server Metadata Service

Status: done.

Implemented:

- Added shared workstream types, including `Workstream`, `StoredWorkstream`,
  `WorkstreamId`, `WorkstreamStatus`, `ProjectWorkstreamsResponse`, and the
  `workstreams-changed` event shape.
- Added `mainWorkstreamId(projectId)` so implicit main lanes have deterministic
  per-project identity instead of colliding as a plain `main` id.
- Added `WorkstreamService`, backed by `{dataDir}/workstreams.json`, for
  stored non-main workstreams.
- Synthesized the implicit `main` workstream at read time. The main lane is not
  persisted to disk.
- Added defensive load-time normalization, duplicate filtering, atomic temp-file
  saves, serialized mutations, and change events for future route/UI consumers.
- Exported the service from the server service barrel.

Goal: add durable identity for workstreams without touching Project Queue
scheduling.

Likely shared shape:

```ts
interface Workstream {
  id: string;
  projectId: string;
  label: string;
  kind: "main" | "checkout";
  path: string;
  branch: string | null;
  baseBranch: string;
  baseCommit: string | null;
  managedByYa: boolean;
  queuePaused: boolean;
  status: "active" | "archived" | "landed";
  createdAt: string;
  updatedAt: string;
}
```

Likely server change:

- Add `WorkstreamService` backed by `{dataDir}/workstreams.json`.
- Use atomic write semantics and serialized mutations matching nearby metadata
  services.
- Do not persist Git cleanliness, ahead/behind counts, changed files, or
  mergeability.
- Synthesize the implicit `main` workstream at read time rather than writing
  one record per project immediately.

Out of scope:

- no route mounting or app startup wiring;
- no Workstreams page;
- no Project Queue target metadata;
- no lane checkout creation;
- no queue targeting;
- no scheduler changes;
- no client UI beyond tests or API scaffolding;
- no Git commands.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/services/WorkstreamService.test.ts
node scripts/biome.cjs lint packages/shared/src/workstreams.ts packages/shared/src/index.ts packages/server/src/services/WorkstreamService.ts packages/server/src/services/index.ts packages/server/src/watcher/EventBus.ts packages/server/test/services/WorkstreamService.test.ts docs/tactical/054-workstreams.md
```

Verified 2026-07-04 with the commands above. Also ran `pnpm lint` and
`pnpm --filter @yep-anywhere/client exec tsc --noEmit`.

Amendment (2026-07-04, later): the stored `kind` literal shipped as
`"worktree"` and was renamed to `"checkout"` when the lane model dropped
git worktrees in favor of real checkouts (`topics/workstreams.md`, "Lane
Checkouts and Branches"). The service was still unmounted with no
persisted data, so no migration was needed.

### WS-004: Add Read-Only Workstream API Behind The Gate

Status: proposed.

Goal: expose enough data for a hidden Workstreams page to render lanes.

Likely routes:

```http
GET /api/projects/:projectId/workstreams
GET /api/workstreams
```

Early behavior:

- routes are gated;
- disabled response is explicit and client-hidden;
- response includes implicit main lane plus stored records;
- no create/delete/update mutation route yet unless a manual import flow is
  intentionally included.

Out of scope:

- no Git commands;
- no queue target selector;
- no scheduler changes.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/workstreams.test.ts
node scripts/biome.cjs lint packages/server/src/routes packages/shared/src
```

### WS-005: Add Hidden Workstreams Page Shell

Status: proposed.

Goal: create the experimental UI surface without changing default navigation.

Likely change:

- Add a route/page that renders only when workstreams are enabled.
- Show rows for `main` and any stored workstreams.
- Show lane label, path, branch, queuePaused, status, and linked session count
  placeholders as available.
- Use i18n keys for visible copy.

Out of scope:

- no lane checkout creation UI;
- no landing buttons;
- no scheduler state;
- no queue target picker.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/client exec tsc --noEmit
pnpm --filter @yep-anywhere/client test -- src/pages/__tests__/WorkstreamsPage.test.tsx
node scripts/biome.cjs lint packages/client/src/pages packages/client/src/i18n/en.json
pnpm i18n:scan
```

### WS-006: Associate Sessions With Workstreams

Status: proposed.

Goal: let sessions display their lane identity and let the Workstreams page
show associated sessions.

Likely change:

- Add optional `workstreamId` to YA session metadata.
- Existing sessions with no `workstreamId` resolve to the implicit `main`
  workstream.
- Session summaries/details may include a compact workstream display object
  when the experimental gate is on.
- UI can show compact identity such as `yepanywhere / xr blink / main`.

Out of scope:

- no automatic reassignment of historical sessions;
- no provider-native id changes;
- no queue scheduling changes.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/client exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/sessions-metadata.test.ts
```

### WS-007: Add Project Queue Target Metadata And Hidden Target Picker

Status: proposed.

Goal: allow a Project Queue item to remember a target workstream without using
that field for scheduling yet.

Likely change:

- Add optional `targetWorkstreamId` to shared Project Queue item summaries and
  persisted items.
- Keep it absent for all existing behavior.
- Validate that the workstream belongs to the same canonical project when the
  experimental gate is on.
- Add an experimental target picker on the hidden queue/workstream surfaces.
- Keep `new workstream` disabled or routed to an explanatory placeholder until
  checkout lifecycle support lands.
- Show target workstream metadata only on experimental surfaces.

Out of scope:

- no scheduler behavior changes;
- no checkout creation;
- no route that mutates workstream records unless it belongs to WS-008;
- no migration needed for existing queue files.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/project-queue.test.ts
pnpm --filter @yep-anywhere/client test -- src/hooks/__tests__/useProjectQueues.test.ts
```

### WS-008: Add Lane Checkout Lifecycle API

Status: proposed after WS-004 through WS-007 land.

Goal: let YA create or import ordinary repo checkouts for lanes without
changing scheduler behavior yet.

Likely routes:

```http
POST /api/projects/:projectId/workstreams
POST /api/projects/:projectId/workstreams/import
DELETE /api/projects/:projectId/workstreams/:workstreamId
PATCH /api/projects/:projectId/workstreams/:workstreamId
```

Likely creation behavior:

- create the lane checkout as an ordinary local clone on main;
- prefer a destination under `{dataDir}/checkouts/<project>/<lane-slug>`;
- keep the canonical project checkout unchanged;
- set the lane clone's origin to the project's shared upstream;
- rely on Git's local clone hardlinks when available, but treat object copying
  as a correctness-preserving fallback on filesystems that cannot hardlink;
- copy `.worktreeinclude` ignored files if present;
- store metadata only after clone and seed steps succeed;
- do not create a branch in the first version;
- do not run setup scripts or symlink directories by default.

Likely import behavior:

- allow explicit import of an existing checkout path that belongs to the same
  repository;
- default imported lanes to read-only/unmanaged until the user marks them
  managed;
- detect external git worktrees only as import candidates, not as YA-owned
  resources.

Preconditions:

- experimental gate enabled;
- canonical project is a Git repository;
- checkout destination is available;
- no concurrent YA git operation for the same canonical project.

Out of scope:

- no setup/cleanup scripts;
- no scheduler behavior changes;
- no local landing;
- no automatic import of arbitrary external checkouts or worktrees.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/workstreams.test.ts test/services/WorkstreamService.test.ts
node scripts/biome.cjs lint packages/server/src/routes packages/server/src/services packages/shared/src
```

### WS-009: Make Project Queue Scheduling Workstream-Aware

Status: deferred until WS-001 through WS-008 land.

Goal: change the idleness unit from whole project to target workstream when a
queued item has `targetWorkstreamId`.

Required reading before implementation:

- `topics/architecture-mandates.md`;
- `topics/project-queue.md`;
- `topics/workstreams.md`;
- `docs/project/server-message-routing.md` if the change touches process
  ownership, replay/catch-up, or server fan-out.

Likely change:

- Generalize `projectWorkIdle` from a project-id predicate to a scoped
  predicate that can evaluate only processes/sessions in one workstream.
- Keep the current whole-project predicate for items without
  `targetWorkstreamId`.
- Add one active provider turn per workstream.
- Add one claimed Project Queue item per workstream idle boundary.
- Start the provider session in the target lane checkout path.
- Require start preflights before claiming the queued item:
  - lane exists, is active, and is not paused;
  - no active provider turn in the target workstream;
  - no setup/cleanup/sync operation is running in that checkout;
  - no Git sequencer state in that checkout;
  - YA-managed lane checkouts have clean tracked files;
  - the main checkout keeps the clean-tracked-files gate opt-in.
- Leave a blocked item queued with a visible blocker instead of popping it.
- Keep global dispatch pause semantics.
- Add a per-project optional concurrency cap only after single-workstream
  semantics are correct.

Out of scope:

- no lane checkout creation beyond WS-008;
- no landing;
- no `.workstream` command checks;
- no auto-resolving conflicts.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/project-queue.test.ts
pnpm --filter @yep-anywhere/server test -- test/services/project-queue-scheduler.test.ts
```

### WS-010: Add Shared-Upstream Lane Sync And Repair Turns

Status: deferred.

Goal: keep ordinary checkout lanes current through the shared upstream without
introducing branch-mode local landing.

Required reading before implementation:

- `topics/architecture-mandates.md`;
- `topics/session-liveness.md`;
- `topics/synthetic-turn-injection.md`;
- `topics/injected-message-visibility.md`;
- `topics/workstreams.md`, especially "Landing Back To Main".

Likely behavior:

- At each lane's agent-idle boundary, fetch from the shared upstream.
- If the lane has no unlanded commits and can fast-forward, fast-forward it
  silently.
- Never move a checkout while an active provider turn is running there.
- If a lane cannot fast-forward, do not leave it in a rebase/merge/cherry-pick
  sequencer state.
- Detect or dry-run enough to name the facts, then inject a visible factual
  repair turn in the lane session:
  - upstream/base moved to a specific commit;
  - the lane has N unlanded commits;
  - catch-up needs rebase, merge, or another strategy;
  - known conflicted paths, if YA can determine them without mutating the
    checkout.
- Exempt the repair turn from the readiness rule it exists to repair, while
  still enforcing agent-idle, clean tree, and no-sequencer-state preflights.
- Keep the prompt factual rather than prescriptive; standing agent
  instructions govern whether the agent acts autonomously or asks the user.

Out of scope:

- no branch-mode local landing action;
- no automatic rebase that rewrites unlanded commit SHAs;
- no hidden prompt framing;
- no semantic conflict inference;
- no auto-resolving conflicts.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/services/project-queue-scheduler.test.ts
node scripts/biome.cjs lint packages/server/src/services packages/server/src/routes
```

### WS-011: Add Optional `.workstream` Readiness Checks

Status: deferred until the lane scheduler and sync behavior are stable.

Goal: let trusted repository content declare readiness gates beyond the built-in
clean/up-to-date facts.

Required reading before implementation:

- `topics/security.md`;
- `topics/workstreams.md`, especially "Queue Semantics";
- `topics/hard-development-rules.md` if any setting or trust precedence is
  added.

Likely behavior:

- Parse an optional project `.workstream` config from each lane's checkout.
- Support built-in gates such as up-to-date-with-base and mandatory command
  checks such as tests.
- Require an explicit trust step before executing repo-declared commands.
- Run checks in the lane checkout at clean, agent-idle boundaries.
- Own check logs and status rather than burying failures in provider output.
- Cache pass results by commit.
- Surface failed checks as visible lane blockers.
- Consider eager checks during user think time after a lane becomes clean and
  idle; cancel or invalidate runs if the checkout mutates.
- Keep failure repair-turn injection visible and configurable, because it would
  start provider work without a new user action.

Out of scope:

- no broad project-scoped settings system;
- no hidden check execution from untrusted repo content;
- no treating untracked files as dirty for the built-in clean gate.

### WS-012: Defer Branch Mode And Local Landing Plan

Status: not in the first ordinary-checkout version.

Goal: preserve the branch/local-landing design as a later option without letting
it shape the checkout-lane MVP.

Trigger conditions:

- users need isolation from upstream churn that plain main checkouts cannot
  provide;
- users want a reviewable local landing step before shared-upstream push;
- ordinary-checkout sync creates repeated repair-turn noise that branch mode
  would materially reduce.

Deferred branch-mode constraints:

- create/import a separate checkout; never switch the user's canonical main
  checkout to a feature branch;
- use YA-named branches as plumbing/visibility, not as user-chosen feature
  branches;
- no implied PR, no implied push, and no auto-land by default;
- require explicit project/user AGENTS notice and visible UI whenever YA runs a
  lane on a branch in an all-in-main project;
- re-cut a dedicated tactical plan before implementing branch-mode landing.

## Open Decisions

- Gate shape: version capability only when enabled, or capability always
  present with settings reporting disabled?
- Lane checkout destination: always under `{dataDir}/checkouts`, configurable
  root, or same-volume-near-project when possible for cheaper local clones?
- Should manual import of existing checkouts land before YA-managed creation,
  or as part of the same lifecycle API?
- Should the first Workstreams page live under Projects, Settings, or both?
- Should workstream queue pause be global state in `WorkstreamService`, or live
  inside Project Queue dispatch state once scheduling is lane-aware?
- Should the first scheduler cap allow unlimited active lanes, one non-main
  lane, or a small configurable cap?
- `.workstream` format and trust model: file name, syntax, approval granularity,
  pass-result cache key, and whether failed checks inject repair turns
  automatically.
- Deferred branch mode: branch naming pattern, branch upstream, and whether the
  first local landing mode is fast-forward only, squash only, or both.
