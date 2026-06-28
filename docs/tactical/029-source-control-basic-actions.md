# Source Control Basic Actions

Status: In progress.

Progress:

- [ ] Confirm server API shape for explicit remote operations.
- [x] 2026-06-28: Add recent local commit history to the source-control data
      model.
- [x] 2026-06-28: Add explicit `Check remote` state, timestamp, capability,
      fetch-on-click endpoint, and per-project remote operation guard.
- [x] 2026-06-28: Add a click-only fast-forward `Pull` action with concise
      result mapping.
- [x] 2026-06-28: Add a click-only `Push` action for branches with upstream,
      with concise result mapping.
- [ ] Add publish branch action with concise result mapping.
- [x] 2026-06-28: Add a per-project git operation guard for remote-touching
      source-control actions.
- [x] 2026-06-28: Replace the wide-browser diff modal with a split-pane
      viewer.
- [x] 2026-06-28: Keep the modal path for narrow/mobile layouts.
- [x] 2026-06-28: Add the `git-status-enhanced` capability gate so a newer
      frontend disables this page with an upgrade message when talking to an
      older server.
- [x] 2026-06-28: Move recent commits into the left Source Control column with
      a contained scroll area, leaving the right column for the diff preview.
- [ ] Add focused server and client tests.

## Context

The current Source Control page is intentionally small: it polls local git
status and opens file diffs in a modal. Pull request #76 explored a much fuller
GitHub Desktop-style workspace with staging, commits, stash, branch switching,
history, fetch, push, and destructive cleanup actions. The screenshots and
visual architecture are useful, but the operation surface is broader than the
first useful YA version needs.

YA should not become a full Git client by default. Agents commonly handle
commit/stage workflows inside sessions. The human-facing gap is more often:

- seeing what changed without fighting a modal on wide browser layouts;
- checking whether the branch has remote updates;
- pulling safely when the user decides to do it;
- pushing completed agent work when the user decides to publish it.

## Decision

Improve the existing Source Control page with a narrow, explicit remote-action
surface:

- keep status polling local-only;
- require an explicit `git-status-enhanced` server capability for the enhanced
  page;
- do not periodically fetch or prompt for periodic remote refresh;
- add a manual "Check remote" action that runs fetch on click;
- add pull and push buttons that perform remote work only on click;
- show recent local commits as read-only context;
- show "Last checked remote" next to the remote refresh action;
- improve wide-browser diff viewing with a persistent preview pane.

The UI should use concise command outcomes and avoid dumping raw git output as
the primary user experience. Detailed stderr can remain available in logs or a
secondary disclosure if needed for debugging.

## Non-Goals

Do not add these in the first implementation:

- commit creation;
- staging and unstaging;
- stash create/apply/drop;
- discard, undo, reset, or file deletion actions;
- branch switching or branch creation;
- merge/rebase conflict workflows;
- history actions such as checkout, revert, cherry-pick, or reset;
- automatic/background fetch;
- an agent handoff button.

Users already know they can create a session when a git operation needs manual
conflict resolution, branch surgery, or project-specific judgment.

## UX Shape

Wide browser layout:

- top summary bar: branch, upstream, ahead/behind, clean/dirty, last remote
  check;
- action group: Check remote, Pull, Push, optional Publish branch;
- left pane: changed files grouped by staged/unstaged/untracked, as today;
- right pane: selected file diff preview, persistent on wide browser layouts;
- lower or side context: recent commits on the current branch.

Narrow/mobile layout:

- keep the file list as the primary view;
- use the existing modal-style diff viewer or a small-screen successor;
- keep remote actions visible but compact.

Copy should say "Last checked remote", not "Last synced", because fetch updates
remote-tracking refs but does not necessarily pull or push project files.

## Remote State Model

The existing status poll should remain cheap and local. Today it polls every
five seconds while visible and runs local commands such as `git status` and
`git diff --numstat`. That boundary is correct.

Remote state is only refreshed by explicit operations:

- Check remote;
- Pull;
- Push, when the implementation chooses to fetch as part of the operation;
- Publish branch, if added.

Track the last successful remote check as an in-memory server fact keyed by
project path or project id. Include it in the status response or in remote
action responses. It is acceptable for this timestamp to reset on server
restart.

Ahead/behind values are always relative to the current local remote-tracking
refs. If the user has not checked remote recently, the UI should treat them as
"last known" rather than fresh network truth.

## Server API

Keep the existing read-only status and diff routes. Add narrow action routes
rather than a broad "run git command" endpoint.

Candidate routes:

- `POST /:projectId/git/check-remote`
- `POST /:projectId/git/pull`
- `POST /:projectId/git/push`
- `POST /:projectId/git/publish`

Candidate local history route or status extension:

- `git log -n 5 --format=... --date=iso-strict`

The history data should include:

- full hash;
- short hash;
- subject;
- author name;
- author date.

Remote actions should return structured results:

