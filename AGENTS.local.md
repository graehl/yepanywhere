# Local Addendum

## Branch Workflow

When work is split into multiple completed parts, land each part directly on
`graehl/main` by default instead of stacking branch-on-branch PRs or nested
feature branches. Only use stacked PRs when the user explicitly asks for that
workflow.

Before starting new work, check whether the local working branch is behind
upstream `kzahel/main`; if it is, merge or rebase onto `kzahel/main` first so
the graehl fork stays in sync with the real upstream history.
