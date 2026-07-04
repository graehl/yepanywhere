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
- optional "target checkout must be clean" policy.

The key rule is: do not pop a queue item and then discover the lane cannot
start. Preflight first; keep blocked work visible and retryable.

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

After a different workstream lands, idle workstreams may become behind main.
Before their next queued turn, YA can safely fast-forward/sync them only when
they have no unlanded commits. If they do have unlanded commits, the workstream
must be rebased or left visible as behind-main.

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

## Non-Goals

- Do not make PRs required for the local workflow.
- Do not switch the user's canonical main checkout to feature branches as part
  of workstream execution.
- Do not auto-land work by default.
- Do not infer semantic independence from changed files. YA can warn on
  overlap, but the user owns the decision that two topics are independent.
- Do not silently rewrite queued prompts or add hidden prompt framing.
- Do not require setup-script support for the first useful workstream slice.

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
