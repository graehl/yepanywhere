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

- `/v0` returns public server id, revision `2026-10-30.2`, unstable status and
  discovery links. The documentation slice adds Markdown
  help at `/v0/help`, links help/me/schema from discovery, and generates field
  descriptions, operation semantics and example requests alongside OpenAPI.
  `/v0/schema` generates OpenAPI 3.1 response/query schemas
  from the same Zod definitions used by the read surface. These schemas describe
  this subset, not every planned route in the table below. The documentation
  slice is implemented; socket/bootstrap and session binding remain pending.
  Help/schema inherit the normal host's authentication policy, including
  configured auth-off localhost behavior; they do not introduce an independent
  credential requirement on that existing listener.
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

The proposed `GET /v0/help` adds a short Markdown introduction, the resource
model and executable examples for implemented operations. Operation summaries,
descriptions, field semantics, errors and examples should live with the
operation contracts and generate both the readable reference and OpenAPI.
Identity/access discovery alone is not sufficient documentation. See
[the review plan](../docs/tactical/166-agent-api-bootstrap-and-documentation.md)
for the next proposed delivery and acceptance criteria.

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

## Local agent bootstrap: Unix socket first

Maintainer direction, 2026-10-30: start local agent access with HTTP over a
private Unix-domain socket. This is a proposal, not an implemented listener or
credential. Preserve the same core operations and `/v0/me` resource without
requiring a TCP listener, a `ya-agent` command, an MCP configuration, or an SRP
client inside the agent. Remote SRP-only access policy can coexist with this
separate local transport. For native Windows, the proposed starting transport
is a dedicated bearer-authenticated loopback HTTP listener on an OS-selected
port. It serves the same operations without a public/LAN listener or helper
CLI; strict no-TCP Windows support needs another transport. The
[review plan](../docs/tactical/166-agent-api-bootstrap-and-documentation.md#native-windows-transport)
specifies platform bootstrap and evidence requirements.

An eligible provider launch should receive the socket path, an HTTP base URL
and a scoped credential, plus a minimal instruction showing how to query its
own context. Candidate names are `AGENT_YA_API_SOCKET`, `AGENT_YA_API_URL` and
`AGENT_YA_API_TOKEN`. The current own-session inspection service already uses
the latter two names with a different endpoint and credential; migration must
be explicit rather than silently repointing an existing lease. Credentials
establish the owning YA session/launch and effective authority; asserted ids
and socket reachability alone do not. An inherited child credential still
identifies its owning YA session.

Before implementation, define private socket placement and permissions,
ownership and cleanup across restarts, credential lifetime/revocation, and
provider sandbox reachability. Do not advertise a socket the agent cannot
reach or silently widen its sandbox. Native Windows loopback, Node/Bun runtime
and client-tool compatibility need qualification. Broader default advertisement and
agent permissions remain explicit product decisions.

The current desktop application instead starts a bundled Bun server on a
loopback HTTP port and loads its web dashboard in a Tauri WebView. Native code
manages server lifecycle and bootstraps a browser session; ordinary dashboard
traffic uses HTTP and WebSocket, not a general Tauri API bridge. The proposed
agent socket can coexist with that listener and does not require replacing
the dashboard transport. [Desktop contract](desktop-v0.md#local-dashboard-authentication)
owns that existing boundary.

### Preferred first slice (proposal)

Offer one explicit **YA API access** option, initially off. For an explicitly
enabled, unrestricted operator-owned launch, the proposed useful first profile
allows all currently implemented v0 catalog reads under the operator's existing
authority, with an authenticated owning-session binding. This supersedes the
earlier own-session-only first-slice sketch. Scope is an explicit operation set,
not automatic access to future routes or the legacy `/api/*` surface. Restricted
launches must retain their principal/resource ceilings or remain ineligible;
shell access is not itself a credential or a sandbox guarantee. Broader default
advertisement is a later product decision.

For an eligible launch, publish socket/base-URL/credential connection details
and a short, previewable instruction containing one working `/v0/me` request.
The instruction also directs the agent to `/v0/help` to learn what it can do.
Use ordinary environment variables first; a mutable connection descriptor file
is an extension if real reconnection or credential-rotation needs justify it.
Do not include credential values in the injected instruction or transcript.

The initial agent credential permits caller inspection, served help/schema and
the implemented read catalog under its effective authority. `/v0/me` should return the public server id,
canonical owning session id, launch id, effective access, observation time and
links to the allowed resources. Resolve these from the credential and live
owner state, not caller-supplied session ids. Advertised server capabilities
remain distinct from operations this particular caller may perform. The own
session identity may be temporarily unavailable before native session creation
finishes; expose that state explicitly rather than substitute a resume handle.

Prefer extending the existing provider-owned inspection runtime with a separate
private HTTP socket adapter. Do not expose the provider host's private JSONL
worker/control sockets as the public API or create another daemon. On paths
where the provider owner survives Hono replacement, its local identity service
and credential should survive too. Own-context reads should not depend on Hono;
catalog operations may explicitly report temporary unavailability while
their authoritative owner reloads. A full provider-owner restart ends the old
launch lease and requires fresh bootstrap on the next launch.

Use one bounded listener/credential registry per owning runtime, not a listener
per session. Place it in a short private runtime directory, outside projects;
qualify directory/socket permissions and safe stale-path cleanup. Revoke the
lease when its launch ends, and recheck effective authority on each request.
No fallback to unauthenticated localhost or another profile is allowed.

Prove the slice with isolated core/auth fixtures, then a real Unix-socket
request: two concurrent profiles, caller/resource isolation, revoked credentials,
inherited child identity and provider-owner continuity across controller
reattachment. Provider/platform reachability must be qualified before claiming
support. Peer enrollment remains the next independent design, not part of this
first slice.

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

## Future command execution and interactive terminals

Maintainer direction, 2026-10-30: both noninteractive command execution and a
real `node-pty` terminal are reasonable future API surfaces. Neither is part
of the implemented local read slice or a prerequisite for session interaction,
agent discovery, or peer enrollment. Specialized Git/file endpoints should
earn their investment against these more general primitives and concrete
consumer needs.

The command surface should accept an explicit target server, working directory,
argument vector and optional environment/timeout, and report stdout, stderr
and process exit status. Shell interpretation, when wanted, should be explicit.
Long-running execution needs defined process ownership, bounded output,
observation, cancellation and disconnect behavior; route names and persistence
are not selected yet.

The terminal surface should spawn an actual host shell through `node-pty`,
with input/output, dimensions, exit observation and explicit close behavior.
It does not require an SSH daemon or implement an SSH protocol tunnel. PTY
output and shell exit status do not supply per-command stdout/stderr or command
completion semantics. Terminal attachment/history/reconnection and any relation
to a YA session remain design questions.

Both surfaces use target-enforced grants distinct from merely discovering a
host or inspecting sessions. Their authority and execution boundary must be
stated before implementation. They must reuse the server addressing and
transport boundary rather than introduce a second peer connection system.

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
