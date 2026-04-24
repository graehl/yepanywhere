# Local Addendum

## Branch Workflow

When work is split into multiple completed parts, land each part directly on
`graehl/main` by default instead of stacking branch-on-branch PRs or nested
feature branches. Only use stacked PRs when the user explicitly asks for that
workflow.

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
- If a restart is needed, use a path that is robust from the current
  execution context rather than assuming `reyep` is safe everywhere.
