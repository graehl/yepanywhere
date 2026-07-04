# Workstreams

Topic: workstreams

Status: First two preparatory chunks landed. Workstreams remain hidden/no-op by
default; no metadata service, scheduler change, Git worktree creation, or
landing action has landed yet.

Product rationale and the target user workflow live in
[`topics/workstreams.md`](../../topics/workstreams.md). This tactical document
tracks the implementation sequence for getting there without disturbing the
current Project Queue default behavior.

## Goal

Add an experimental, default-off workstreams mode where Project Queue can target
separate topic lanes under one YA project. A lane may be the canonical main
checkout or a branch-backed Git worktree. Workstreams should let prepared,
known-independent topics make progress without one active main/project session
blocking every queued item.

The first implementation slices should make the model visible and testable
before they mutate Git or change Project Queue scheduling.

## Non-Negotiables

- Workstreams are hidden/no-op by default.
- Existing Project Queue behavior is unchanged unless the experimental gate is
  explicitly enabled.
- The first useful slices do not run `git worktree add`, setup scripts, rebase,
  merge, cleanup, or landing operations.
- Queue items must not be popped before start preflights pass.
- YA URL session ids remain the public/session-facing ids. Provider-native ids
  must not replace them in URLs, metadata, API payloads, or UI copy.
- Main checkout branch switching is never part of workstream execution. If a
  branch-backed lane is needed, create or import a separate worktree.
- PR creation is optional export, not the required local workflow.

## Relevant Context

- [`topics/workstreams.md`](../../topics/workstreams.md) - product model,
  metadata sketch, queue semantics, Workstreams page, and landing constraints.
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
- [ ] WS-003: Add shared workstream types and server metadata service.
- [ ] WS-004: Add read-only workstream API behind the gate.
- [ ] WS-005: Add hidden Workstreams page shell.
- [ ] WS-006: Associate sessions with workstreams.
- [ ] WS-007: Add Project Queue target metadata without scheduler changes.
- [ ] WS-008: Make Project Queue scheduling workstream-aware.
- [ ] WS-009: Add YA-managed branch+worktree creation.
- [ ] WS-010: Add local landing actions.

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

Status: proposed.

Goal: add durable identity for workstreams without touching Project Queue
scheduling.

Likely shared shape:

```ts
interface Workstream {
  id: string;
  projectId: string;
  label: string;
  kind: "main" | "worktree";
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

- no Git worktree creation;
- no queue targeting;
- no scheduler changes;
- no client UI beyond tests or API scaffolding.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/services/workstreams.test.ts
node scripts/biome.cjs lint packages/server/src/services packages/shared/src
```

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

- no worktree creation UI;
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
- UI can show compact identity such as `yepanywhere / xr blink / ya/xr-blink`.

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

### WS-007: Add Project Queue Target Metadata

Status: proposed.

Goal: allow a Project Queue item to remember a target workstream without using
that field for scheduling yet.

Likely change:

- Add optional `targetWorkstreamId` to shared Project Queue item summaries and
  persisted items.
- Keep it absent for all existing behavior.
- Validate that the workstream belongs to the same canonical project when the
  experimental gate is on.
- Show target workstream metadata only on experimental surfaces.

Out of scope:

- no scheduler behavior changes;
- no target selector in the normal composer unless the experimental UI is
  enabled;
- no migration needed for existing queue files.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/project-queue.test.ts
pnpm --filter @yep-anywhere/client test -- src/hooks/__tests__/useProjectQueues.test.ts
```

### WS-008: Make Project Queue Scheduling Workstream-Aware

Status: deferred until WS-001 through WS-007 land.

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
- Keep global dispatch pause semantics.
- Add a per-project optional concurrency cap only after single-workstream
  semantics are correct.

Out of scope:

- no Git worktree creation;
- no landing;
- no auto-resolving conflicts.

Suggested verification:

```bash
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/server exec tsc --noEmit
pnpm --filter @yep-anywhere/server test -- test/routes/project-queue.test.ts
pnpm --filter @yep-anywhere/server test -- test/services/project-queue-scheduler.test.ts
```

### WS-009: Add YA-Managed Branch+Worktree Creation

Status: deferred.

Goal: let YA create a branch-backed lane under the canonical project.

Likely behavior:

- create branch+worktree from the selected base branch;
- copy `.worktreeinclude` ignored files if present;
- store metadata only after creation succeeds;
- do not run setup scripts in the first creation slice;
- do not symlink directories by default.

Preconditions:

- experimental gate enabled;
- canonical project is a Git repository;
- branch name is available;
- worktree destination is available;
- no concurrent YA git operation for the same canonical project.

Out of scope:

- no setup/cleanup scripts;
- no local landing;
- no automatic import of arbitrary external worktrees.

### WS-010: Add Local Landing Actions

Status: deferred.

Goal: provide guarded local integration back to the canonical main checkout.

Required reading before implementation:

- `topics/workstreams.md`, especially "Landing Back To Main";
- `docs/tactical/029-source-control-basic-actions.md`.

Likely first landing action:

- require no active provider turn in the workstream;
- require workstream checkout clean;
- require main checkout clean and not in an active main turn;
- require no Git sequencer state in either checkout;
- rebase workstream branch onto main;
- fast-forward main from the workstream branch;
- sync/reset workstream branch to the new main head if the lane continues;
- keep queue paused if any step fails.

Out of scope:

- no auto-land by default;
- no hidden merge commits;
- no semantic conflict inference.

## Open Decisions

- Gate shape: version capability only when enabled, or capability always
  present with settings reporting disabled?
- First branch naming pattern: `ya/<slug>`, `ya/<date>-<slug>`, or
  user-configurable from the first creation slice?
- Should manual import of existing worktrees land before YA-managed creation?
- Should the first Workstreams page live under Projects, Settings, or both?
- Should the first landing mode be fast-forward only, squash only, or both?
- Should workstream queue pause be global state in `WorkstreamService`, or live
  inside Project Queue dispatch state once scheduling is lane-aware?
