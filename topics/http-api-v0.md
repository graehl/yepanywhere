# Server-addressed HTTP API v0

Topic: http-api-v0

Status: local read-only slice implemented, 2026-10-30. The maintainer selected
HTTP-first design, explicit server addressing, agent-discoverable identity/access,
and creation provenance, then authorized implementation. The delivered subset
is specified below; creation, messaging, peer routing/enrollment and consistent
launch-bound bootstrap remain proposals. [Implementation and tests](../docs/tactical/165-http-api-v0.md)
track the staged work. This does not reprioritize releases or restart the
archived session-core campaign.

## Implemented local read contract

The ordinary app mounts `/v0`, `/v0/schema`, `/v0/me`, `/v0/servers`, and the
self server's description, access, capabilities, projects, providers, sessions
and single-session summary routes. Unknown targets never execute locally.
Other v0 resources and all writes remain unimplemented. Existing `/api/*` and
the separate own-session listener retain their contracts.

- `/v0` returns public server id, revision `2026-10-30.1`, unstable status and
  discovery links. `/v0/schema` generates OpenAPI 3.1 response/query schemas
  from the same Zod definitions used by the read surface. These schemas describe
  this subset, not every planned route in the table below.
- `/v0/me` returns the resolved superuser/limited principal and `session: null`.
  Current operator cookies/tokens do not prove which agent session is calling;
  user-supplied ids or headers cannot establish that binding.
- Access describes all-project versus project-grant scope and implemented
  read operations. Existing limited-user project grants, creator access to
  their own sessions, and personal hidden-project list behavior apply. Catalog
  filtering precedes pagination; hidden lists do not revoke direct access.
- Projects use the existing retained project projection. Providers are exposed
  harness descriptors and supported steering/permission controls; this endpoint
  performs no installation/authentication/model discovery. A model catalog is
  later work. Sessions are retained native-catalog summaries with current
  metadata/runtime overlays, not full transcripts or messages.
- Catalog responses report `complete` and `refreshing`. A missing detail in an
  incomplete catalog returns `503 catalog_not_ready`; a missing or inaccessible
  session in a complete catalog returns `404 session_not_found`. Ambiguous native ids
  spanning projects are rejected before session-wide project metadata is applied,
  and projected collisions are also omitted. They cannot select one project's
  detail. Session ordering compares timestamps chronologically across fractional
  precision and timezone offsets, with the session id breaking ties.
- Collection defaults are 50 items, maximum 100. `cursor` is a nonnegative
  decimal offset; `projectId` filters sessions. Offset pages are best effort
  across concurrent catalog changes, not snapshots. Response item count is
  bounded by page size, while filtering/sorting still visits the retained
  projection and the existing catalog owner governs acquisition cost. No new polling or discovery service is created by this API.
- Successful route responses are non-cacheable. V0 errors contain
  `{error: {code, message}}`; existing host/auth/limited-user middleware may
  reject earlier with its existing JSON/text errors. Private exception text is
  not returned. Source cancellation is passed as an AbortSignal; this does not
  cancel refresh work independently owned by the shared retained catalog.

The public id is a fresh UUID stored in singleton `public_server_identity` in
the profile's existing SQLite database (migration 13). Transactional insertion
preserves the first id across concurrent handles and restarts. Invalid identity
data fails initialization without regenerating it. Backup restoration preserves
identity. There is no clone/reset command yet: running a copied profile as an
independent second server requires separate identity provisioning before peer
routing is enabled. The relay `installId` is unchanged and never reused here.

V0 shares the app's host/CORS/custom-header, operator authentication and
limited-user principal resolution. Socket-free fixtures inject the principal
at their trusted composition boundary; that is not production network auth.
The auth regression enumerates v0 as well as existing API routes. No hosted
frontend depends on v0 and no existing capability changes meaning. The current
stable corpus (v0.11.0/v0.10.2 plus optional-window v0.10.0/v0.10.1) has no v0
promise; callers discover it directly and treat absence as unsupported. No
compatibility shim, SRP change or new peer credential is introduced.

## Product boundary

Expose YA's projects, providers, sessions, messages, permissions and authorized
hosts through an understandable HTTP API. Agents decide how to arrange work:
create a worktree, prepare a checkout, choose a model, launch another session,
poll or observe it, and collect the answer. YA records facts and enforces access.

This direction supersedes the custom worker/delegation service as a prerequisite
in [cross-host delegation](cross-host-delegation.md). A created session need not
be a child task. Creation does not imply automatic result delivery, parent
wakeups, cancellation propagation, repository transfer or managed worktrees.
Session migration remains the distinct [super-session proposal](federated-super-sessions.md).
Scheduling remains valuable separate work under [Yacron](yacron.md), using the
same supported session operations when implemented.

## Development version and discovery

