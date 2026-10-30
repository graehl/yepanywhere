# Relay peer session coordination: first useful slice

The 2026-10-30 [HTTP v0 proposal](../../topics/http-api-v0.md) and
[plan 165](165-http-api-v0.md) supersede this plan's worker/delegation service
as the entry point. Start with ordinary server-addressed resources, creation
provenance and local/direct tests; peer-grant UI and production secure peer
enrollment follow separately. Relay remains the intended usual remote route.
The lifecycle and trust analysis below is earlier background, not an instruction
to implement a custom task/worker system first.

Status: **proposed implementation scope**, 2026-10-03. The maintainer selected
persistent, target-owned YA sessions over the public relay as the direction for
their installed hardware. The details below are a bounded recommendation, not
an implemented protocol or an approval of the public API contract. App release
delivery remains the [roadmap](../roadmap/README.md) priority.

## Outcome

From a Codex session, ask: “Have Claude on my desktop review commit X in
project Y.” The desktop creates and owns the Claude session. The caller can
inspect progress, retrieve the answer, and send follow-up work without manually
switching hosts. Closing the browser or sleeping the initiating laptop does not
stop accepted target work. On return, the caller finds the same worker and its
durable output instead of launching another review.

“Have Claude review this locally” uses the same coordination service with a
local target. The first implementation should prove both paths, with Claude
and Codex able to be either caller or worker.

## Existing work this narrows

- [Cross-host delegation](../../topics/cross-host-delegation.md) already owns
  directed grants, relay-first transport, target-owned workers, one local/peer
  coordination service, and opt-in agent tools. Implement a subset of it.
- [Principals and grants](../../topics/principals-and-grants.md) separates
  credentials from target-enforced authority. Hosted Google login or another
  issuer can later introduce principals; it is not a prerequisite for pairing
  two owner-controlled servers.
- [Agent session access](../../topics/agent-session-access.md),
  [ask-session](../../topics/ask-session.md), and the
  [agent command runtime](../../topics/agent-command-runtime.sketches.md)
  supply the agent-facing direction. Reuse one service and delegation ledger;
  do not build a second local review orchestration product.
- [Managed SSH evidence](119-managed-ssh-executor-baseline.md) remains useful
  for disposable or uninstalled targets. It does not need further expansion
  before this persistent-peer experiment.
- The [T3 source review](../competitive/t3code-remote-sessions.md) supports the
  value of independent target ownership and local credentials. Its client
  environment catalog does not supply YA's server-to-server delegation model.
- Existing [password-protected agent API](../../gaps/agent-tools-lose-ya-api-under-local-password.md)
  and [remote file source](../../gaps/remote-session-project-views-use-local-files.md)
  gaps are explicit acceptance constraints. This slice does not claim to fix
  every existing artifact tool or SSH file viewer covered by those gaps.

## Bound the product

| Include | Defer |
| --- | --- |
| Already installed, independently running YA servers | SSH installation, disposable VM provisioning, wake-on-LAN |
| Explicit directional owner-approved pairing over relay | Hosted account issuance, organization membership, automatic full mesh |
| Existing target projects and target-local provider/Git credentials | Clone/checkout synchronization, credential forwarding, automatic worktrees |
| Create a separate worker; observe and send follow-ups to that worker | Move the current conversation, import provider state, unify transcripts |
| One local/peer coordination service, accessible to Claude and Codex | Voice-specific orchestration, full multi-host dashboard, fleet scheduler |
| Worker summary/result in the caller; authenticated link to target session | Arbitrary target API proxy, remote shell, unrestricted session search |

The recommended initial existing-session support is intentionally narrow:
continue a worker already recorded in this caller's delegation ledger. Sending
work to an unrelated pre-existing session needs a separate exact-session grant
and can follow. No endpoint may adopt a possibly live external provider session
by guessing that it is idle; preserve [session ownership](../../topics/session-ownership.md).

“Resume the worker on the laptop” means control a worker the laptop already
owns. “Resume this conversation on the laptop” means
[super-session handoff](../../topics/federated-super-sessions.md), with provider
state transfer and single-writer fencing. The latter is not fulfilled by
creating a new worker with a summary.

