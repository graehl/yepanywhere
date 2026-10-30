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

- `/v0` returns public server id, revision `2026-10-30.3`, unstable status and
  discovery links. The documentation slice adds Markdown
  help at `/v0/help`, links help/me/schema from discovery, and generates field
  descriptions, operation semantics and example requests alongside OpenAPI.
  `/v0/schema` generates OpenAPI 3.1 response/query schemas
  from the same Zod definitions used by the read surface. These schemas describe
  this subset, not every planned route in the table below. The documentation
  slice is implemented. The local agent runtime factory below adds launch
  binding; automatic provider advertisement/integration remains pending.
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

`GET /v0/help` serves a short Markdown introduction, the resource
model and executable examples for implemented operations. Operation summaries,
descriptions, field semantics, errors and examples should live with the
operation contracts and generate both the readable reference and OpenAPI.
Identity/access discovery alone is not sufficient documentation. See
[the review plan](../docs/tactical/166-agent-api-bootstrap-and-documentation.md)
for delivery and acceptance evidence.

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

## Compact conversation reads

Implemented in revision `2026-10-30.4`: `GET
/v0/servers/{serverId}/sessions/{sessionId}/conversation` returns stable message
ids, exact visible prose/Markdown, observed activity, bounded failure/media
references, read-only pending attention, coverage and an opaque content revision.
It excludes routine tool bodies, thinking and rendered HTML. This is a filtered
projection, not an LLM summary or a completion verdict. Truncation, byte limits,
recent-two-compaction scope and unknown evidence remain explicit. `idle` does not
establish successful completion. Provider/history shapes outside acquisition
support return `503 conversation_unavailable`; no native history is guessed.

`maxMessages` is 1–100, default 20. `anchorMessageId` selects an existing stable
visible message; an unavailable anchor returns `404 anchor_unavailable`, without
silently moving to the latest window. Unknown window parameters fail. The
served help and OpenAPI schema describe the same bounds and examples. A launch
read lease can read this surface; no creation, sending or approval authority is
added by this slice. Resource access is checked before acquiring history.

Reads use the existing shared conversation observation owner. They add no
independent scanner, permanent poll loop or per-token transcript read. A request
that cannot obtain its first publication within four seconds releases demand
and returns unavailable, within the private controller bridge's deadline.
Final-consumer removal cancels source work and releases watches/viewers. Native
acquisition constraints are owned by [Simple Client API](simple-client-api.md).

## Bounded HTTP following

Implemented in revision `2026-10-30.5`: `GET
/v0/servers/{serverId}/sessions/{sessionId}/conversation/follow` uses the same
window parameters and authorization as a compact read. Without `after`, it
returns the initial compact view, a cursor, `changed=true` and `reset=true`.
Reissue with that cursor in `after` and the same window to wait for prose,
failures, pending attention, activity or coverage to change. Tool-count-only
updates do not wake the wait. Finalized prose is sufficient; token streaming
is not promised.

`waitMs` is 0–4000, default 4000, after the first observation. Initial
acquisition has a separate four-second deadline, so a request takes at most
eight seconds. An unchanged wait returns the same cursor, `changed=false`,
`reset=false`, `conversation=null`; retain the previous view. Changed responses
contain one full bounded compact replacement with `reset=true`. Consumers must
replace their selected window, including removals/rewinds. Cursors are scoped
to server, session, visible content and window, with no retained cursor registry.
A foreign/stale cursor in the current format returns explicit replacement
state. A malformed or unsupported cursor format returns 400. This contract
promises current-state recovery, not event-log replay or every intermediate
message. Coverage still describes retained history limits.

One request owns at most one response and one bounded wait. There is no SSE/PTY
or permanent per-client loop in this slice. Identical requests share source
acquisition and coalescing. A disconnect, deadline, controller replacement or
launch-credential revocation cancels demand; the final consumer releases the
source/watch/viewer. Active private reads revoked or detached return 503 where
the transport remains writable; later revoked-credential requests return 401.
Slow readers cannot accumulate repeated snapshots or keep observation alive
after the one response has been selected. Clients own retry/backoff and should
use bounded waiting rather than a tight zero-wait/error loop.

## Local agent runtime factory

