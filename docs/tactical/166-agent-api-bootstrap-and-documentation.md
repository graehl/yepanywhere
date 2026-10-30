# Agent API bootstrap and served documentation

Status: **implemented**, 2026-10-30, with platform qualification limits below.
Delivered in four reviewed phases: documentation, credentials/local transports, provider advertisement/UI
and reload continuity, then the opt-in eval runner. Each phase used a
YA-launched Sol 6.1 high reviewer; findings were repaired before its commit.
It extends the delivered
[local read slice](165-http-api-v0.md), under the owning
[HTTP v0 topic](../../topics/http-api-v0.md). Release priority is unchanged.

Phase 1 is implemented: served Markdown help, operation/field descriptions,
example requests, discovery links and a fixture-backed pagination walkthrough.
Lint, formatting, typecheck, full workspace tests and focused core/auth tests
pass. Sol 6.1 high review found one misleading authentication statement; the
guide now accurately explains host auth-off behavior, and the same reviewer
confirmed the repair. Later phases are tracked below.

Phase 2 is implemented as an isolated local runtime factory, before provider
wiring: Unix/loopback bearer authentication, trusted launch context, bounded
leases and catalog controller attachment. Full checks pass; the phase reviewer
found cancellation, stale-error and same-object-generation races. Repairs add
attachment cancellation, guarded outcomes and reserved catalog concurrency.
The reviewer rechecked all three and ran all six focused regressions with no
remaining blockers. Native Windows qualification remains outstanding; macOS
Node tests and bundled Bun 1.3.14 source-adapter smoke pass both transports.

Phase 3 is implemented: independent default-off Local Access setting and exact
preview, separate V0 credential namespace, eligible provider spawn/bootstrap,
Codex resume handling and snapshot suppression, bounded controller dispatch and
profile-scoped revocation. Review found inherited-env, pending-start, profile
revocation, snapshot-persistence and older-host eligibility defects; all repaired
and rechecked by the same Sol 6.1 high reviewer with no remaining findings.
Real host/worker HTTP integration and lifecycle regressions pass; focused Codex
start/resume checks pass. Desktop/phone captures and sequential typing while a
settings reply arrives pass. Native Windows and packaged-provider qualification
remain explicit limitations. Root lint, formatting and types pass. The full
workspace test run has 6,583 passing server tests and one known unrelated
[Rendez restart watcher failure](../../gaps/rendez-nested-watch-event-after-restart.md);
its isolated rerun also failed. Those Node 26 failures remain recorded.
Phase 4 had a complete Node 22 workspace pass; its final cleanup verification
again hit the known watcher failure. Details and remaining limits are below.

## Outcome and scope

An explicitly enabled local agent can learn where it runs, discover the API,
and inspect authorized projects and sessions without a YA checkout, installed
helper CLI, configured MCP server, public/LAN API listener or SRP client. The
agent receives connection details and one short instruction, then uses ordinary
HTTP tools over a private Unix socket on macOS/Linux or an authenticated
loopback TCP endpoint on native Windows. Windows support is part of this plan,
subject to actual runtime evidence, rather than an unspecified later transport.

Deliver the existing read surface with useful documentation and launch-bound
authentication. Session creation, history/messaging, peer enrollment/routing,
grant-management UI, command execution and PTYs remain separate work. Keep v0
unstable; document only operations the running build implements.

## Existing contracts and defects

- [Principals and grants](../../topics/principals-and-grants.md) separates the
  acting principal, credential, authority and route. The launch credential adds
  authenticated session attribution; it does not introduce a universal identity
  system or turn a project scope into execution isolation.
- [Own-session inspection](../../topics/agent-self.md) already publishes a
  scoped credential and commands from a provider-owned runtime. Reuse its
  lifetime boundary; do not require its CLI for the new bootstrap.
- [Provider host API](../../topics/provider-host-api.md) and
  [reload-safe runtimes](../../topics/reload-safe-provider-runtimes.md) delimit
  hosted source-runtime support. Desktop/Bun must not silently enable that host
  merely to support this API.
