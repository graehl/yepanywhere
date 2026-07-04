# Workstreams

> Workstreams are YA-managed lanes for ongoing topic work in one repository:
> each lane has its own queue, session lineage, and optionally a branch-backed
> Git worktree, while the repository keeps one canonical main checkout for
> interactive work and local integration.

Topic: workstreams

Status: proposed.

Implementation progress is tracked in
[`docs/tactical/054-workstreams.md`](../docs/tactical/054-workstreams.md).

## Motivation

Project Queue is useful for a single active checkout: it lets a user prepare
follow-up work and have YA start exactly one queued item after the whole project
goes idle. That is too coarse for the common "many prepared topics" workflow:

- the user keeps 5-10 ongoing topics alive as separate sessions;
- each topic advances in chunks, often one committed agent turn at a time;
- after a turn finishes, the user reviews the unread output, discusses the next
  step, then queues the next chunk in the same session;
- some topics are known by the user to be independent enough to run while
  another topic is active;
- other topics should remain serialized because they touch the same files or
  architectural surface.

With the current project-wide idle gate, one deliberately active session blocks
every queued topic in the project, even when the user knows another topic could
run in an isolated checkout. Codex/Claude desktop-style worktrees solve the
isolation half, but their visible flows are branch/PR-oriented. YA's target
workflow is local-first: run several topic lanes, review them in the inbox, and
land them back to the local main checkout without requiring GitHub or PRs.

## Mental Model

A workstream is like a separate checkout of the same repository, but grouped
under the same YA project instead of appearing as a duplicate project:

```text
/Users/kgraehl/code/yepanywhere
  canonical checkout, usually on main

~/.yep-anywhere/worktrees/yepanywhere/xr-blink
  workstream checkout, branch ya/xr-blink

~/.yep-anywhere/worktrees/yepanywhere/world-crud
  workstream checkout, branch ya/world-crud
```

Behaviorally, this is close to manually keeping
`~/code/project`, `~/code/project-1`, and `~/code/project-2` in sync with a
shared upstream. Git worktrees are the better implementation detail because
they share Git object storage, make branch ownership explicit, and are easier
for YA to create, list, clean up, and group under one project.

The canonical checkout remains important. Some projects can only be tested
effectively from the user's normal checkout because dev servers, auto-reload,
device state, editor integrations, or local tools are already pointed there.
Therefore "main reserved" is one useful mode, not the only mode:

- **Main-first / mixed:** the main checkout remains a normal execution lane;
  secondary workstreams can run independently, but landing waits for main to be
  clean and idle.
- **Main-reserved:** queued agent work defaults to workstream checkouts; main is
  primarily the integration and review target.

The default for existing users should remain the current single-lane behavior.
Workstreams are YA-novel and should be opt-in/default-off until deliberately
promoted.

## Product Shape

The user-facing object is **workstream**, not "PR". A workstream includes:

- a topic label;
- one or more associated sessions;
- a queue of pending chunks for that topic;
- an execution checkout (`main` or a worktree path);
- optional branch metadata;
- pause/resume state;
- landing state relative to the canonical main branch.

This lets the inbox stay central. The user reviews completed/unread workstream
sessions, decides the next prompt, and queues the next chunk in the same lane.

PR creation remains optional export. It is not the backbone of the local flow.

## MVP

The smallest useful MVP is manual and lane-aware:

1. Add durable workstream metadata.
2. Treat the existing project checkout as the implicit `main` workstream.
3. Allow an opt-in queue target selector: `main`, an existing workstream, or
   `new workstream`.
4. For `new workstream`, create a branch-backed Git worktree and start the
   provider session in that worktree path.
5. Associate sessions with a workstream id.
6. Promote Project Queue items by target workstream id instead of by whole
   project id when a queue item targets a workstream.
7. Add a Workstreams page that visualizes each lane's queue, status, branch,
   path, active/unread session, pause state, and Git summary.
8. Provide guarded manual landing actions later, after the metadata and
   scheduler shape are proven.

This MVP does not need full setup-script orchestration, automatic conflict
resolution, or PR workflows. A user can initially tell the agent to commit,
rebase, or prepare a branch manually inside the session.

## Minimal Metadata

Store stable identity and ownership. Compute volatile Git facts live.