```ts
type GitActionStatus =
  | "success"
  | "already-up-to-date"
  | "rejected"
  | "blocked"
  | "not-available"
  | "failed";

interface GitActionResult {
  status: GitActionStatus;
  message: string;
  detail?: string;
  checkedRemoteAt?: string;
  statusSnapshot?: GitStatusInfo;
}
```

Exact names can change during implementation. The important constraint is that
the client receives user-facing categories rather than raw command output.

## Pull Semantics

Pull means "try a safe fast-forward pull now".

The first implementation uses `git pull --ff-only` directly with terminal
prompts disabled. It is intentionally click-only and lets Git decide whether a
dirty working tree can be updated safely. A later refinement can split this
into explicit fetch and fast-forward steps if the extra result precision is
worth the complexity.

First implementation on click:

1. Validate project and repository state.
2. Run `git pull --ff-only` with terminal prompts disabled and a timeout.
3. Refresh and return a status snapshot.

Refined implementation, if needed:

1. Refuse detached HEAD, missing upstream, or in-progress merge/rebase states.
2. Run `git fetch <remote>` with a timeout.
3. Run a fast-forward update with explicit steps rather than opaque `git pull`
   behavior.
4. Refresh and return a status snapshot.

Do not pre-refuse only because the worktree is dirty. Git can fast-forward with
local uncommitted changes when the incoming changes do not overlap. Let git
reject the operation when local changes would be overwritten, then map that
failure to a short message such as:

> Pull stopped; local changes would be overwritten.

Other expected pull outcomes:

- already up to date;
- pulled latest changes;
- branch has diverged;
- no upstream branch;
- repository has an unfinished merge/rebase;
- remote authentication or network failure;
- operation timed out.

## Push Semantics

Push means "try to push the current branch now".

The first implementation validates that the current branch already has an
upstream, then runs a normal `git push` on click with terminal prompts disabled
and a timeout. It does not publish branches without upstream.

If the remote has newer commits, let git reject it and map that to:

> Push rejected; remote has newer commits.

For a branch without upstream, either:

- show a separate "Publish branch" button; or
- make Push open a small confirmation that clearly names the remote and branch.

Prefer the separate Publish branch button if this is implemented in the first
pass. It keeps "Push" from silently creating upstream state.

## Operation Guard

Add a per-project git operation guard on the server. Only one mutating or
remote-touching git action should run for a project at a time:

- check remote;
- pull;
- push;
- publish.

If another operation is already running, return a structured "busy" result.
The client should disable buttons while its own operation is pending, but the
server guard is still needed for double-clicks, multiple tabs, and concurrent
clients.

The guard does not need to cover local status polling or diff rendering.

## Reuse From PR #76

Useful pieces to consider selectively:

- wide-browser split-pane source-control layout;
- richer file row metadata and selected-file preview behavior;
- recent commit list presentation;
- responsive behavior for collapsing the preview into a modal.

Avoid porting these pieces wholesale:

- route semantics that label a pull as fetch;
- destructive discard/undo/stash operations;
- branch switch/create/merge flows;
- commit and staging workflows;
- broad git action models that expose too much surface at once.

## Client Work

Likely files:

- `packages/client/src/pages/GitStatusPage.tsx`
- `packages/client/src/hooks/useGitStatus.ts`
- `packages/client/src/api/client.ts`
- `packages/client/src/i18n/en.json`
- `packages/client/src/styles/index.css`

Client implementation notes:

- use `useI18n().t(...)` for new visible copy;
- keep selected-file state local to the Source Control page;
- use the split pane only above the wide browser responsive breakpoint;
- do not put command stderr in the main layout;
- show recent commits as read-only context, not an action list;
- make remote timestamps relative if existing relative-time helpers fit.

## Server Work

Likely files:

- `packages/server/src/routes/git-status.ts`
- `packages/shared/src/index.ts` or a git-specific shared type file

Server implementation notes:

- use `execFile`, not shell interpolation;
- validate project ids as the existing routes do;
- resolve remote/upstream from git instead of trusting client input;
- set command timeouts for remote operations;
- normalize common git failures into stable result codes;
- refresh local status after successful or known-state-changing operations.

## Test Plan

Server tests:

- status remains local-only;
- recent commit parsing handles normal commits and empty history;
- check remote updates `checkedRemoteAt` only after successful fetch;
- pull allows dirty worktrees and maps overwrite failures clearly;
- pull maps diverged/no-upstream/in-progress states;
- push maps non-fast-forward rejection;
- operation guard rejects overlapping remote actions.

Client tests:

- wide browser layout renders file list and persistent diff preview together;
- mobile/narrow layout still uses modal-style diff viewing;
- buttons disable while an operation is pending;
- last remote check renders separately from local status refresh;
- recent commits render as read-only rows;
- failure messages are concise and localized.

Manual verification:

- clean repo, already up to date;
- dirty repo, non-overlapping fast-forward pull succeeds;
- dirty repo, overlapping pull is stopped by git;
- branch behind remote;
- branch ahead of remote;
- branch diverged from remote;
- branch without upstream;
- remote auth/network failure.