- [Agent context](../../topics/agent-context-injection.md) owns provider-specific
  placement and compaction behavior. [New-session tooling](../../topics/new-session-agent-tooling.md)
  owns launch advertisement. Update those owners when implementation lands.
- [Password-protected agent access](../../gaps/agent-tools-lose-ya-api-under-local-password.md)
  is evidence that URL-only bootstrap is insufficient. This slice proves v0
  access with authentication enabled; it does not claim to repair legacy
  artifact uploads or authorize all `/api/*` routes.
- [Environment marker debt](../../gaps/agent-facing-env-markers.md) and
  [subprocess boundaries](../../topics/subprocess-environment.md) constrain
  propagation. Preserve unrelated wake/browser-debug credentials.

## Proposed experience and access

One **YA API access** option, initially off, enables connection details and
minimal advertisement together for eligible launches. For the initial
unrestricted operator-owned profile, allow the currently implemented v0 reads,
plus help/schema, under the operator's existing resource authority. This is a
useful catalog-reading profile, not the earlier own-session-only proposal and
not an automatic grant to every future operation. Restricted launches retain
their existing principal/permission ceilings or remain unsupported with an
explicit reason. No implicit elevation from a limited user to the operator.

Implemented environment variables are `AGENT_YA_V0_SOCKET`,
`AGENT_YA_V0_URL` and `AGENT_YA_V0_AUTHORIZATION` (the full bearer header). Publish the socket variable only
when Unix-socket transport is selected. Use variables initially; a mutable
connection descriptor is deferred until a concrete lifecycle need justifies it.
The HTTP base URL is a syntactic request origin when using the socket; no DNS
or TCP connection is needed for that invocation.

The short capability fragment should identify YA and give this working request,
then direct the agent to `/v0/help` for operations and `/v0/schema` for details:

```sh
curl --unix-socket "$AGENT_YA_V0_SOCKET" \
  -H "Authorization: $AGENT_YA_V0_AUTHORIZATION" \
  "$AGENT_YA_V0_URL/v0/me"
```

Never interpolate the actual credential into model context or transcripts.
Inherited native child environments identify the owning YA session, not a new
YA child session. A launch before canonical identity is available reports
pending identity explicitly; native resume handles are not substitutes.

### Native Windows transport

On native Windows, bind the dedicated agent adapter to `127.0.0.1` on an
OS-selected port. Require the launch bearer credential for every operation,
including help/schema. Do not inherit unauthenticated localhost operator
defaults, expose LAN interfaces, or use the desktop master credential. Port
secrecy is not authorization. Reuse the same core operation and caller policy;
only the listening transport and executable bootstrap example differ.

Publish the exact URL and token, omit the socket variable, and advertise a
PowerShell example using `curl.exe` explicitly:

```powershell
curl.exe -H "Authorization: $env:AGENT_YA_V0_AUTHORIZATION" "$env:AGENT_YA_V0_URL/v0/me"
```

The current own-session service already uses a random authenticated loopback
listener through `node:http`; retain that shape while qualifying the new
adapter on native Windows Node and packaged Bun. The existing desktop UI port
is independent. A Windows profile requiring absolutely no TCP listener cannot
use this initial transport; report that explicitly rather than claim named-pipe
parity or silently weaken its policy.

