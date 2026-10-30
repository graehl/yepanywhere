# HTTP API v0: local core, direct peers and isolated tests

Status: first local read slice implemented, 2026-10-30; later stages proposed.
The maintainer authorized implementation and a Sol 6.1 high review through YA.
The owning [v0 contract](../../topics/http-api-v0.md#implemented-local-read-contract)
records delivered behavior. No peer-authentication protocol is introduced.
Release priority remains unchanged.

The next proposed slice is [agent bootstrap and served API documentation](166-agent-api-bootstrap-and-documentation.md).
It adds useful documentation and Unix-socket access to the existing reads
before creation/provenance or peer routing. Its revised access profile
supersedes the earlier own-session-only bootstrap sketch.

## Local read delivery

The implementation contains a transport-independent CoreApi and explicit data
sources, thin Hono routes, generated OpenAPI discovery, and a public SQLite-backed
profile identity. Production adapters reuse retained catalogs and existing
metadata/runtime owners. Core fixtures construct no scanner, provider runtime,
HTTP listener or profile directory. Full-app auth tests cover operator/limited
boundaries, and one actual loopback TCP request checks the adapter boundary.

Focused coverage includes pre-pagination grants, creator and hidden-project
rules, ambiguous session ids, unknown targets, incomplete catalogs, two isolated
instances, response schema consistency, and persisted/corrupt identity behavior.
Existing auth-boundary coverage now enumerates v0 routes as well. Provider
descriptors are delivered; model discovery and full message history are deferred.
Sol 6.1 high review through YA found a native-id ambiguity leak hidden by
session-wide project metadata, a lexical timestamp ordering error, and an
operation-specific query schema mismatch. Production-adapter and chronological
pagination regressions reproduced both behavioral defects before repair. The
adapter now rejects native cross-project ambiguity before metadata projection;
core ordering parses timestamps; query schemas distinguish pagination from the
session-only project filter. The reviewer changed no files.

The same Sol session rechecked all three repairs and reported no remaining
blockers. Final workspace lint, formatting, typecheck and unit tests pass;
focused core/auth/storage coverage passes 15 cases. New core tests additionally
pass a targeted strict TypeScript check. The full workspace run passes 6,565
server and 7,017 client tests, plus shared/relay/push-broker suites. It still
prints unowned jsdom navigation diagnostics, recorded in
[the adjacent gap](../../gaps/client-unit-navigation-diagnostics.md), while the
focused v0 run emits none. Local validation is macOS/Node; Linux, Windows and
Bun execution remain CI qualification. The SRP-bound principal case is an
internal authenticated-transport fixture, not a fresh crypto handshake.

No new service lifetime is introduced, so no Supervisor lifecycle rewrite was
needed. Native creation/provenance and direct-peer access remain the next stages.

## Existing work to reuse

- [Core service API](../../topics/core-service-api.md): useful extraction
  background, but its Python client, standalone host and public core-package
  staging are not prerequisites for this HTTP-first work.
- [Cross-host delegation](../../topics/cross-host-delegation.md) and
  [plan 144](144-relay-peer-session-coordination.md): directed grants,
  target ownership and recovery remain useful. The custom worker/delegation
  lifecycle is superseded as the entry point for this direction.
- [Restart compaction extraction](163-http-independent-restart-compaction.md):
  a landed example of testing a narrow operation without importing its route.
- [T3 provider comparison](../competitive/t3code-provider-architecture.md):
  current live-owner input admission is a separate core refactor consumer.
  Reuse its authoritative input boundary as it becomes available; do not
  duplicate patient/queue policy or resume the archived assembly in
  `tasks/session-core-workstream/`.
- [Unconfirmed send loss](../../gaps/unconfirmed-send-loss-across-reload.md)
  and [abandoned work](../../gaps/abandoned-work-outlives-the-client-that-wanted-it.md):
  existing delivery and cancellation defects constrain what v0 may promise.

## Observed harnesses and coupling

`packages/server/test/setup/create-app.ts` already isolates each full app's
data directory, points non-Claude providers at empty histories, disables
registry-backed provider discovery with `provider: null`, supplies an offline
update lookup, and registers disposal. It still imports and constructs the
full application. It is a boundary fixture, not a lightweight core factory.

Hono route tests already call `app.request()` without opening a socket.
`test/drafts/routes.test.ts` uses the real migrations and SQLite `:memory:`
store inside such a route fixture. `test/supervisor/restart-compaction.test.ts`
drives a narrow operation with controlled events/timers and no HTTP. These
patterns are available now; a Unix-socket runner is unnecessary to obtain them.

Diagnostic baseline on the current macOS checkout, 2026-10-30:
`pnpm --filter @yep-anywhere/server exec vitest run test/drafts/routes.test.ts test/supervisor/restart-compaction.test.ts`
passed both files and all 18 tests. Vitest reported 0.439 seconds total and
0.031 seconds in test bodies. This validates the existing examples, not v0
behavior or a before/after performance improvement. No new test is claimed.

`src/app.ts` constructs many unrelated services, configures ambient provider
runtime state, and constructs scanner/observation infrastructure. Supervisor's
constructor starts stale/liveness timers. Those are concrete obstacles to a
small independently instantiated core, rather than evidence that no DI exists.
`SessionMetadataService` already accepts a `SqliteDatabase`, while still using
a data directory for legacy import. Storage injection and filesystem freedom
must therefore be assessed per service.

## Recommended first delivery

Ship a read-only local v0 slice before session creation or peer forwarding:
API description/schema, caller inspection, self server identity/access,
projects, providers and bounded session reads. Reject remote targets explicitly.
Mount it in the real app through existing auth/host/origin protections and
project/session access rules. It must work with local authentication enabled.
Do not let a second set of route defaults bypass those protections.

This slice can finish independently. It establishes the actual module and
HTTP boundaries without first extracting all of Supervisor, implementing a
framework, opening a new listener or building grant UI. Follow with native
creation/provenance, then direct peer access. Add message/configuration/control
operations only through the existing or deliberately extracted admission owner.

### 1 — Define the local contract and public server identity

Finalize schemas, bounded pagination, structured errors, discovery links,
authenticated caller context and proposed route names. Make supported actions
and caller permissions distinguishable. Use existing schema tooling where it
fits; do not maintain disconnected handwritten OpenAPI and validation models.

Specify persistent public identity initialization, concurrent creation,
corruption behavior, backup/clone semantics and identity authentication before
using it for routing. Keep relay ownership ids private to their existing role.
Tests inject fixed identities; production uses the persistent owner. Review
the stable-release corpus/capability exposure before changing any advertised
client/server contract. Existing `/api/*` consumers remain supported and do
not start depending on v0 as part of this work.

### 2 — Extract the operation-sized application services

Recommended initial module placement: `packages/server/src/core-api/` for
transport-independent operations/contracts, and `src/routes/v0/` for Hono
adapters. Treat paths as a proposal, not a reason for a module-moving campaign.
Do not create a new workspace package until a real second package consumer
needs one. Keep transport and storage implementations outside the operation
module's dependency graph.

Construct only capabilities used by the read slice: authorized catalog reads,
identity/access descriptions and provider facts. HTTP supplies authenticated
caller context; core methods independently enforce resource authorization.
An in-process invocation does not imply superuser access. Keep native
transcript readers authoritative and preserve canonical YA ids.

Wire production adapters to current services. Where a route contains reusable
policy, extract that policy into one shared owner and make both route versions
use it. Do not implement v0 by calling the whole app's own HTTP routes, or copy
their policy into another runtime. Input/activation extraction is its own
bounded step, not a prerequisite for read-only discovery.

### 3 — Build the minimal fixture composition

Provide a test factory for the actual read services and v0 routes: explicit
identity/principal, fixture catalog, real in-memory SQLite when the exercised
store needs SQL, a controlled clock/id source only where used, and one joined
disposal owner. Multiple instances must coexist without shared environment,
provider registry mutations, default HOME reads or current-server globals.

Discovery-off means no watcher/scanner/native inventory owner is constructed.
It must not merely run one against an empty home. Use explicit registered
fixture entries. Tests that need discovery remain separate corpus tests.
No full virtual profile/filesystem is needed for service/HTTP tests. Retain
temporary disk-backed fixtures for legacy import, native transcript reads and
restarts; a memory fixture cannot prove those behaviors.

If a needed production service starts work in its constructor, extract explicit
lifecycle start/dispose only for that service and preserve normal startup in
the app composition root. Do not add a broad `testMode` or disable production
readiness/maintenance semantics to make tests pass. Propagate cancellation to
read work and release observations deterministically.

### 4 — Add native session creation and provenance

Select one application-owned launch operation shared with existing creation.
Reuse provider adapters, permission/account settings, canonical ids and current
queue/admission owners. Do not add checkout/worktree preparation policy.
Record the immediate authenticated actor and optional source session, plus a
scoped idempotency key and resulting session reference.

Define durable reservation, native-launch reconciliation and unknown-outcome
behavior before claiming retry safety. A repeated key returns the original
result or explicit pending/uncertain state; a changed payload conflicts.
Preserve existing UI-created and limited-user attribution. Caller disconnect
does not cancel an accepted launch. Native provider protocol fixtures are
needed to qualify launch behavior; a Map pretending to be a provider is not
evidence for provider execution or restart recovery.

### 5 — Exercise two direct peers before grant UI

Inject A's peer directory and target-specific request transport. Begin with
two independently constructed apps joined by an in-process fetch dispatcher;
send real HTTP requests through B's normal authentication and v0 middleware.
Do not pass a trusted Principal object directly into B and call that an auth
test. Then repeat a bounded representative case over actual loopback TCP on
OS-selected ports, with tracked listener teardown.

Provision separate fixture-only peer bearer credentials with target-side
project/action grants. Prefer this to inventing Basic auth. Pin expected peer
identity and reject wrong-server responses before releasing credentials.
Authenticated peer identity is not a caller-chosen header. Unknown peers,
reverse access, unauthorized projects/actions and onward forwarding fail.
Source outbound records and target creation records correlate without a shared
database transaction. Cover lost-response retry and target revocation.

This is isolated development enrollment, not production peer authorization.
Production credentials/grant storage, revocation and session attestation need
their explicit contract/review before real peer exposure. UI can follow that
contract without blocking these fixtures. No secrets go in committed config.

### 6 — Qualify secure routes and agent bootstrap independently

Adapt the same request contract to direct SRP and the encrypted relay using
existing auth, resume, framing and connection owners. A local/direct pass is
not evidence for either encrypted transport. Retain a small real relay/SRP
integration covering authentication, caller scopes, reconnect and ambiguous
mutation outcome; do not reproduce the whole resource matrix over sockets.
Relay remains the normal remote route; Tailscale is unnecessary.

Advertise API address and owning host/session facts consistently for supported
launches, with queryable effective access. Preserve provider-specific instruction
placement and sandbox boundaries. Do not widen own-session credentials or make
models carry peer secrets. General CLI/MCP adapters, grant UI, scheduling and
same-session migration remain separate consumers.

## Retained test matrix

| Boundary | Evidence worth retaining |
| --- | --- |
| Pure policies | Target resolution, grant intersection and mismatched idempotency input; controlled interleavings where meaningful |
| Service plus real SQL | Two isolated identities/stores; allowed/denied catalog reads; provenance and scoped retry state |
| In-process HTTP | Actual auth/validation/status/error bodies and bounded reads through `app.request`; destination authorization on forwarded requests |
| Owned disk profile | Identity persistence, creation/provenance restart and unconfirmed-outcome reconciliation |
| Actual provider adapter | Native launch/input outcomes and canonical identity using controlled protocol fixtures |
| Two direct peers | Correct target, directional grants, no onward routing, lost-response retry and revocation; mostly in-process plus one TCP smoke |
| Secure transport | Focused direct-SRP/relay boundary tests when those adapters land |
| Lifecycle | Import/construction starts no unrelated work; cancellation/disposal releases owned observers and drains work |

Avoid endpoint-name-only mock tests or asserting that one wrapper called
another. Assert externally visible facts with real services at the boundary
being claimed. Add no browser suite before there is a browser change.
Unix sockets can later verify a supported deployment transport on appropriate
platforms; they add OS behavior, not extra service isolation.

Measure focused suite setup/run/teardown in seconds before and after extraction
on the same host. Start with measurements rather than a guessed speed budget.
No fixed sleeps; use completion signals and controlled clocks. Memory tests do
not replace restart/locking/durability checks. Follow
[test value and cost](../development/testing.md#test-value-and-ci-cost), the
runtime-portable SQLite contract, and required workspace checks after source
changes. Do not rerun broad suites for documentation-only edits.

## Effect decision

Recommendation: no Effect adoption in the first slice. Explicit typed service
dependencies, small functions, AbortSignal, async iteration and joined disposal
can establish the boundary with today's dependencies. A later bounded comparison
can evaluate Layers/Scope and cancellation against a demonstrated problem.
Neither tests that run without sockets nor SQLite `:memory:` require Effect.
