# Local Addendum

## Branch Workflow

When work is split into multiple completed parts, land each part directly on
`graehl/main` by default instead of stacking branch-on-branch PRs or nested
feature branches. Only use stacked PRs when the user explicitly asks for that
workflow.

Do not apply the usual branch-per-task discipline in this project for now.
Work on `main` by default; deal with concurrent agents and unrelated WIP
manually by reading the dirty tree carefully, keeping edits scoped, and
sculpting commits rather than creating a branch per task.

## Remotes: origin vs kzahel

`origin` is `graehl/yepanywhere` on GitHub — that is where we push. `main`
on this local clone tracks `origin/main`, and PRs are opened there.

`kzahel` (`kzahel/yepanywhere`) is the real upstream, but it is **not**
something to merge, rebase onto, or otherwise touch automatically. Do
not run `git merge kzahel/main`, `git rebase kzahel/main`, or any
fork-update action unless the user has explicitly asked for it in the
current turn. Prior turns do not carry authorization forward — each
kzahel integration is its own decision. When the user does ask, the
integration may happen either via the GitHub UI (on the `origin` fork
page) or locally; the user chooses.

Checking whether `origin` or `HEAD` is behind `kzahel/main` is allowed
and useful as an observation — but report it plainly rather than
framing it as "out of sync" or "needs syncing". Treat the word *sync*
as misleading here: it implies an automatic reconciliation that is not
the policy. Phrasing like "origin is N commits behind kzahel/main" or
"kzahel has M new commits since origin last integrated" is fine.

If an earlier agent run (including a prior turn of this same session)
appears to have pulled in kzahel commits without being asked, surface
that clearly as *work the user may not be aware of* — name the commits,
say when they landed, and flag it for review rather than burying it in
a status line. The user treats unrequested kzahel integration as a
meaningful event, not a routine housekeeping step.

Before reporting any ahead/behind count against kzahel, `git fetch
kzahel` first — the local remote-tracking branch can easily be stale
and produce wrong counts.

## Targeted Test Execution

Root-level targeted `vitest` runs are environment-sensitive here.

Worked:
- `pnpm vitest --environment jsdom <client test files> --run` for
  React/client renderer tests.
- `pnpm vitest <server test files> --run` for server/session tests in
  the default Node environment.
- `pnpm typecheck` after the focused test runs for cross-package TS
  verification.

Did not work:
- A single root `pnpm vitest <client files> <server files>` invocation
  without splitting environments. The root runner defaults to Node, so
  client RTL tests fail with `document is not defined`.

## Local Task Files

`tasks/` is local and gitignored in this clone. Do not create a task file for
minor requests or small self-contained fixes; reserve task files for follow-up
work that is likely to span sessions, need design notes, or produce a later YA
mitigation/upstream PR.

When task files do exist, treat them as real follow-up inventory. Check and
update the relevant task when resuming that line of work. Cite any related task
file in planning and again when concluding a feature/bugfix request, and suggest
the next useful task follow-up when it would help the user steer future work.

## Host Tooling Constraints

Do not run Biome on this `gra` host. The checked-in Biome binary requires a
newer glibc than this machine provides, so `pnpm lint` / `pnpm exec biome ...`
fails before checking the code. Use TypeScript and targeted tests here, and
report that Biome was skipped for host compatibility.

## Runtime Restart Discipline

Treat full YA restarts as something to justify, not a default reflex.
Many client-visible changes hot-reload correctly, and some server-side
changes can be confirmed live without rebooting first.

When deciding whether to restart:
- Prefer confirming whether the relevant client/server path already
  hot-reloaded before bouncing the app.
- Avoid calling `reyep` from a process tree that is plausibly a child
  of the running YA server/session supervisor; in that context it can
  kill the serving process and fail to bring the app back cleanly.
- If using the `reyep` shell function for a full YA restart, run the
  function atomically as one shell invocation. Do not copy or execute
  the function's component commands line-by-line from a YA server
  subprocess; the serving process can be killed before the restart
  sequence finishes.
- If a restart is needed, use a path that is robust from the current
  execution context rather than assuming `reyep` is safe everywhere.