Named pipes remain a possible later local transport, not a prerequisite. Node
supports them for IPC, but the Bun HTTP listener and ordinary client tooling
need separate qualification; IPC support alone is not HTTP/tool parity.
See [Node IPC](https://nodejs.org/api/net.html#ipc-support),
[Bun HTTP named-pipe compatibility report](https://github.com/oven-sh/bun/issues/24682),
and [Windows curl invocation](https://learn.microsoft.com/en-us/windows/curl/).
These sources motivate qualification, not a claim that a local Windows probe
has run.

A YA instance and agent both running in WSL follow the Linux socket path.
Native Windows-to-WSL launches are a separate reachability boundary: do not
assume shared loopback or translate a socket path blindly. Support requires an
explicit reachable channel and evidence under that provider/tool environment.

## Implementation sequence

### 1 — Make the current API understandable

Extend the operation contracts in `packages/server/src/core-api/contracts.ts`
with summaries, descriptions, parameter/field meanings, representative examples
and operation-specific error semantics. Keep validation and documentation
metadata together. Generate OpenAPI and a readable operation reference from
that catalog; avoid a second manually maintained endpoint inventory.

Add authenticated `GET /v0/help`, returning bounded Markdown with a short
introduction, resource identity model and examples for finding projects,
filtering/paging sessions and reading a summary. Explain incomplete catalogs,
unsupported remote targets, provider descriptors versus readiness/models,
summary versus transcript, and unstable revisions. State that writes are not
implemented. Use ordinary error responses/status codes for help failures.

Link help, schema and caller inspection from `/v0`; link useful allowed
resources from `/me`. Distinguish implemented operations from caller authority.
Serve documentation through the same operation/transport composition, without
directory scanning or a running provider. Schema documents transport-specific
authentication, including the distinction between agent bearer and operator
cookie access; Unix socket invocation belongs in executable examples.

### 2 — Add launch-bound credentials and caller context

Reuse the trusted launch/owner boundary to issue a separate, unpredictable
credential bound to public server identity, runtime instance, canonical session
when known, launch and an explicit operation/resource profile. Keep acting
operator/limited principal distinct from the credential's launch attribution.
Evaluate current authority on each request, including revocation.

Extend `/me` with owning server/session/launch, identity readiness, observation
time, effective access and discovery links. Ordinary browser/operator requests
may still have no bound session. Caller-supplied ids, cwd, socket proximity and
headers cannot establish the launch binding. Unknown/expired/revoked credentials
fail explicitly; never fall back to ambient operator access.

The existing self/view URL/token family remains unchanged. The new V0 family
keeps credentials and authority separate. Leases expire after 24 hours, renew on
owner observations, and are bounded and revoked on owner end or disable.

### 3 — Serve the API over the selected local transport

Add Unix-socket and native-Windows loopback HTTP adapters using the same core
operations and authorization.
Mount only the intended v0 surface; do not expose desktop bootstrap, operator
administration or legacy routes through a permissive whole-app mount.

Prefer the existing provider-owned inspection runtime as listener owner: one
bounded listener/registry per owning runtime, shared across its sessions. On
Unix, use a short private runtime directory outside projects, mode 0700, socket mode
0600, and ownership-checked stale-path cleanup. Do not unlink another live
instance or accept another profile's identity. Release listeners and leases
when their owning lifetime ends; introduce no per-session heartbeat loops.

Own-context/help/schema reads must not depend on Hono. Catalog reads use the
existing authoritative CoreApi sources. Where hosted ownership crosses a
process boundary, add only the bounded authenticated operation-dispatch seam
needed to reach those sources through the active controller. Do not duplicate
catalog acquisition or expose the provider host's private control protocol.
Reject requests for the wrong profile/controller generation. During controller
replacement, return an explicit retryable unavailable result for dependent
reads; keep own-context reads alive when the provider owner survives.

Prove the ownership/reattachment seam before committing to that composition. If
it requires a new daemon or broad host refactor, revise this plan rather than
expand scope. A full provider-owner restart ends its leases; a replacement
launch receives fresh bootstrap. Desktop keeps its existing dashboard HTTP
listener, cookie bootstrap and Tauri boundary.

### 4 — Advertise only working launch paths

Wire environment and the minimal capability fragment through provider-owned
spawn only; the v0 credential must stay out of legacy shell bridge files. Start with current own-session
eligible local Claude-family and unrestricted Codex paths, and qualify each
actual runtime. Preserve default-off behavior and unrelated context.

Do not assume shell reachability proves provider-tool sandbox reachability.
For unsupported sandboxes/providers/platforms, show an explicit eligibility
reason and publish no unusable capability or silently widened sandbox policy.
Include native Windows eligibility and its transport-specific bootstrap in this
slice. Record Node, Bun, desktop and OS evidence separately; do not advertise
unqualified parity or require the Linux/macOS provider host on Windows.

The implemented global Settings → Local Access option **Agent API discovery**
reuses existing controls and shows the exact shared instruction preview. This
keeps the first opt-in independent of legacy operator access and avoids adding
a second per-session policy field. The separate `agent-api-bootstrap` capability
gates the setting; old hosts omit it. Stable corpus: 0.11.0 and 0.10.2 (plus
optional 0.10.0/0.10.1) have no promise of this feature. Broader onboarding,
per-session choices and default-on promotion are deferred.

## Validation and acceptance

Prefer the existing isolated core/Hono fixtures, without full profiles,
scanners, provider discovery, real models or TCP listeners. Retain real boundary
coverage rather than tests that merely repeat operation metadata:

- Serve examples from real fixture projects/sessions and execute their requests;
  verify paging, incomplete catalog behavior and documented response shapes.
- Exercise real bearer authentication and restricted-resource enforcement over
  a Unix socket and native Windows loopback, including wrong/missing/revoked
  tokens, port reuse and concurrent profiles. Require auth on help/schema too.
  Ensure unsupported operations cannot reach a legacy route or ambient owner.
- Prove listener ownership, safe cleanup, launch end and inherited-child identity.
  On supported hosted paths, reattach a replacement controller while retaining
  the launch; own context remains readable and catalogs recover without a new
  provider launch. Use the real host boundary, not a mock of continuity.
- Exercise the existing inspection commands through migration and prove that
  their old lease does not acquire catalog authority. Repeat with local password
  required; desktop master credentials must remain native-only.
- Qualify actual provider shell/tool invocation and packaged Node/Bun paths in
  isolated profiles. Never restart the user's desktop app or primary server to
  establish evidence.
- Run the native Windows bootstrap through actual PowerShell and any supported
  Git Bash provider path; distinguish those from WSL evidence. Confirm loopback
  binding and bearer-only access, and retain platform boundary regressions.

### Documentation effectiveness and context cost

YA has launch/monitoring, transcript and usage infrastructure, but no identified
reusable behavioral documentation-discovery eval. The turn-sequence experiment
runner in [core service API](../../topics/core-service-api.md#1-scripted-prompt-sequence-perf-experiments-python)
remains proposed; it is not a prerequisite for this bounded evaluation. The
existing `scripts/agent-self-smoke.mjs` proves real shell/packaging integration
with a scripted provider, not model comprehension. Keep that distinction.

Add a small opt-in runner around actual agent launches, isolated API fixtures
and executable deterministic graders. Reuse existing launch/monitoring seams;
do not build a general eval framework or another experiment server. Import the
actual generated bootstrap/help/schema so cases cannot test copied stale text.
The runner may use existing operator APIs to launch/observe the evaluator;
the agent under test receives only its selected API bootstrap and served docs.

Compare these variants against the same API and effective permissions:

| Variant | Context supplied before discovery |
| --- | --- |
| Minimal | Connection request and schema link |
| Served guide | Minimal bootstrap plus `/v0/help` discovery link |
| Inline guide | A fuller guide in launch context, with the same served docs available |

Proposed initial model lanes:

| Lane | Model and harness | Purpose |
| --- | --- | --- |
| Primary | `gpt-6.1-sol`, Codex, medium effort | Representative capable-agent discovery and task success |
| Diagnostic | `qwen3.5:9b`, local Ollama through YA's `codex-oss` adapter | Optional smaller-model check for confusing descriptions or excessive documentation |
| Confirmation | Sol high, when a comparison warrants it | Check the normal high-effort workflow without multiplying every initial run |

Read-only discovery on 2026-10-30 found Codex logged in through ChatGPT and
Ollama serving an installed `qwen3.5:9b` Q4_K_M model. YA lists that local model
through `codex-oss` and `claude-ollama`. Catalog/metadata availability is not
evidence of successful agent execution. Before the local lane counts, qualify
tool calling and API bootstrap reachability through the chosen harness. Keep
that harness stable across documentation variants; report harness/setup failure
separately from a model failing to use correct documentation. Do not expand
shipped provider eligibility merely to obtain an eval lane without qualifying it.

Prefer opt-in local Codex sessions using the operator's existing ChatGPT sign-in
for the primary lane; no separate API billing setup is required for supported
local subscription use. This runs the harness locally with hosted inference.
Ollama supplies the separate fully local inference lane. Subscription capacity
is still bounded; cap concurrency and stop/report rate-limit exhaustion rather
than switching accounts or silently falling back to API-key billing. Record
usage/latency rather than inventing a per-run dollar cost for subscription use.
See [official authentication](https://learn.chatgpt.com/docs/auth#openai-authentication)
and [model/noninteractive selection](https://learn.chatgpt.com/docs/models).

Start with one case/sample to check each lane, then a small primary-model
comparison. Qwen is optional diagnostic evidence, not the product acceptance
gate: improve the strong-model workflow and quantify any extra text needed to
help the smaller model. A second model family can follow if actual usage merits
it. Model inventory/settings above are a proposed starting point, not pinned
availability or a requirement to run every lane for each edit.

Use fresh sessions with controlled fixture names/ids and no YA checkout or
uncontrolled personal instructions. Cases should include owning-context
inspection, finding a named project, filtering and paging its sessions,
inspecting the correct session among similarly named entries, handling an
incomplete catalog, and recognizing unavailable writes/remote routing. Include
ordinary tasks that need no YA access to detect needless discovery. Grade the
requested result and valid resource identities from fixture truth/API traces,
not exact answer wording or a prescribed call sequence. Record legacy API or
filesystem shortcuts separately; those cannot establish documentation success.

Measure task success, first successful request, total requests/errors/retries,
completion time, exact bootstrap bytes, fetched documentation bytes including
repeated reads, and provider-reported input/cache/output usage where available.
Record failed/timed-out trials as well as successful ones. Distinguish initial
context from on-demand discovery cost, and total processed/billed input from
unique context added; summing replayed input is not a measure of unique docs.
Missing per-turn attribution stays unavailable, not zero or an invented estimate.
Model-token counts require the correct tokenizer; byte budgets are labeled bytes.

Pin provider/model/effort, harness version, tool policy, API/docs revision and
fixture seed. Start with one case/sample to verify setup, then repeat relevant
cases across variants in varied order under a declared run/time/token budget.
Compare on the same model, report raw successes/trials and cost, and expand the
sample only where variance or a decision warrants it. Choose text based on
success and total effort/cost rather than shortest prompt alone. No claim of
cache savings follows from stable text or a single run.

CI should execute fixture/example/grade correctness and track bootstrap/help/
schema byte sizes without model calls. Establish a measured baseline before
choosing useful growth limits; do not add arbitrary token ceilings or brittle
snapshots for all prose. Real-model comparisons remain opt-in, with redacted
traces/results retained in ignored scratch output and a concise review report.
Real-model evidence is recorded below; no model calls run in normal CI.

After source changes, run lint, format verification, typecheck and workspace
tests. New UI requires the repository's focused browser, real sequential typing
and artifact evidence. Record platform limitations and timing for added tests.

## Decisions for this review

- Accept the useful operator catalog-read profile for explicitly enabled,
  unrestricted operator launches, with additional authority kept explicit.
- Accept docs/help first, followed by socket/bootstrap and lifecycle evidence;
  session writes and peers remain subsequent plans.
- Review the proposed opt-in/preview experience and environment migration.
- Accept Unix sockets on macOS/Linux and bearer-authenticated random loopback
  TCP on native Windows. Confirm required Node/Bun/desktop evidence. Strict
  no-TCP Windows and cross-WSL access need separate qualification/design.

## Delivered eval evidence — 2026-10-30

The opt-in [runner](../../scripts/agent-api-eval/README.md) uses the actual
private HTTP runtime and pure fixture sources without starting the YA app or
scanners. The CLI runs in fresh scratch HOME/CODEX_HOME/cwd with ephemeral
sessions, ignored personal config/rules, no API keys and an access-only copy
of saved ChatGPT auth. Refresh authority is blank; expiry/age preflight requires
margin for the declared budget. Reviewers still launch through YA. Direct eval
execution controls fixture env without adding arbitrary env injection to YA.

macOS, Codex CLI 0.160.0, Sol 6.1 medium: one fresh sample of each identity,
pagination, unsupported-action and ordinary-no-API task per variant, rotated
order, fixture revision 3. All 12 passed. The control made no API calls in any
variant. This is descriptive qualification, not a statistically established
quality or cache-efficiency ranking. Reported input includes processed/replayed
context and is not unique documentation context.

| Variant | Success | Bootstrap bytes | API requests / errors | Fetched docs bytes, including repeats | Total seconds | Reported input tokens |
| --- | --- | --- | --- | --- | --- | --- |
| Minimal | 4/4 | 292 | 13 / 0 | 230,068 | 57.3 | 218,298 |
| Served help | 4/4 | 696 | 14 / 0 | 245,378 | 52.5 | 199,040 |
| Inline help | 4/4 | 8,353 | 22 / 0 | 310,550 | 61.1 | 225,021 |

Sol high additionally passed project lookup, detail disambiguation and incomplete
catalog handling (3/3) using the shipped bootstrap, plus an access-only-auth
identity qualification (1/1). Installed local Qwen 3.5 9B through Codex OSS /
Ollama passed identity (1/1, about 41 seconds); this qualifies that diagnostic
harness path only, not all tasks or shipped provider eligibility. Local tokens
are not directly comparable with Sol or across tokenizers.

The first setup fixture omitted its owning session from the catalog and caused
a needless 404; revision 2 repaired that inconsistency. The final comparison
uses revision 3 with a detail-only output instruction restricted to its case.
Review also repaired false grading requirements: help/schema/inline supplied
operation evidence need not force a particular extra fetch. Provider quota
detection ignores ordinary prose and token counts such as 429. A real TERM-resistant descendant regression covers process-group teardown;
the leader closing cannot cancel escalation. Windows real-model eval execution
remains disabled pending equivalent process-tree qualification. Raw prior runs
remain separate from final evidence in ignored `tasks/http-api-v0/phase4-*`.

Keep the shipped small bootstrap plus served help. This sample shows no outcome
benefit from injecting the whole guide. A useful next experiment is narrower
on-demand operation documentation/schema: the full launch OpenAPI is 57,517
UTF-8 bytes, help 7,655, and repeated schema fetches dominate discovery bytes
in some trials. Do not claim a measured cache saving or change defaults from
this sample. Larger or repeat runs should answer a concrete decision.

Normal CI retains four boundary/grader/cleanup tests (roughly 90 ms of test work,
about 0.5 s including Vitest startup here), source typechecking and a dry-run
byte report command; no paid CI dependency or new runtime library. The browser
proof remains the phase 3 preview and real sequential typing check. Root Node 22
lint, format and type checks pass. An earlier full workspace run passed
(6,586 server / 7,018 client); final cleanup changes pass all focused checks,
but the final full server run has 6,587 passing tests and the known unrelated
Rendez watcher failure at line 353; its isolated rerun passed in 5.76 s.
The full final gate is not green; earlier
Node 22 passes do not resolve that intermittent failure.

Native Windows PowerShell/tool invocation, Linux, packaged-provider end-to-end
and crossing native Windows/WSL still need qualification. Session writes/history,
peer grant enrollment/routing and command/PTY surfaces remain subsequent slices.
