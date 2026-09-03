# Playwright runs overwrite one shared session pointer

`packages/client/e2e/global-setup.ts`, `fixtures.ts`, and
`global-teardown.ts` coordinate through the fixed
`<os tmpdir>/claude-e2e-session` file. Two Playwright invocations in the same
temp namespace overwrite that pointer, so a worker can read the other run's
ports and paths and teardown can target the wrong run. The observed failure
created one run under `claude-e2e-CheCvw` while its worker looked for the port
file under `claude-e2e-lcMwIy`.

This was not fixed with the Codex goal work because it is an independent E2E
harness contract. A narrow fix is to give each invocation a run-specific
setup/fixture/teardown address (or fail fast under a deliberate single-run
lock). Giving one invocation a private `TMPDIR` is a working diagnostic
workaround, not a repository-wide concurrency contract.

Found 2026-09-03 while capturing Codex goal argument completions alongside
another agent's Playwright run.