## Pairing and authority

Use stable installation IDs, with display names and relay addresses as mutable
metadata. Inspect existing identity facilities before adding an ID; a saved
browser host entry is not automatically a server identity. Bind the IDs during
an owner-authenticated pairing ceremony. Receiving a claimed ID proves nothing.

The proposed first ceremony uses a browser already authenticated as owner to
both servers. The target owner selects projects and a worker permission
profile; the source owner accepts the directional relationship. The browser
brokers a short-lived, single-use pairing exchange. It is absent from normal
server-to-server execution. Browser passwords, cookies, and owner SRP resume
credentials never become peer credentials.

Establish a distinct peer credential using the existing audited SRP/encrypted
relay machinery, with a target-side grant and separately stored source-side
credential. Exact enrollment messages, persistence, expiry, and resume binding
must be written and reviewed before implementing authentication. Do not give a
peer owner authority merely to reuse the existing relay handler.

Recommended initial policy:

- Pairing is directional and non-transitive. A → B grants neither B → A nor
  A → C through B. A shared Google account or Switch Host entry grants nothing.
- The target grants discovery of selected projects, worker creation, and
  observation/input/interrupt of workers created under that grant. Every
  operation checks its resource and action; a known session ID is insufficient.
- Target policy caps providers, models, permission mode, and active workers.
  Start with one active worker per grant; reject excess starts explicitly.
- Pairing and agent use are separate choices. Agent use is default-off and
  explicitly enabled for the calling session and outgoing relationship.
  Delegated workers receive no onward-delegation capability in this slice.
- Agents receive a launch-bound coordination credential, not the peer secret
  or main server owner token. Authenticate the actual caller server-side.
  Keep `ya-agent self` authority unchanged. The path must work with local
  Require Password enabled.
- Peer input cannot answer human approvals or increase the worker's policy.
  A worker waiting for human approval reports attention required; an authorized
  human acts on the target. Agent output does not become human authority.
- Target revocation blocks new requests, resumed transports, observation and
  further control through that grant. Accepted workers remain target-owned and
  continue under target policy; stopping them is a separate explicit action.
  Revoke active credentials/streams too, not just future handshakes.

Removing an outgoing relationship disables local use immediately. If the target
is offline, show remote revocation as pending rather than claiming the target
has applied it. Keep incoming grants inspectable and revocable on the target.

This is for the owner's trusted machines. API project scopes do not contain
an unrestricted provider process running as the target OS user. Work/personal
separation requires no grant across that boundary and no independently shared
credentials or machine access that bypass it. Strong untrusted execution is a
different sandboxing scope.

## Workspace and provider readiness

Return only allowed target project IDs and bounded facts: display name, path,
Git remotes, current branch/HEAD, dirty state, and provider readiness. The caller
selects an opaque target project ID and may assert an expected commit/branch or
cleanliness condition. The target verifies assertions at admission and reports
a structured mismatch. It does not silently fetch, checkout main, reset, stash,
or guess a corresponding project from its name.

The target uses its installed provider authentication, Git SSH/HTTPS credentials,
commit identity, and forge CLI authentication. These are separate readiness
facts; successful provider login does not imply push or PR permission. The first
review workflow requires an already available revision. Missing setup produces
an actionable blocker for the target owner.

Provider inference and any credential refresh needed during the run must not
depend on the initiating laptop. AAR can be used where independently reachable;
an AAR instance on the sleeping laptop does not satisfy this acceptance case.

## Operations and failure behavior

Expose a small coordination adapter through the packaged `ya-agent` runtime;
final command/tool names are implementation details. Both providers get the
same operations and response meanings. A separate MCP adapter is not required
to prove the first slice.

| Operation | Required behavior |
| --- | --- |
| Targets/projects | Discover only caller-authorized choices and supported operations |
| Start | Submit explicit target, project, provider, task, expectations, and durable request ID |
| Inspect/wait | Bounded snapshot/output and attention state; wait defaults to 30 seconds, then returns |
| Send | Deliver follow-up to the recorded worker through target-owned input ordering |
| Interrupt | Explicitly interrupt recorded worker work; a view disconnect is not an interrupt |