Use `/v0/`. It is explicitly unstable: routes, fields and behavior may be added,
changed or deleted during development. There is no additive-only compatibility
promise and no automatic promotion to stability. Introduce `/v1/` only by a
deliberate stability decision. A descriptive schema revision and source/build
identifier aid diagnosis without requiring a permanent adapter for every v0 build.

`GET /v0` reports the receiving server's public id, unstable API status and
revision, and links to its machine-readable schema and available resources.
The schema describes supported operations, bounds, errors and examples without
requiring the YA source checkout. Discovery reports implementation support
separately from effective caller permissions and reachability.

`GET /v0/me` describes the authenticated caller. A launch-bound session credential
may identify its owning `{serverId, sessionId}`; an ordinary operator or peer
credential need not name a session. There is no ambient "current session"
inferred from the port, most recent activity, cwd or a model-supplied id.
This replaces the earlier, overloaded `/context` sketch. Bootstrap can provide
the API address and owning ids directly; callers query `me` when useful.

The existing opt-in own-session listener's `/v1/self` and `/v1/view` are a
different, narrow API ([agent self](agent-self.md)). V0 must not silently widen
those credentials or take over that listener's paths.

## Identity and addressing

A public `serverId` identifies a logical YA data/profile instance. Generate an
opaque id independently of network setup and persist it across upgrades and
restarts. Separate profiles receive separate ids. A copied profile intended to
run as a second independent server needs a new identity; backup restoration of
the same logical server preserves it. Exact persistence and clone/reset entry
points must be specified before implementation.