Implemented independently of provider/UI integration, 2026-10-30. A provider
owner can construct a bounded runtime with a fixed public server id, issue an
operator catalog-read launch lease, and attach an existing CoreApi controller.
Restricted principals are not eligible in this first profile. The Unix adapter
creates a fresh private mode-0700 runtime directory and mode-0600 socket; native
Windows selects an OS-assigned IPv4 loopback port. No legacy API, browser cookie,
desktop bootstrap or unauthenticated localhost fallback is mounted.

Every request, including help/schema, requires its registered launch bearer.
Browser origins and non-loopback Host names are rejected. Credentials are
stored as digests in a registry capped at 1,024 live/retained leases. They expire
after 24 hours; only a trusted provider owner can renew them. Disposal, runtime
shutdown and revoke-all invalidate credentials; renewal cannot revive revoked
ones. This is API authorization, not isolation from a same-user shell.

`/v0/me` returns server identity, observation time, discovery links and the
credential's owning `{id, launchId}`; `id` is null until canonical binding.
Ordinary app authentication still returns `session: null`. Caller-supplied ids
cannot change that binding. The agent schema describes mandatory bearer auth.

Own-context/help/schema and local server facts do not require a catalog
controller. Catalog reads return `503 controller_unavailable` while detached,
at the bounded catalog concurrency ceiling, or when their attachment becomes
stale. Detach/replacement promptly cancels HTTP waiters and aborts source work
where supported; both stale errors and successes are rejected. Each attachment
has its own generation even when it reuses the same CoreApi object. Source
owners may retain independently shared work. Six real-transport regressions
cover identity, auth, lease lifecycle and controller handoff races. The bundled
macOS Bun 1.3.14 binary also passed Unix/loopback source-adapter smoke checks;
this is not native Windows or complete packaged-provider qualification.

## Local agent bootstrap

**Agent API discovery** in Settings → Local Access is independently configurable
and default-off. Enabling it gives new eligible local, unrestricted Claude-family
and Codex bypass-permissions launches a private connection, a launch credential
and the exact previewable instruction exported by
`packages/shared/src/agent-api-bootstrap.ts`. Restricted and remote-executor
launches receive none. This is the existing v0 read catalog, not a grant to future
writes or legacy `/api/*`. Turning it off revokes current access; turning it on
again applies to new launches. Old servers omit the control through the separate
`agent-api-bootstrap` capability (introduced in the 0.11.1 line).

Connection variables are `AGENT_YA_V0_URL`, `AGENT_YA_V0_SOCKET` (Unix only)
and `AGENT_YA_V0_AUTHORIZATION` (the complete `Bearer …` header value). They are
separate from the unchanged legacy self/view `AGENT_YA_API_URL/TOKEN` and from
the broader legacy operator `AGENT_SERVER_TOKEN`. An old self-only credential
cannot acquire catalog authority. No actual credential is injected into prompt
text, written to YA's shell bridge, exposed in the environment viewer, or sent
through worker launch recipes. Both provider environment filters remove an
inherited v0 family before an explicitly authorized new launch is injected.
Native child tools inherit their owning YA session, not a new session identity.

On macOS/Linux, the HTTP adapter owns a fresh mode-0700 temporary directory and
mode-0600 socket. Native Windows uses a random `127.0.0.1` TCP port with bearer
authentication on every route, including help/schema. The URL is a syntactic
origin when curl uses the socket; no DNS or TCP access is required. The transport
factory also supports loopback on Unix for qualification. These listeners mount
only v0, reject browser Origins and do not use desktop master credentials.

```sh
curl --unix-socket "$AGENT_YA_V0_SOCKET" -H "Authorization: $AGENT_YA_V0_AUTHORIZATION" "$AGENT_YA_V0_URL/v0/me"
```

```powershell
curl.exe -H "Authorization: $env:AGENT_YA_V0_AUTHORIZATION" "$env:AGENT_YA_V0_URL/v0/me"
```