```ts
interface Workstream {
  id: string;
  projectId: string; // canonical YA project id for the main checkout
  label: string;
  kind: "main" | "worktree";
  path: string; // provider cwd for this lane
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

Session metadata needs only:

```ts
interface SessionMetadata {
  workstreamId?: string;
}
```

Project Queue items need only:

```ts
interface ProjectQueueItem {
  targetWorkstreamId?: string; // absent = current main-lane behavior
}
```

Do not persist cached cleanliness, ahead/behind counts, changed-file lists, or
mergeability unless a later implementation needs a snapshot for audit/logging.
Those values drift and should come from Git at display or preflight time.

Provider-native ids remain provider-native ids. YA URL session ids stay the
canonical user-facing session ids in URLs, metadata, REST/WebSocket payloads,
and UI copy.

## Queue Semantics

Project Queue becomes lane-aware:

```text
A queued item can promote when its target workstream is idle and unpaused.
```

For the implicit main workstream, this is equivalent to today's Project Queue
behavior unless the user opts into additional workstreams. For a branch-backed
workstream, YA checks that workstream's process/session/queue/liveness state
instead of blocking on unrelated active sessions in the same repository.

The scheduler should still be conservative:

- one active provider turn per workstream;
- one claimed Project Queue item per workstream idle boundary;
- optional global cap on concurrently active workstreams per project;
- target checkout must pass start preflights before an item is claimed;
- failed preflights leave the item queued with visible blockers.

Useful start preflights include:

- no active provider turn in the target workstream;
- no setup/cleanup/integration operation running in that workstream;
- no Git sequencer state in the target checkout;
- a clean tracked-file checkout — default-on for YA-managed worktree lanes,
  opt-in for the main lane;
- declared rule gates from the optional `.workstream` config (up to date
  with the base branch, mandatory-pass commands such as tests).

Session idle state alone is not a "chunk finished" signal. A structured
waiting-input state blocks promotion, but whether a pause is expressed that
way is a provider implementation detail: an agent that ends its turn with a
prose question reads as idle while its work sits uncommitted. A clean
tracked checkout is the mechanical proxy for "the chunk actually finished"
that needs no text interpretation. It defaults on for managed lanes because
only agents work there — between chunks, a dirty tree is always evidence of
an unfinished chunk — while the main lane is the user's interactive
checkout and legitimately dirty, so the same gate is opt-in there.
Untracked files never count against cleanliness (task notes, logs, and
generated artifacts must not wedge a lane), and a per-lane or per-item
"promote anyway" override belongs next to the gate. One residual is
accepted deliberately: an agent that commits and then asks a prose question
promotes the next item past the question. The commit makes that a valid
boundary, and closing the gap would mean interpreting agent text —
question-shaped heuristics belong to display surfaces like the inbox, never
to scheduling gates.

Lane readiness is rule-based, not only activity-based. Beyond agent
idleness, a lane unblocks only when its declared rules hold: built-in
mechanical facts YA checks itself (up to date with the base branch, clean
checkout) and mandatory-pass commands (tests) that must exit zero. Rules
live in an optional per-project `.workstream` config file; with no file,
only the built-in defaults above apply. A possible shape:

```jsonc
{
  "unblock": {
    "upToDateWithBase": true,
    "checks": [{ "name": "tests", "run": "pnpm test" }]
  }
}
```

Check runs happen in the lane checkout at an agent-idle boundary; YA owns
their logs and status (the same principle as setup scripts), surfaces a
failed check as the lane's visible blocker, and should cache pass results
by commit so an unchanged lane is not re-tested on every promotion
attempt. Because the file is repository content that YA executes, honoring
it needs an explicit trust step (see [security](security.md)). YA has no
project-scoped settings surface today, and `.workstream` does not create
one: it is ordinary repository content, versioned with the code it gates —
each lane evaluates the rules as of its own branch, the same model as
in-repo CI config. Hard-scripting every possible policy into YA is a
non-goal —
judgment-shaped work belongs to the agent under the user's standing agent
instructions, and the core product want here is multiple project queues,
not custom Git machinery.

The key rule is: do not pop a queue item and then discover the lane cannot
start. Preflight first; keep blocked work visible and retryable (a
clean-checkout block names the dirty files).

## Worktree Setup

Git worktrees themselves do not define setup scripts. Codex and Claude desktop
both support `.worktreeinclude` for copying selected ignored files, but setup
scripts, cleanup scripts, symlinked directories, and actions are product
policy.

For YA:

- initial workstream support should not require setup scripts;
- `.worktreeinclude` is the only cross-tool convention worth adopting early;
- no directories, especially `node_modules`, should be symlinked by default;
- if setup commands are added, YA must own the logs and status rather than
  burying failures in provider output;
- setup failure should be a first-class workstream state with `View log`,
  `Retry`, `Skip`, and `Delete` actions.

YA should own only workstreams it created or the user explicitly imported.
Random Git worktrees created by an agent or by another tool may be detected
read-only, but should not be automatically cleaned up, landed, or routed until
the user imports them.

## Workstreams Page

The first product surface should be a project-level Workstreams page:

```text
Workstream        Queue   State        Branch        Diff       Action
main              3       running      main          clean      Pause
xr blink          2       ready        ya/xr-blink   +14 -2     Land
world CRUD        1       queued       ya/world      clean      Start
tools cleanup     0       paused       ya/tools      +8 -1      Resume
```

Each row should make the queue and integration blockers obvious:

- associated active session or latest unread session;
- queued item count;
- active / idle / paused / setup-failed / ready-to-land state;
- branch and worktree path;
- clean/dirty/ahead/behind summary;
- whether the workstream is behind the current main branch;
- why it cannot start or land yet.

The page should expose:

- pause/resume one workstream queue;
- pause/resume all workstream execution;
- pause/resume integration operations separately;
- open the associated session;
- open status/diff/log details;
- land locally when preconditions allow.

Archived and landed lanes hide by default behind a show-hidden toggle (the
stable set of active lanes should stay small), and they drop out of the
project-level clear rollup.

Session headers should show the workstream identity in compact form, for
example:

```text
yepanywhere / xr blink / ya/xr-blink
```

## Landing Back To Main

Execution can be parallel by lane. Integration into main is serialized.

The local landing operation should be deterministic and guarded:

1. Pause the target workstream queue.
2. Require no active provider turn in that workstream.
3. Require the workstream checkout to be clean.
4. Require the main checkout to be clean and not in an active main turn.
5. Require no Git sequencer state in either checkout.
6. Rebase the workstream branch onto current main.
7. Fast-forward or squash main from the workstream branch, according to the
   selected landing mode.
8. Reset/sync the workstream branch to the new main head if the lane will
   continue.
9. Resume or offer to resume the workstream queue.

If rebase or landing fails, YA should stop, preserve the state, surface the log,
and offer an "ask agent to resolve" action in that workstream session. It
should not silently choose merge commits or hidden conflict resolution.

After a workstream lands, every other lane should be synced to the new main
head as soon as that is safe. "Safe" means the lane is agent-idle: moving a
checkout under an active provider turn is never allowed — it fails the
agent's in-flight edits and invalidates files it has already read — so the
sync is automatic but deferred to each lane's next agent-idle boundary.
This leans on YA's existing session idle tracking
([session-liveness](session-liveness.md)).

Lanes with no unlanded commits fast-forward silently; there is nothing for
an agent to drive. A lane that cannot fast-forward gets a system-originated
turn in its session stating the facts — main moved to a given commit, the
lane has N unlanded commits, catch-up needs a rebase or merge, these paths
would conflict — and nothing more. YA never parks the checkout in sequencer
state as a handoff: it detects conflicts without mutating the checkout (or
aborts its own failed attempt), so an idle lane always presents a clean
checkout and the repair turn passes the activity and cleanliness
preflights. Rule gates are different: a system-originated repair turn is
by construction exempt from the declared rule it exists to repair — a
catch-up turn cannot be blocked by up-to-date-with-base, nor a test-fix
turn by the test gate — while agent-idle, no-sequencer-state, and clean
tree still hold. The agent
drives the resolution from that clean state, free to choose rebase, merge,
or another strategy; whether it acts autonomously or discusses with the
user first is governed by the user's standing agent instructions
(project/global agent boot files), not by YA prompt text — which is why the
injected turn must stay factual rather than prescriptive. A visible
transcript turn is consistent with the no-hidden-prompt-framing non-goal;
it is the hiding that is banned.

## Relationship To Existing Project Queue

The existing Project Queue remains the single-lane baseline. Workstreams are a
future extension that changes the unit of idleness from:

```text
whole project is idle
```

to:

```text
target workstream is idle
```

This preserves today's behavior for users who never enable workstreams while
allowing advanced users to run known-independent topics without having one
active project session block every prepared queue item.

Project-level status rolls up from lanes: a project is clear when every
non-archived lane is clear (agent-idle with its gates passing). With only
the implicit main lane, this degenerates to exactly today's project-idle
behavior.

## Non-Goals

- Do not make PRs required for the local workflow.
- Do not switch the user's canonical main checkout to feature branches as part
  of workstream execution.
- Do not auto-land work by default.
- Do not infer semantic independence from changed files. YA can warn on
  overlap, but the user owns the decision that two topics are independent.
- Do not silently rewrite queued prompts or add hidden prompt framing.
- Do not require setup-script support for the first useful workstream slice.

## Design Decisions

- **Lanes are first-class under one YA project** (vs. independent YA
  projects per checkout, optionally tagged as mapping to one logical
  project): the grouping tag is only display-deep. Queue targeting, idle
  scoping, landing, post-land sync, pause-all, and overlap warnings are
  cross-lane semantics; each would need the tag threaded through it as a
  special case, reinventing workstreams as scattered conditionals. The
  useful residue of the rejected alternative is an import affordance:
  detect sibling checkouts/worktrees of one repository and offer to import
  them as lanes. (2026-07-04)
- **Managed-lane promotion gates on a clean tracked checkout by default**
  (vs. trusting session idle / waiting-input): structured waiting-input is
  a provider implementation artifact and prose-question pauses read as
  idle, so committed state is the only mechanical "chunk finished" signal.
  The accepted residual (commit-then-ask promotes past the question) is
  recorded above so it is not later "fixed" with text heuristics in the
  scheduler. The main lane keeps the gate opt-in. (2026-07-04)
- **Lane readiness is rule-based, not only activity-based** (vs. unblocking
  on agent idleness alone): a lane unblocks only when its declared rules
  hold — up to date with the base branch, mandatory-pass commands succeed —
  declared per project in the optional `.workstream` config. (2026-07-04)
- **Post-land fast-forward is automatic but deferred to agent-idle** (vs.
  immediate sync): moving a checkout under an active provider turn fails
  the agent's in-flight edits and cannot be allowed to happen; the deferral
  leans on existing session idle tracking. (2026-07-04)
- **Non-fast-forward catch-up is agent-driven via a factual injected turn**
  (vs. YA hard-scripting merge policy): resolving a non-ff upstream is well
  handled by standing agent instructions; the default expectation is the
  agent figures it out and follows project policy to prepare the lane's
  next commit. Hard-scripting everything possible into YA would be a
  mistake. (2026-07-04)
- **YA never hands off a checkout in sequencer state** (vs. leaving a
  conflicted rebase in progress as the most informative handoff): YA
  detects conflicts without mutating the checkout, or aborts its own failed
  attempt, and names the conflicted paths in the factual turn instead. This
  keeps the idle-lane-means-clean-checkout invariant — repair turns pass
  normal preflights — and leaves the strategy choice (rebase, merge, other)
  to the agent and user rather than baking it into inherited sequencer
  state. Cost: one re-run of a mechanical command. (2026-07-04)

## Open Questions

- Should workstream creation live in the new-session composer, the Project
  Queue action menu, the Workstreams page, or all three?
- What is the first branch naming pattern: `ya/<slug>`,
  `ya/<date>-<slug>`, or user-configurable from the start?
- Should a workstream have exactly one primary session, or a session lineage
  with forks/side sessions grouped under the same lane?
- Should the first landing mode be fast-forward only, squash only, or both?
- How should changed-file overlap warnings be displayed without becoming a
  false promise of semantic safety?
- Should imported non-YA worktrees be read-only until the user explicitly
  marks them managed?
- Should YA auto-apply a rebase it has verified conflict-free (same class
  as the automatic fast-forward, but it rewrites unlanded commit SHAs), or
  always hand non-ff catch-up to the agent?
- `.workstream` format details: file name and syntax, the split between
  built-in rules and command checks, pass-result caching keyed by commit,
  and composition with `.worktreeinclude`.
- Trust model for executing repo-declared `.workstream` commands
  (first-use approval, hash-pinned re-approval on change — the first-party
  harness hook-approval precedent).
- Do declared `.workstream` rules apply to the implicit main lane by
  default, or only to managed lanes unless main explicitly opts in?
  Leaning: explicit opt-in that brings the clean-checkout gate along with
  it — a rule check against a dirty interactive checkout tests a state
  that is no commit.
- Eager checks: should declared checks also run automatically whenever a
  lane reaches a clean, agent-idle state — warming the promotion gate
  during user think time instead of paying test latency at unblock — with
  a run canceled when the tree goes dirty, since a run over a mutating
  checkout no longer describes any commit? Leaning: yes, default-on when
  checks are declared. Same mechanism as the promotion gate (it only adds
  a trigger that populates the per-commit result cache), running in the
  lane checkout where deps and build state are warm; an isolated run
  worktree would remove the cancel-on-dirty need but reimports the
  worktree setup problem. On completion, a failing result is injected as
  a factual repair turn (commit, check name, log tail) so the lane heals
  without waiting for the user to notice the blocker; a passing result is
  consumed silently by the gate and surfaces only in lane status —
  injecting green results would spend a provider turn on information that
  requires no action. Failure injection is the first place YA would
  autonomously start a provider turn with no user action in the loop, so
  it stays a visible, configurable default rather than an implicit one.
