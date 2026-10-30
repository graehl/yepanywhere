# Agent session commands and compact following

Status: **implementation authorized**, 2026-10-30. Implement end to end in
five reviewed, committed phases. The maintainer approved the sequence and
autonomous delivery, with YA-launched Sol 6.1 high reviews between phases.
The owning contract is [HTTP v0](../../topics/http-api-v0.md#next-slice-session-commands-and-compact-following-proposal).
This extends [165](165-http-api-v0.md) and [166](166-agent-api-bootstrap-and-documentation.md).

## Outcome and boundaries

An explicitly authorized local agent can read a compact conversation, follow
new prose and activity, create a session, send follow-up input, and inspect
trusted creator/submission attribution. Agents choose their workflow, checkout
and waiting strategy. Keep HTTP v0 unstable and use existing provider owners.
No managed delegation lifecycle, worktree policy, alternate client rewrite,
new transcript database or Effect migration is selected.

Defer Windows qualification until multi-device enrollment can exercise the
available Windows host. Peer grants/enrollment and remote routing remain later
work. Preserve current local/private transports and restricted-principal
ceilings. Current read-only launch credentials must not silently gain writes.
Any management opt-in is separate, explicit and initially off.

## Existing evidence and constraints

- [Simple Client API](../../topics/simple-client-api.md) retains useful pure
  projection and shared subscription ownership. Its experimental native reader
  refuses files above 8 MiB, large records and inherited Codex history. Current
  long sessions exceed that cap. Improve acquisition without lifting the cap
  into an unbounded full-history read. Preserve its existing consumers.
- [Portable compiler](../../topics/portable-transcript-compiler.md), active
  branch selection, compaction scope and YA/provider identity mapping remain
  authoritative. Reuse provider readers/indexes rather than parse a byte tail
  without lineage evidence. Unavailable/truncated coverage stays explicit.
- [Architecture mandates](../../topics/architecture-mandates.md) require shared
  keyed work, cancellation and final-consumer teardown. No permanent per-session
  poll loop, full file read per token or uncapped replay/consumer map.
- [Unconfirmed sends](../../gaps/unconfirmed-send-loss-across-reload.md) means a
  successful queue response cannot claim durable delivery. Use persistent
  request identity/outcomes and reconcile native evidence. A crash between
  reservation and external launch/send may remain explicitly uncertain.
- [Provider host API](../../topics/provider-host-api.md) owns live workers and
  submission evidence. Its turn receipts are useful prior art, not a universal
  platform prerequisite. Desktop/in-process paths must work independently.
- [Principals/grants](../../topics/principals-and-grants.md) distinguish actor,
  credential and authority. New attribution derives from authenticated launch
  identity, never a caller-supplied source-session header. Existing client
  creation hints, limited-user ownership and fork relationships survive.

## Implementation phases

### 1 — Acquire bounded conversations from real provider histories

Replace the experimental whole-file limitation with a source-aware reader
boundary. Start with Claude/Codex, preserve branches, inherited history,
compaction scope, stable message ids and coverage. Keep pure projection apart
from source I/O and full-app construction. Bound retained normalized input;
reuse existing indexed/native read capabilities where available. Measure cold
and warm acquisition and validate a real long session read-only.

Retain deterministic large-history, branch/lineage, incomplete-row and mutation
tests. No model eval is needed. Review, repair and commit the phase.

### 2 — Serve compact conversation and activity through v0

Add server-addressed bounded conversation reads to the core API and private
adapter/controller bridge. Default to exact user text and agent Markdown with
stable identities, activity/pending attention and coverage. Exclude routine tool
payloads, thinking and rendered HTML; preserve useful bounded failure/artifact
references. Update generated help/schema and executable examples together.
Unsupported provider/history shapes return explicit errors.

Use real HTTP/private auth and principal-scope tests. Two opt-in Sol medium
trials cover finding an answer in tool noise and incomplete/unknown evidence.
Grade requested facts rather than a prescribed request sequence. Review and
commit before adding streaming.

### 3 — Follow visible messages and activity over HTTP

Add a bounded HTTP follow binding sharing the same observation owner. Deliver
initial state and changed messages/activity, not full raw transcript snapshots
per tool event. Define cursor scope, revisions, reconnect and explicit reset for
rewind/compaction/retention loss. Finalized prose is sufficient initially;
partial token assembly is deferred. Keep controller replacement, revocation,
slow-consumer limits and listener teardown explicit across private transports.

Deterministically test subscribe/read races, reconnect, reset, stalled consumers
and cleanup. Two light agent trials cover following a scripted worker and
recovering after disconnect. Polling and streaming are both valid strategies.
Review, repair and commit.

### 4 — Create sessions with trusted provenance and retry identity

Expose native creation through an application service shared with existing
launch ownership, not a loopback call into legacy routes. Reuse project,
provider/model/effort/permission/admission configuration. Add persistent scoped
request identity and conflict/uncertain/reconciliation states, using real
SQLite. Preserve the resulting canonical YA id and creation facts through
restart. Record principal, originating server/session/launch, destination,
request id and time separately from client hints and fork or /btw parenting.
Build the receipt foundation so messaging reuses it. Enable writes only under
an explicit management opt-in; do not silently broaden existing read grants.

Test duplicate/concurrent/conflicting requests, lost responses, restart/crash
windows and provider startup failure using native protocol boundaries. One
light eval creates a worker and reports its result and creator. Review and
commit.

### 5 — Submit attributed messages and complete the agent workflow

Use the incumbent session owner and common receipt service for input. Separate
accepted/queued, provider-delivered, failed/uncertain and response completion
evidence. Retrying a submission cannot duplicate input; stopped-session policy
is explicit. Follow by submission identity as well as session activity. Busy
queueing, canonicalization and restart must preserve attribution and receipt
lookup. No automatic second provider resume or hidden approval is allowed.

Test input ownership, busy delivery, duplicates, cancellation/disconnect,
restart and follow continuity. Run one or two light end-to-end trials: create
a reviewer, follow its prose, send a follow-up, reconnect and retrieve the
answer/creator without duplicate work. Review, repair and commit.

## Checks, evidence and completion

Run root lint, non-writing formatting, typecheck and workspace tests for source
changes, plus meaningful focused boundary tests. Add UI only for necessary
opt-in semantics, using exact capability gates/older-host omission and final
desktop/phone capture plus sequential typing evidence. Baseline releases have
no v0 management promise; add a distinct capability rather than broaden the
existing read-only bootstrap capability. Retain existing user defaults.

Reuse the opt-in [eval runner](../../scripts/agent-api-eval/README.md), with fresh
scratch environments, deterministic fixture truth, controlled API authority,
no model calls in CI, and approximately 6–8 targeted trials overall. Sol medium
is the evaluator; Sol high reviewers are separate code review. Record success,
requests/errors, returned bytes, elapsed time and reported usage without
inventing unique-context tokens, cache savings or subscription prices. Local
Qwen is optional diagnostic evidence, not an acceptance gate.

Record each phase's actual tests, reviewer findings/fixes, model trials,
remaining limits and commit. Existing intermittent Rendez watcher failures are
tracked in [its gap](../../gaps/rendez-nested-watch-event-after-restart.md);
do not hide them, widen timeouts or call a failing final suite green.

## Phase 1 evidence

Implemented bounded native acquisition with frozen Codex lineage, Claude branch
selection, exact queued prose, generation validation and a bounded warm cache.
The read-only Sol high review found and drove repairs for rewrite-plus-append,
metadata/body races, clipped queued prompts, queued admission and long wrapped
Codex failures. Tests include those regressions and captured-provider parity.
A read-only local diagnostic acquired a roughly 18 MB native Codex session;
its next unchanged read parsed zero JSONL body records. These are diagnostic
observations, not a cross-host performance benchmark.

Phase 1 review is closed after a further interruption-marker regression. Final
focused acquisition/source/subscription checks pass (40 tests); root lint,
format, typecheck and workspace tests pass. The full server run passed 6,595
cases before the final guard-only repair; the changed boundary was rerun with
15 reader cases afterward. Native Windows qualification remains deferred.