Codex's default shell environment excludes names containing TOKEN, KEY or SECRET;
the header variable remains policy-admitted without widening that user policy.
For API-enabled Codex threads YA disables `shell_snapshot` and
`shell_snapshot_v2`, since snapshots can persist admitted values to disk. A
user's stricter environment policy may still hide the connection; instructions
say to report unavailable access instead of guessing another port or credential.
Other provider persistence, user shell startup scripts and agent-written files
are outside YA's guarantee; a full-shell agent can intentionally inspect its own
environment. This is attribution and authenticated access, not a shell sandbox.

The provider owner holds a bounded shared runtime per logical profile and one
24-hour lease per launch, renewed on observed SDK activity without heartbeat
loops. Abort/end revokes and releases the runtime when the last launch ends.
Disable is sticky across pending starts and applies by public profile id to
hosted workers. `/me`, help/schema and local identity stay available while a
hosted controller detaches; dependent catalogs return retryable
`controller_unavailable` until a matching controller attaches. The authenticated
worker socket dispatches only bounded catalog reads; stale replies and stalled
reads are cancelled. An older source host without revocation support must be
restarted before launching with this option. In-process desktop/Windows paths
do not enable the source provider host.

The desktop application still starts bundled Bun on loopback HTTP and loads its
web dashboard in Tauri. Native code bootstraps the browser session; dashboard
traffic uses HTTP/WebSocket. The private agent adapter is independent of that
listener and does not require a Tauri IPC transport.
[Desktop contract](desktop-v0.md#local-dashboard-authentication) owns that boundary.

Evidence: real curl bootstrap, credential separation, owner detach/reattach,
actual host/worker socket dispatch and revocation, plus desktop/phone preview and
sequential typing checks. macOS Node and bundled Bun source-adapter checks pass.
Native Windows PowerShell, Linux, packaged provider/tool invocation and crossing
native Windows/WSL remain qualification work; transport tests on macOS do not
establish that parity. Broader onboarding, peer grants/routing, session writes,
command execution and PTYs remain separate proposals.

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

## Opt-in documentation evals

The [small eval runner](../scripts/agent-api-eval/README.md) imports the actual
bootstrap/help/schema and private HTTP adapter with deterministic source
functions. It needs no full YA app, scanner or ordinary profile. Normal tests
exercise fixture boundaries and grading without model calls; `--run` explicitly
opts into fresh Codex scratch sessions. Real-model execution currently requires
POSIX process groups; native Windows HTTP/bootstrap qualification remains
separate. Saved ChatGPT access is copied without refresh or API-key authority;
local Ollama is an optional diagnostic lane.

The [initial evidence](../docs/tactical/166-agent-api-bootstrap-and-documentation.md#delivered-eval-evidence--2026-10-30)
records 12/12 Sol medium trials across documentation variants, three extra Sol
high tasks and one local Qwen identity trial. Keep the short bootstrap plus
served help for now; this small sample does not establish cache savings or a
statistical model-quality ranking. Narrower operation docs/schema are a useful
next context-cost experiment. The runner reports bytes and provider usage
separately rather than inventing unique-context tokens or subscription prices.

## Next slice: session commands and compact following (proposal)

Maintainer direction, 2026-10-30: proceed toward creation, messaging and
following, including authenticated creation/message attribution. Defer native
Windows qualification until multi-device enrollment exists, so the Windows host
can exercise the actual enrollment and peer path. This qualification does not
block the local session API slice; no Windows support removal is selected.

### Existing caller behavior and reusable pieces

Read-only inspection of matching recent Claude/Codex histories found agents
polling `/api/sessions/{id}/process`, then fetching project-scoped session detail
and extracting user/assistant text with Python or jq. Some inspect the latest
few raw messages or read native JSONL directly. A representative Codex caller
first tried top-level message content and then corrected its filter to nested
`message.content`; the current shapes and tool noise cause avoidable discovery
and repeated reads. This was a targeted sample, not a population measurement.
The repository's `scripts/monitor-agent-process.mjs` is a stronger existing
example: it observes state/liveness/queue depth without fetching transcripts,
and distinguishes verified idle from missing ownership or needed attention.

The older compact API still exists: `GET /api/experimental/conversation` and
its `/subscribe` SSE route. Read-only live checks returned usable snapshots
for Claude/Codex examples and a valid SSE initial snapshot. One normal reviewer
detail response was 996,257 bytes (109 raw records; 9,484 serialized bytes of
user/assistant text), versus 12,408 bytes for the compact view. A Claude example
returned 2,308,285 versus 20,436 bytes. The compact query selected at most 20
logical visible messages with explicit coverage; these are representation
examples, not equal raw-record windows or latency benchmarks. Evidence is in
ignored `tasks/http-api-v0/discovery-research/response-shapes.json`.

[Simple Client API](simple-client-api.md) owns the existing experiment. It
already has shared grouping/projection, activity, important failures, pending
requests, bounded snapshots and subscription teardown. [House cleaning](core-house-cleaning.md)
row 10 defers its removal; this new use does not select the alternate UI or
promote that experimental protocol wholesale.

Its acquisition is not ready to become the universal agent reader: it caps
native history at 8 MiB/10,000 records, refuses inherited Codex rollouts, has
limited provider coverage and does not assemble partial token frames. The
current long agent session exceeds 8 MiB and returned `unavailable` in the live
check. Reuse useful semantic projection and lifecycle pieces while connecting
them to bounded canonical provider history acquisition. Do not raise the file
cap or load full histories merely to return a small tail.

### Recommended read and follow contract

Default to a deterministic compact conversation projection: stable message ids,
user text and agent-authored Markdown, current activity, pending attention and
honest history coverage. This is filtering/grouping, not an LLM-generated
summary. Routine tool calls/results, thinking and rendered HTML stay out of the
default response. Keep bounded warnings/failure references and media/artifact
references where they are the only relevant output; explicit diagnostics can
retrieve underlying activity. Commentary and final agent prose both remain
available, with phase/completeness when the provider establishes it.

Use bounded JSON history plus an HTTP follow binding over the same view. State
polling remains useful on its own. Following should deliver new/changed visible
messages and activity transitions, avoiding replay of a whole transcript on
each tool event. Stable ids and revisions permit replacement of growing text;
provider token streaming is not a prerequisite for useful finalized-message
following. SSE is an existing HTTP binding worth reusing; a client should not
need YA's browser WebSocket reducer or a helper CLI.

Define initial snapshot, cursor/revision scope, reconnect and explicit reset
before promising resumable delivery. The current experimental SSE sequence is
binding-local and its coalesced snapshots may skip intermediate states; it is
not a durable event-log cursor. Rewinds, compaction, scope changes and retention
loss must not silently appear as an ordinary append. Expose truncation/unknown
coverage; never turn unavailable ownership into successful completion.
Activity must distinguish working, idle, awaiting attention, ended and unknown.
Message acceptance/delivery/completion and queue depth remain separate facts.

### Creation, messaging and provenance

Reuse native YA launch and input owners through application services rather
than making the new API call legacy Hono routes or launch another provider
resume. Preserve project/provider/model/permission configuration without adding
worktree, checkout or delegation lifecycle policy. Extend the current read-only
launch grant explicitly when enabling writes; existing read grants must not
silently acquire newly added mutation operations.

Keep current creation-source hints (`web`/`desktop`/`api`) and limited-user
ownership, but add trusted creator facts: immediate principal, originating
server/session/launch when authenticated, destination identity, request identity
and time. Current `creationProvenance` is optional client/source metadata, not
an authenticated agent-parent identity. The launch credential can establish
local session attribution; caller-supplied ids cannot. Do not overload the
existing fork or `/btw` parent fields. Attribute later submitted messages too.

Creation and messaging need scoped retry identities and inspectable outcomes.
The [unconfirmed-send gap](../gaps/unconfirmed-send-loss-across-reload.md) and the
mutation-outcome contract above remain acceptance inputs. An accepted queued
message is not yet durable provider delivery, and idle alone does not prove
that a particular submitted message received a response. Receipts identify the
submission being followed without imposing a managed delegation workflow.

A useful implementation order is compact bounded history/status; creation with
trusted provenance and retry reconciliation; then message receipts and follow
continuity through the same owners. Exercise the complete agent workflow after
each meaningful slice: launch a reviewer, observe new prose and activity, send
a follow-up, reconnect without duplicate input, and inspect creator facts.
Retain YA-launched Sol 6.1 high reviews between implementation phases. Native
Windows/enrollment stays at the later multi-device acceptance boundary.