The target persists the request receipt before launch and binds it to one
canonical YA worker ID. Repeating the same request returns the same receipt;
reusing an ID with different input fails. Apply equivalent deduplication to
send/control operations. If a crash leaves launch or delivery uncertain,
reconcile against the target supervisor and durable session state; return
uncertain instead of blindly retrying the side effect. Do not promise exactly
once external tool effects.

The source retains the relationship between caller ID, target identity, grant,
request ID, and worker ID. Target execution state and source connectivity are
separate: disconnected means unknown, not failed or completed. Reconnect reads
the durable receipt and authoritative snapshot, then catches up using a cursor;
an expired event window returns a fresh snapshot plus bounded transcript access.

Distinguish running, awaiting human input, idle after a turn, failed, and
interrupted. An idle provider is not proof that a review succeeded. Return the
last completed answer with its turn identity and explicit status; the caller
decides whether that answers its task. Results and transcripts remain on the
target under its ordinary retention policy. Retain deduplication tombstones
after record cleanup so an old retry cannot recreate deleted work; the exact
retention/expired-request policy belongs in the protocol design.

Observation is demand-driven, cancellable, and bounded. Reuse shared relay
connections/subscriptions and the existing runtime's recovery behavior; do not
add a permanent polling timer per worker. Sleeping the source pauses supervision,
not execution. Target OS sleep, target death, and provider death remain separate
recovery cases; this feature does not promise uninterrupted execution through
them. Automatic wake of the caller on worker completion is a follow-up, using
the existing wake policy rather than an implicit new agent-input grant.

## Implementation order and evidence

### 1 — Local coordination and durable worker records

Build the smallest service around existing YA create/input/supervisor APIs.
Exercise a Codex caller launching a Claude review and the reverse through the
scoped agent adapter with local password authentication enabled. Establish
idempotent requests and durable worker references here; avoid a broad core API
refactor or implementing the entire proposed cross-session search surface.

### 2 — Peer pairing and the relay path

Specify the identity, enrollment, grant/resume, operation schema, retention,
and error contracts above. Add an explicitly experimental capability gate on
both ends. Unsupported peers expose no coordination actions and receive no
unsupported requests; preserve ordinary host switching.

Before changing a public client/server contract, complete the stable-release
corpus and maintainer review required by
[minimum compatibility horizons](../../topics/server-capabilities.md#minimum-compatibility-horizons).
This plan does not pre-approve unknown releases or wire schemas. Reuse existing
crypto and relay framing; implement dedicated peer authorization rather than
an unrestricted proxy to the main API.

### 3 — One useful remote review and reconnection

Design a minimal functional pairing/grant surface and show a worker
reference/result in the caller. The earlier YA Hosts placeholder was retired
during house cleaning; it is not an implementation prerequisite. Full transcript and
file navigation must retain target identity and authenticate the viewer
independently; a worker grant must not silently sign the browser in as owner.
Opening an optional target view can switch hosts; issuing work and reading its
answer must not require that switch.

Acceptance uses independently running YA services and the public relay, with
direct LAN/Tailscale routes unavailable:

- Claude and Codex can each initiate and receive work using the same adapter.
- A reply lost after target acceptance, followed by retry/reconnect, creates
  one worker and delivers one follow-up. Uncertain admission stays explicit.
- After target acceptance, sleep the initiating laptop. The worker progresses
  using target credentials; a separately authorized phone can inspect it.
  Wake the laptop and retrieve the same worker's output.
- A target project with a deliberately different HEAD fails the caller's
  assertion. Target file/result links never read a same-named local checkout.
- A → B does not authorize B → A, A → C, ungranted projects, arbitrary sessions,
  or onward delegation. Revocation rejects live and resumed peer authority.
- Approval-required work waits for a human without manufacturing approval.
  Target restart reconciles state without creating a second provider writer.
- Older/disabled peers stay usable through existing host switching. New UI
  controls pass real sequential typing under concurrent session updates.

Stop expanding scope when this workflow works. The next decision should come
from using remote reviewers/build workers on real hardware: unrelated existing
sessions, automatic result wake, workspace preparation, or conversation handoff.
None is a prerequisite for this experiment.