Do not use the relay-ownership `installId`, an SRP username/session id, a URL,
browser source key, hostname or display label as this public id. The existing
[source identity seam](client-source-runtime-topology.md#sourceruntimeregistry)
and [mobile pairing contract](mobile-server-pairing.md#deferred-installation-identity-and-route-continuity)
already distinguish public identity from relay registration and authentication.
An id names a resource; authenticated pairing binds a route to that identity.

All server-owned resources include the target in their path, including local
requests. Examples below are proposed routes, not installed endpoints:

| Method and path | Meaning |
| --- | --- |
| `GET /v0/servers` | Servers addressable by this caller, including self |
| `GET /v0/servers/{serverId}` | Server description and connection status |
| `GET /v0/servers/{serverId}/access` | Effective access for this caller at that server |
| `GET /v0/servers/{serverId}/capabilities` | Implemented API/provider capabilities |
| `GET /v0/servers/{serverId}/projects` | Authorized registered/discovered projects |
| `GET /v0/servers/{serverId}/providers` | Available providers/models and relevant options |
| `GET /v0/servers/{serverId}/sessions` | Bounded, filtered session catalog |
| `POST /v0/servers/{serverId}/sessions` | Create a native YA session in a selected workspace |
| `GET /v0/servers/{serverId}/sessions/{sessionId}` | Session facts and state |
| `PATCH /v0/servers/{serverId}/sessions/{sessionId}` | Supported configuration/metadata changes |
| `GET /v0/servers/{serverId}/sessions/{sessionId}/messages` | Bounded visible history |
| `POST /v0/servers/{serverId}/sessions/{sessionId}/messages` | Submit input with explicit supported delivery semantics |
| `GET /v0/servers/{serverId}/sessions/{sessionId}/relationships` | Recorded provenance and optional related-session links |

Choose explicit observation, pending-input and interrupt/stop operations before
their implementation. Do not hide them in ambiguous configuration patches.
Root collections make sessions directly addressable without redundant project
ids; project filters do not imply one global project identity across hosts.
The schema defines pagination, field mutability and provider limitations per
operation. Unsupported queue/steer behavior must be explicit, not silently
translated into another delivery choice.

## One HTTP surface across routes

An access server can receive `/v0/servers/B/...` and reach B through an
authorized connection. A direct call to B uses the same server-addressed path.
The resource owner remains B. Caller APIs do not gain `delegate`, checkout
placement, result-collection or workflow policy merely because B is remote.

The first slice handles the receiving server only. An unknown/unconfigured
target fails explicitly; it never falls back to local execution. A later slice
adds an injected peer directory and a request transport for the supported v0
surface. Target ids resolve through configured relationships, never arbitrary
caller-supplied URLs. A transit request cannot chain through the target's other
peers. One connection/request implementation can use direct HTTP initially and
SRP/encrypted relay later. No CLI, Tailscale or public relay is required for
local tests. Relay remains the intended usual remote-install route.

The target's own API revision and capabilities govern its operations. Routing
through a newer access server does not imply remote support or authorize
invented translations to older UI routes. Expose reachable/unreachable,
unauthorized and unsupported separately. Do not replay a possibly accepted
mutation on another route without its defined idempotency behavior.

## Authentication and grants: defer UI, keep the boundary

Use [principals and grants](principals-and-grants.md)' vocabulary: principal,
credential, grant, route and execution boundary are distinct. The target
authorizes each resource/action. A source's local superuser credential is not
automatically remote operator authority. A session id in JSON is not proof of
the caller's identity.

First local app integration uses YA's existing operator/limited-user
authentication and access policy. For two-owned-server development fixtures,
prefer manually provisioned, distinct opaque bearer credentials over adding
HTTP Basic authentication. Each maps to a source server and an explicit
target-side action/project grant. Test enrollment can be constructor-injected;
human grant-management UI and production enrollment are deferred. These fixture
credentials must not enable an undocumented production authentication bypass.

Plain HTTP peer fixtures bind to loopback. Non-loopback use needs an explicitly
qualified protected transport: existing direct SRP, encrypted relay, or an
authenticated HTTPS connection. Reuse the audited SRP machinery when qualifying
it; do not implement SRP in the core API. The exact production peer credential,
revocation, caller-session attestation and enrollment contract remains a review
gate before deploying remote access. Deferring its UI does not approve it.

Incoming access and outgoing relationships are directional and non-transitive.
A → B grants neither B → A nor A → C through B. Server discovery exposes only
authorized facts. Target-side revocation ends further access; it does not itself
stop an already accepted provider turn. Existing execution/sandbox policy stays
authoritative. This proposal does not add a universal identity system.

## Provenance and mutation outcomes

Record creation on both ends without requiring a delegation/task state machine.
On the destination, retain the created session, authenticated immediate caller,
source server/session when known, request id and timestamp. The destination
authenticates the source server; any source-session attribution attested by that
server is distinct from direct local session authentication. On the source,
retain the outbound request and returned `{serverId, sessionId}`. Correlate with
one request/idempotency key. UI hierarchy, role names and grouping remain TBD.

Source and destination stores do not share a transaction. The source can remain
unconfirmed after destination acceptance. Retrying the same scoped key must
recover the original destination result, not create duplicate work. Different
payloads under the same key fail with a conflict. A crash window between durable
reservation and native provider launch must reconcile or remain explicitly
uncertain; a key alone does not make external effects exactly-once.

Keep creation provenance separate from later input/control audit records and
from existing fork and `/btw` relationships. Optional descriptive links do not
confer authority or imply parenting. Existing [creation metadata](../packages/shared/src/app-types.ts)
and limited-user attribution must survive this extension.

Acceptance, durable input, provider delivery and finished work are different
facts. New endpoints must describe exactly which boundary a successful response
establishes. The [unconfirmed-send gap](../gaps/unconfirmed-send-loss-across-reload.md)
is existing evidence; wrapping the current optimistic message route cannot
claim a new durable delivery guarantee. HTTP disconnection cancels view-only
work where supported, but does not undo accepted mutations or stop their agents.

## Core boundary and testability

Use a small plain-TypeScript application-service module with typed operations,
caller context and errors. It depends on explicit catalog, native-session,
authorization and provenance capabilities. HTTP translates requests/results;
it is not the execution owner. Services import no Hono, Request/Response,
listeners, browser state or full-app composition. Production adapters reuse
existing Supervisor/provider/metadata owners rather than create a second runtime.

Keep pure policy/validation/transition decisions separate from I/O. The service
itself remains effectful: starting a provider and persisting provenance cannot
be made pure by an interface. Dependency construction belongs in an explicit
composition root; importing a module must not scan, listen or start timers.
Acquire only the operation's dependencies, not the entire app's option bag.

Tests can call services directly, route real Request/Response objects through
Hono's `app.request`, and connect two API apps with an injected fetch function.
None requires listening sockets. Retain a small real TCP HTTP check for the
network/auth adapter boundary. Unix sockets are optional transport coverage,
not the mechanism needed for fast tests or a cross-platform prerequisite.

Use the real SQLite adapter with `:memory:` for relevant store tests and real
temporary profiles for restart/durability/filesystem evidence. An in-memory
database is not an in-memory profile directory. Disable discovery by choosing
an explicit fixture catalog with no discovery owner; do not point at a real
home and hope an empty scan is cheap. Avoid a parallel Map database or a
generic fake filesystem just to accelerate tests.

Explicitly own clocks, ids, observation and cleanup. When a runtime needs
maintenance, give it a start/stop lifecycle; disposal joins pending work.
Production idle/readiness semantics must survive any lifecycle extraction.
See [architecture mandates](architecture-mandates.md) and the
[abandoned-work gap](../gaps/abandoned-work-outlives-the-client-that-wanted-it.md).

Effect's [Layers](https://effect.website/docs/v4/requirements-management/layers)
can manage dependency construction; [Scope](https://effect.website/docs/v4/resource-management/scope)
can manage resource lifetime. Those are relevant tools, but do not establish
the ownership or storage boundaries. Recommend ordinary TypeScript, explicit
dependencies, AbortSignal and disposal first. No Effect dependency, framework
migration, public core package or event-sourced conversation rewrite is a
prerequisite. Revisit a framework only against demonstrated lifecycle/concurrency
cost in the extracted seam, following the existing
[provider comparison](../docs/competitive/t3code-provider-architecture.md).
